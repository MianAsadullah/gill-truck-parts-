"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm, useFieldArray, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { receiveFormSchema, type ReceiveFormValues } from "@/lib/validation/purchasing";
import { receiveAgainstPurchaseOrder } from "@/server/actions/purchase-orders";
import { extend, formatMoney, formatQty, round4, sumMoney } from "@/lib/money";
import { cn } from "@/lib/cn";
import {
  QbButton,
  QbField,
  QbInput,
  QbBanner,
  QbCheckbox,
  QbRibbon,
  QbRibbonTab,
} from "@/components/qb/Ui";

/**
 * Receive Inventory (PUR).
 *
 * The buyer opens this with the packing slip in hand. Each PO line shows
 * what was ordered, what has already arrived, and what is still outstanding;
 * the "Receive Now" column defaults to the full outstanding quantity because
 * that is the common case, and they adjust the ones that came up short.
 *
 * Unit cost is editable per line and defaults to the PO cost. This matters:
 * the figure typed here is what gets rolled into weighted-average cost, so
 * a price increase on the invoice has to be capturable at the dock rather
 * than silently inheriting the price that was quoted weeks earlier.
 */

export interface ReceivePoLine {
  id: string;
  lineNo: number;
  sku: string | null;
  description: string;
  vendorPartNo: string | null;
  isStocked: boolean;
  quantityOrdered: number;
  quantityReceived: number;
  unitCost: number;
  /** Current on-hand and average cost, for the "after this receipt" preview. */
  onHand: number;
  averageCost: number;
}

const asNumber = (raw: unknown): number => {
  if (raw === "" || raw === null || raw === undefined) return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
};

function todayISO(): string {
  const d = new Date();
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
}

