"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm, useFieldArray, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import {
  purchaseOrderFormSchema,
  type PurchaseOrderFormValues,
  type PurchaseOrderLineValues,
} from "@/lib/validation/purchasing";
import { createPurchaseOrder } from "@/server/actions/purchase-orders";
import { extend, formatMoney, formatQty, round2, sumMoney } from "@/lib/money";
import { cn } from "@/lib/cn";
import {
  QbButton,
  QbField,
  QbInput,
  QbSelect,
  QbBanner,
  QbRibbon,
  QbRibbonTab,
  QbRibbonGroup,
} from "@/components/qb/Ui";
import { ItemLookupModal } from "@/components/invoices/ItemLookupModal";
import type { ProductSearchItem } from "@/types/dto";

/**
 * Create Purchase Orders (PUR).
 *
 * Mirrors QuickBooks' Create Purchase Orders window. Simpler than the
 * invoice screen in one important way: there is no price floor and no
 * override path, because a PO records what WE are willing to pay, not what
 * a customer is charged. The cost columns are always shown — anyone who can
 * raise a PO necessarily holds inventory.view_cost.
 *
 * Default unit cost comes from the part's last purchase cost, which is what
 * a buyer expects to see pre-filled; they overwrite it when the vendor has
 * quoted something else.
 */

interface LineMeta {
  product: ProductSearchItem | null;
  /** Qty on hand at the moment the part was picked, for the buyer's context. */
  onHand: number;
  reorderPoint: number;
}

function newKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return "pl-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}

function blankLine(lineNo: number): PurchaseOrderLineValues {
  return {
    key: newKey(),
    lineNo,
    productId: null,
    sku: null,
    description: "",
    vendorPartNo: null,
    quantityOrdered: 1,
    unitCost: 0,
  };
}

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

function isBlank(line: PurchaseOrderLineValues): boolean {
  return !line.productId && !line.description.trim();
}

const asNumber = (raw: unknown): number => {
  if (raw === "" || raw === null || raw === undefined) return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
};

export interface VendorOption {
  id: string;
  vendorNo: string;
  companyName: string;
  termsName: string | null;
}