export function ReceiveForm({
  poId,
  poNumber,
  vendorName,
  nextReceiptNo,
  poLines,
}: {
  poId: string;
  poNumber: string;
  vendorName: string;
  nextReceiptNo: string;
  poLines: ReceivePoLine[];
}) {
  const router = useRouter();
  const [formError, setFormError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [status, setStatus] = React.useState("");

  const { control, register, getValues, formState: { errors } } =
    useForm<ReceiveFormValues>({
      resolver: zodResolver(receiveFormSchema),
      mode: "onSubmit",
      defaultValues: {
        poId,
        receivedDate: todayISO(),
        vendorPackingSlip: "",
        memo: "",
        closeShort: false,
        lines: poLines.map((l) => ({
          poLineId: l.id,
          // Default to everything still outstanding.
          quantity: Math.max(0, round4(l.quantityOrdered - l.quantityReceived)),
          unitCost: l.unitCost,
        })),
      },
    });

  const { fields } = useFieldArray({ control, name: "lines" });
  const lines = useWatch({ control, name: "lines" }) ?? [];
  const closeShort = useWatch({ control, name: "closeShort" });

  const calc = React.useMemo(() => {
    const rows = lines.map((line, index) => {
      const po = poLines[index];
      const quantity = asNumber(line.quantity);
      const unitCost = asNumber(line.unitCost);
      const outstanding = Math.max(0, round4(po.quantityOrdered - po.quantityReceived));
      const over = quantity > outstanding + 0.0001;

      // Preview the new weighted average so the buyer sees the consequence
      // of the cost they just typed, before they post it.
      const newQty = round4(po.onHand + quantity);
      const newAvg =
        !po.isStocked || quantity <= 0
          ? po.averageCost
          : po.onHand <= 0 || newQty <= 0
            ? unitCost
            : round4((po.onHand * po.averageCost + quantity * unitCost) / newQty);

      return {
        index,
        po,
        quantity,
        unitCost,
        outstanding,
        over,
        amount: extend(quantity, unitCost),
        newQty,
        newAvg,
        costChanged: po.isStocked && quantity > 0 && Math.abs(newAvg - po.averageCost) > 0.00005,
      };
    });

    const receiving = rows.filter((r) => r.quantity > 0);
    return {
      rows,
      count: receiving.length,
      inventoryValue: sumMoney(
        rows.filter((r) => r.po.isStocked && r.quantity > 0).map((r) => r.amount),
      ),
      totalValue: sumMoney(receiving.map((r) => r.amount)),
      anyOver: rows.some((r) => r.over),
      shortLines: rows.filter((r) => r.quantity < r.outstanding - 0.0001).length,
    };
  }, [lines, poLines]);

  async function submit() {
    setFormError(null);

    if (calc.anyOver) {
      setFormError("One or more lines receive more than is outstanding on the order.");
      return;
    }
    if (calc.count === 0) {
      setFormError("Enter a quantity on at least one line.");
      return;
    }

    const values = getValues();
    setSubmitting(true);
    setStatus("Posting receipt...");

    try {
      const result = await receiveAgainstPurchaseOrder({
        ...values,
        poId,
        lines: values.lines.map((l) => ({
          poLineId: l.poLineId,
          quantity: asNumber(l.quantity),
          unitCost: asNumber(l.unitCost),
        })),
      });

      if (!result.ok) {
        setFormError(result.error);
        setStatus("Receipt failed");
        return;
      }

      setStatus(
        "Receipt " + result.data.receiptNo + " posted · PO is now " + result.data.poStatus,
      );
      router.push("/dashboard/purchase-orders/" + poId + "?received=" + result.data.receiptNo);
      router.refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "The receipt could not be posted.");
      setStatus("Receipt failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="qb-window flex flex-col"
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") e.preventDefault();
      }}
    >
      <div className="qb-window-title qb-no-print">
        <span>Receive Inventory &mdash; {poNumber}</span>
        <span className="font-normal text-white/80 text-qb">{vendorName}</span>
      </div>

      <QbRibbon>
        <QbRibbonTab active>Receive</QbRibbonTab>
      </QbRibbon>

      <div className="px-2 pt-2 space-y-1 empty:hidden">
        {formError ? (
          <QbBanner variant="err" onDismiss={() => setFormError(null)}>
            {formError}
          </QbBanner>
        ) : null}
        {calc.anyOver ? (
          <QbBanner variant="err" title="Over-receipt">
            A line is receiving more than the order has outstanding. Reduce the quantity, or
            raise a new purchase order for the extra.
          </QbBanner>
        ) : null}
        {calc.shortLines > 0 && !closeShort ? (
          <QbBanner variant="warn">
            {calc.shortLines} line{calc.shortLines === 1 ? " is" : "s are"} short of the ordered
            quantity. The purchase order will stay open for the balance unless you tick
            &ldquo;close short&rdquo; below.
          </QbBanner>
        ) : null}
      </div>

      <div className="p-2">
        <div className="border border-qb-line bg-white">
          <div className="flex flex-wrap gap-x-6 gap-y-1 px-2 py-2 border-b border-qb-line bg-qb-chromeAlt">
            <div className="space-y-1 min-w-[300px]">
              <QbField label="Receipt No." labelWidth={100}>
                <QbInput readOnly value={nextReceiptNo} className="max-w-[120px] font-qbMono" />
              </QbField>
              <QbField
                label="Date Received"
                htmlFor="receivedDate"
                labelWidth={100}
                error={errors.receivedDate?.message}
              >
                <QbInput
                  id="receivedDate"
                  type="date"
                  {...register("receivedDate")}
                  className="max-w-[130px]"
                />
              </QbField>
            </div>
            <div className="space-y-1 flex-1 min-w-[280px]">
              <QbField label="Packing Slip" htmlFor="vendorPackingSlip" labelWidth={96}>
                <QbInput
                  id="vendorPackingSlip"
                  {...register("vendorPackingSlip")}
                  className="max-w-[200px] font-qbMono"
                  placeholder="vendor slip no."
                />
              </QbField>
              <QbField label="Memo" htmlFor="memo" labelWidth={96}>
                <QbInput id="memo" {...register("memo")} maxLength={500} />
              </QbField>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="qb-grid min-w-[1060px]">
              <thead>
                <tr>
                  <th style={{ width: 26 }}>#</th>
                  <th style={{ width: 120 }}>Item</th>
                  <th>Description</th>
                  <th style={{ width: 52 }} className="text-right">Ord</th>
                  <th style={{ width: 52 }} className="text-right">Rcvd</th>
                  <th style={{ width: 58 }} className="text-right">Outstd</th>
                  <th style={{ width: 66 }} className="text-right">Receive</th>
                  <th style={{ width: 78 }} className="text-right">Unit Cost</th>
                  <th style={{ width: 84 }} className="text-right">Amount</th>
                  <th style={{ width: 210 }}>Avg Cost After</th>
                </tr>
              </thead>
              <tbody>
                {fields.map((field, index) => {
                  const row = calc.rows[index];
                  if (!row) return null;
                  const { po } = row;
                  return (
                    <tr
                      key={field.id}
                      className={cn(
                        row.over && "bg-qb-errBg",
                        !po.isStocked && "bg-[#F4F8FB]",
                      )}
                    >
                      <td className="text-center font-qbMono text-qb-inkMuted">{po.lineNo}</td>
                      <td className="font-qbMono">
                        {po.sku ?? <span className="italic text-qb-inkMuted">non-stock</span>}
                      </td>
                      <td className="truncate" title={po.description}>
                        {po.description}
                        {po.vendorPartNo ? (
                          <span className="text-qb-inkMuted"> &middot; {po.vendorPartNo}</span>
                        ) : null}
                      </td>
                      <td className="qb-grid-num">{formatQty(po.quantityOrdered)}</td>
                      <td className="qb-grid-num text-qb-inkMuted">
                        {formatQty(po.quantityReceived)}
                      </td>
                      <td className="qb-grid-num font-bold">{formatQty(row.outstanding)}</td>
                      <td className="p-0">
                        <input
                          className={cn(
                            "qb-cell-input qb-cell-input-num",
                            row.over && "qb-cell-input-err",
                          )}
                          type="number"
                          step="0.01"
                          min="0"
                          {...register(`lines.${index}.quantity`, { setValueAs: asNumber })}
                          aria-label={"Receive quantity for line " + po.lineNo}
                        />
                      </td>
                      <td className="p-0">
                        <input
                          className="qb-cell-input qb-cell-input-num"
                          type="number"
                          step="0.0001"
                          min="0"
                          {...register(`lines.${index}.unitCost`, { setValueAs: asNumber })}
                          aria-label={"Unit cost for line " + po.lineNo}
                        />
                      </td>
                      <td className="qb-grid-num">
                        {row.quantity > 0 ? formatMoney(row.amount) : ""}
                      </td>
                      <td className="text-qb-xs whitespace-normal">
                        {!po.isStocked ? (
                          <span className="text-qb-inkMuted">no stock effect</span>
                        ) : row.quantity > 0 ? (
                          <span className={row.costChanged ? "text-qb-amber" : "text-qb-inkMuted"}>
                            {formatQty(po.onHand)} @ {po.averageCost.toFixed(4)} &rarr;{" "}
                            <strong>
                              {formatQty(row.newQty)} @ {row.newAvg.toFixed(4)}
                            </strong>
                          </span>
                        ) : (
                          ""
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="border-t border-qb-line bg-qb-chromeAlt p-2 flex flex-wrap gap-4 justify-between items-start">
            <label className="flex items-center gap-2 text-qb">
              <QbCheckbox {...register("closeShort")} />
              Close this purchase order even though some quantity is outstanding
              <span className="text-qb-xs text-qb-inkMuted">
                (releases the balance from quantity-on-order)
              </span>
            </label>

            <table className="qb-grid w-[280px] shrink-0">
              <tbody>
                <tr>
                  <td>Lines receiving</td>
                  <td className="qb-grid-num w-[100px]">{calc.count}</td>
                </tr>
                <tr>
                  <td>Inventory value</td>
                  <td className="qb-grid-num">{formatMoney(calc.inventoryValue)}</td>
                </tr>
                <tr className="bg-qb-gridSelect">
                  <td className="font-bold">Receipt total</td>
                  <td className="qb-grid-num font-bold">{formatMoney(calc.totalValue)}</td>
                </tr>
                <tr>
                  <td colSpan={2} className="text-qb-xs text-qb-inkMuted whitespace-normal">
                    Posts DR Inventory Asset / CR Accounts Payable. The vendor&rsquo;s bill will
                    settle this receipt without posting again.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="border-t border-qb-border bg-qb-chrome px-2 py-[6px] flex items-center gap-1 qb-no-print">
        <QbButton
          variant="primary"
          disabled={submitting || calc.anyOver || calc.count === 0}
          onClick={() => void submit()}
        >
          {submitting ? "Posting..." : "Receive & Close"}
        </QbButton>
        <QbButton onClick={() => router.push("/dashboard/purchase-orders/" + poId)}>
          Cancel
        </QbButton>
        <span className="ml-auto text-qb-xs text-qb-inkMuted" role="status">
          {status}
        </span>
      </div>
    </form>
  );
}