export function PurchaseOrderForm({
  nextPoNumber,
  vendors,
  currentUser,
}: {
  nextPoNumber: string;
  vendors: VendorOption[];
  currentUser: { fullName: string; employeeCode: string; roleName: string };
}) {
  const router = useRouter();

  const emptyForm = React.useCallback(
    (): PurchaseOrderFormValues => ({
      id: null,
      vendorId: "",
      orderDate: todayISO(),
      expectedDate: null,
      shipVia: "",
      memo: "",
      freight: 0,
      submit: true,
      lines: [blankLine(1), blankLine(2), blankLine(3)],
    }),
    [],
  );

  const [lineMeta, setLineMeta] = React.useState<Record<string, LineMeta>>({});
  const [itemLookup, setItemLookup] = React.useState<{ index: number } | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState<{ id: string; poNumber: string } | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [status, setStatus] = React.useState("");

  const {
    control,
    register,
    getValues,
    setError,
    reset,
    formState: { errors },
  } = useForm<PurchaseOrderFormValues>({
    resolver: zodResolver(purchaseOrderFormSchema),
    mode: "onSubmit",
    defaultValues: emptyForm(),
  });

  const { fields, append, remove, update } = useFieldArray({ control, name: "lines" });
  const lines = useWatch({ control, name: "lines" }) ?? [];
  const freight = useWatch({ control, name: "freight" });
  const vendorId = useWatch({ control, name: "vendorId" });

  const vendor = vendors.find((v) => v.id === vendorId) ?? null;

  const calc = React.useMemo(() => {
    const rows = lines.map((line, index) => {
      const meta = lineMeta[line.key];
      const quantity = asNumber(line.quantityOrdered);
      const unitCost = asNumber(line.unitCost);
      return {
        index,
        line,
        meta: meta ?? null,
        quantity,
        unitCost,
        amount: extend(quantity, unitCost),
        blank: isBlank(line),
      };
    });
    const live = rows.filter((r) => !r.blank);
    const subtotal = sumMoney(live.map((r) => r.amount));
    const freightAmount = round2(asNumber(freight));
    return {
      rows,
      liveCount: live.length,
      subtotal,
      freight: freightAmount,
      total: round2(subtotal + freightAmount),
    };
  }, [lines, lineMeta, freight]);

  const applyItem = React.useCallback(
    (index: number, item: ProductSearchItem) => {
      const current = getValues(`lines.${index}`);
      const key = current?.key ?? newKey();

      setLineMeta((prev) => ({
        ...prev,
        [key]: {
          product: item,
          onHand: item.quantityOnHand,
          reorderPoint: item.reorderPoint,
        },
      }));

      update(index, {
        key,
        lineNo: current?.lineNo ?? index + 1,
        productId: item.id,
        sku: item.sku,
        description: item.description,
        vendorPartNo: null,
        // Suggest the economic order quantity when the part is at or below
        // its reorder point, otherwise 1.
        quantityOrdered:
          item.reorderPoint > 0 && item.quantityOnHand <= item.reorderPoint
            ? Math.max(1, item.quantityOnHand <= 0 ? item.reorderPoint : item.reorderPoint)
            : (asNumber(current?.quantityOrdered) || 1),
        // lastCost is only present for roles that may see cost — which is
        // every role that can reach this screen.
        unitCost: item.lastCost ?? item.averageCost ?? 0,
      });

      setStatus(
        item.sku +
          " added · " +
          formatQty(item.quantityOnHand) +
          " on hand, " +
          formatQty(item.quantityOnOrder) +
          " already on order",
      );

      if (index === getValues("lines").length - 1) {
        append(blankLine(getValues("lines").length + 1));
      }
    },
    [append, getValues, update],
  );

  const removeLine = React.useCallback(
    (index: number) => {
      const current = getValues(`lines.${index}`);
      if (current?.key) {
        const key = current.key;
        setLineMeta((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }
      if (fields.length === 1) {
        update(0, { ...blankLine(1), key: current?.key ?? newKey() });
        return;
      }
      remove(index);
    },
    [fields.length, getValues, remove, update],
  );

  async function submit(asDraft: boolean) {
    setFormError(null);
    setSaved(null);

    const values = getValues();
    const kept: PurchaseOrderLineValues[] = [];
    values.lines.forEach((line) => {
      if (isBlank(line)) return;
      kept.push({
        ...line,
        lineNo: kept.length + 1,
        quantityOrdered: asNumber(line.quantityOrdered),
        unitCost: asNumber(line.unitCost),
      });
    });

    if (!values.vendorId) {
      setError("vendorId", { message: "Select a vendor" });
      setFormError("Select a vendor for this purchase order.");
      return;
    }
    if (kept.length === 0) {
      setFormError("Add at least one line before saving.");
      return;
    }

    setSubmitting(true);
    setStatus("Saving purchase order...");
    try {
      const result = await createPurchaseOrder({
        ...values,
        freight: asNumber(values.freight),
        submit: !asDraft,
        lines: kept,
      });

      if (!result.ok) {
        setFormError(result.error);
        setStatus("Save failed");
        return;
      }
      setSaved({ id: result.data.id, poNumber: result.data.poNumber });
      setStatus(
        "Purchase order " + result.data.poNumber + " saved · " + formatMoney(result.data.total),
      );
      router.push("/dashboard/purchase-orders/" + result.data.id);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "The purchase order could not be saved.");
      setStatus("Save failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit(false);
      }}
      className="qb-window flex flex-col"
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
          e.preventDefault();
        }
      }}
    >
      <div className="qb-window-title qb-no-print">
        <span>Create Purchase Orders</span>
        <span className="font-normal text-white/80 text-qb">
          {vendor ? vendor.companyName : "No vendor selected"}
        </span>
      </div>

      <QbRibbon>
        <QbRibbonTab active>Main</QbRibbonTab>
        <QbRibbonTab>Formatting</QbRibbonTab>
        <QbRibbonTab>Reports</QbRibbonTab>
      </QbRibbon>

      <div className="bg-qb-ribbon border-b border-qb-ribbonLine px-1 py-1 flex flex-wrap qb-no-print">
        <QbRibbonGroup label="New">
          <QbButton
            size="sm"
            onClick={() => {
              reset(emptyForm());
              setLineMeta({});
              setSaved(null);
              setFormError(null);
              setStatus("New blank purchase order");
            }}
          >
            Blank PO
          </QbButton>
        </QbRibbonGroup>
        <QbRibbonGroup label="Save">
          <QbButton size="sm" variant="primary" disabled={submitting} onClick={() => void submit(false)}>
            {submitting ? "Saving..." : "Save & Issue"}
          </QbButton>
          <QbButton size="sm" disabled={submitting} onClick={() => void submit(true)}>
            Save as Draft
          </QbButton>
        </QbRibbonGroup>
        <QbRibbonGroup label="Lines">
          <QbButton size="sm" onClick={() => append(blankLine(fields.length + 1))}>
            + Line
          </QbButton>
        </QbRibbonGroup>
        <div className="ml-auto flex flex-col items-end justify-center px-2">
          <span className="text-qb-xs text-qb-inkMuted">Buyer</span>
          <span className="text-qb font-bold">
            {currentUser.fullName} ({currentUser.employeeCode})
          </span>
        </div>
      </div>

      <div className="px-2 pt-2 space-y-1 empty:hidden">
        {saved ? (
          <QbBanner variant="ok" title={"Purchase order " + saved.poNumber + " saved"} />
        ) : null}
        {formError ? (
          <QbBanner variant="err" onDismiss={() => setFormError(null)}>
            {formError}
          </QbBanner>
        ) : null}
      </div>

      <div className="p-2">
        <div className="border border-qb-line bg-white">
          <div className="flex flex-wrap items-start gap-x-6 gap-y-1 px-2 py-2 border-b border-qb-line bg-qb-chromeAlt">
            <div className="flex-1 min-w-[320px] space-y-1">
              <QbField
                label="Vendor"
                htmlFor="vendorId"
                labelWidth={78}
                required
                error={errors.vendorId?.message}
              >
                <QbSelect
                  id="vendorId"
                  {...register("vendorId")}
                  invalid={!!errors.vendorId}
                  className="max-w-[340px]"
                >
                  <option value="">-- select vendor --</option>
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.companyName} ({v.vendorNo})
                    </option>
                  ))}
                </QbSelect>
              </QbField>
              <QbField label="Ship Via" htmlFor="shipVia" labelWidth={78}>
                <QbInput
                  id="shipVia"
                  {...register("shipVia")}
                  className="max-w-[220px]"
                  placeholder="Vendor truck / LTL / will call"
                />
              </QbField>
              <QbField label="Memo" htmlFor="memo" labelWidth={78}>
                <QbInput id="memo" {...register("memo")} maxLength={500} />
              </QbField>
              {vendor?.termsName ? (
                <div className="text-qb text-qb-inkMuted pl-[86px]">
                  Terms on file: <strong>{vendor.termsName}</strong>
                </div>
              ) : null}
            </div>

            <div className="w-[270px] shrink-0 space-y-1">
              <QbField label="P.O. No." labelWidth={80}>
                <QbInput
                  readOnly
                  value={nextPoNumber}
                  className="max-w-[110px] font-qbMono"
                  title="Assigned when the purchase order is saved"
                />
              </QbField>
              <QbField
                label="Order Date"
                htmlFor="orderDate"
                labelWidth={80}
                error={errors.orderDate?.message}
              >
                <QbInput id="orderDate" type="date" {...register("orderDate")} className="max-w-[130px]" />
              </QbField>
              <QbField label="Expected" htmlFor="expectedDate" labelWidth={80}>
                <QbInput
                  id="expectedDate"
                  type="date"
                  {...register("expectedDate")}
                  className="max-w-[130px]"
                />
              </QbField>
            </div>
          </div>

          {/* Line grid */}
          <div className="overflow-x-auto">
            <table className="qb-grid min-w-[900px]">
              <thead>
                <tr>
                  <th style={{ width: 26 }}>#</th>
                  <th style={{ width: 128 }}>Item</th>
                  <th>Description</th>
                  <th style={{ width: 100 }}>Vendor Part</th>
                  <th style={{ width: 54 }} className="text-right">On Hand</th>
                  <th style={{ width: 54 }} className="text-right">Qty</th>
                  <th style={{ width: 80 }} className="text-right">Unit Cost</th>
                  <th style={{ width: 88 }} className="text-right">Amount</th>
                  <th style={{ width: 34 }}>&nbsp;</th>
                </tr>
              </thead>
              <tbody>
                {fields.map((field, index) => {
                  const row = calc.rows[index];
                  if (!row) return null;
                  const err = errors.lines?.[index];
                  const low =
                    row.meta &&
                    row.meta.reorderPoint > 0 &&
                    row.meta.onHand <= row.meta.reorderPoint;
                  return (
                    <tr key={field.id}>
                      <td className="text-center font-qbMono text-qb-inkMuted">{index + 1}</td>
                      <td className="p-0">
                        <div className="flex items-center">
                          <input
                            className="qb-cell-input font-qbMono cursor-pointer"
                            value={row.line.sku ?? ""}
                            placeholder="select..."
                            readOnly
                            onMouseDown={() => setItemLookup({ index })}
                            aria-label={"PO line " + (index + 1) + " item"}
                          />
                          <button
                            type="button"
                            className="qb-btn-icon shrink-0 h-[18px] w-[16px]"
                            onClick={() => setItemLookup({ index })}
                            aria-label={"Look up item for PO line " + (index + 1)}
                          >
                            <svg width="8" height="5" viewBox="0 0 8 5" aria-hidden="true">
                              <path fill="currentColor" d="M0 0h8L4 5z" />
                            </svg>
                          </button>
                        </div>
                      </td>
                      <td className="p-0">
                        <input
                          className={cn("qb-cell-input", err?.description && "qb-cell-input-err")}
                          placeholder="Description"
                          {...register(`lines.${index}.description`)}
                          aria-label={"PO line " + (index + 1) + " description"}
                        />
                      </td>
                      <td className="p-0">
                        <input
                          className="qb-cell-input font-qbMono"
                          {...register(`lines.${index}.vendorPartNo`)}
                          aria-label={"PO line " + (index + 1) + " vendor part number"}
                        />
                      </td>
                      <td
                        className={cn(
                          "qb-grid-num text-qb-inkMuted",
                          low && "text-qb-amber font-bold",
                        )}
                        title={low ? "At or below reorder point" : undefined}
                      >
                        {row.meta ? formatQty(row.meta.onHand) : ""}
                      </td>
                      <td className="p-0">
                        <input
                          className={cn(
                            "qb-cell-input qb-cell-input-num",
                            err?.quantityOrdered && "qb-cell-input-err",
                          )}
                          type="number"
                          step="0.01"
                          {...register(`lines.${index}.quantityOrdered`, { setValueAs: asNumber })}
                          aria-label={"PO line " + (index + 1) + " quantity"}
                        />
                      </td>
                      <td className="p-0">
                        <input
                          className={cn(
                            "qb-cell-input qb-cell-input-num",
                            err?.unitCost && "qb-cell-input-err",
                          )}
                          type="number"
                          step="0.0001"
                          {...register(`lines.${index}.unitCost`, { setValueAs: asNumber })}
                          aria-label={"PO line " + (index + 1) + " unit cost"}
                        />
                      </td>
                      <td className="qb-grid-num">{row.blank ? "" : formatMoney(row.amount)}</td>
                      <td className="text-center">
                        <button
                          type="button"
                          onClick={() => removeLine(index)}
                          className="text-qb-xs text-qb-red hover:underline"
                          aria-label={"Delete PO line " + (index + 1)}
                        >
                          del
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="border-t border-qb-line bg-qb-chromeAlt p-2 flex flex-wrap gap-4 justify-between items-start">
            <div className="text-qb-xs text-qb-inkMuted">
              {calc.liveCount} line{calc.liveCount === 1 ? "" : "s"}. Issuing this PO raises
              quantity-on-order; receiving against it raises quantity-on-hand and re-weights
              average cost.
            </div>
            <table className="qb-grid w-[250px] shrink-0">
              <tbody>
                <tr>
                  <td className="font-bold">Subtotal</td>
                  <td className="qb-grid-num w-[92px]">{formatMoney(calc.subtotal)}</td>
                </tr>
                <tr>
                  <td className="p-0 pl-1">
                    <label htmlFor="freight" className="qb-label">
                      Freight
                    </label>
                  </td>
                  <td className="p-0">
                    <input
                      id="freight"
                      className="qb-cell-input qb-cell-input-num"
                      type="number"
                      step="0.01"
                      {...register("freight", { setValueAs: asNumber })}
                    />
                  </td>
                </tr>
                <tr className="bg-qb-gridSelect">
                  <td className="font-bold text-qb-md">Total</td>
                  <td className="qb-grid-num font-bold text-qb-md">{formatMoney(calc.total)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="border-t border-qb-border bg-qb-chrome px-2 py-[6px] flex items-center gap-1 flex-wrap qb-no-print">
        <QbButton variant="primary" disabled={submitting} onClick={() => void submit(false)}>
          {submitting ? "Saving..." : "Save & Issue"}
        </QbButton>
        <QbButton disabled={submitting} onClick={() => void submit(true)}>
          Save as Draft
        </QbButton>
        <QbButton onClick={() => router.push("/dashboard/purchase-orders")}>Cancel</QbButton>
        <span className="ml-auto text-qb-xs text-qb-inkMuted" role="status">
          {status}
        </span>
      </div>

      <ItemLookupModal
        open={itemLookup !== null}
        onClose={() => setItemLookup(null)}
        canViewCost
        onSelect={(item) => {
          if (itemLookup) applyItem(itemLookup.index, item);
        }}
      />
    </form>
  );
}
