"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { adjustInventory } from "@/server/actions/items";
import { extend, formatMoney, formatQty, round2, round4 } from "@/lib/money";
import { cn } from "@/lib/cn";
import {
  QbButton,
  QbField,
  QbInput,
  QbSelect,
  QbBanner,
  QbRibbon,
  QbRibbonTab,
  QbEmpty,
} from "@/components/qb/Ui";
import { ItemLookupModal } from "@/components/invoices/ItemLookupModal";
import type { ProductSearchItem } from "@/types/dto";

/**
 * Adjust Quantity on Hand (INV).
 *
 * The clerk enters the COUNTED quantity, not a delta — that is what the
 * person holding the clipboard actually knows, and making them subtract in
 * their head is how miscounts get entered. The difference and its value are
 * computed and shown before posting, and the value difference goes to
 * Inventory Shrinkage so a write-off lands on the P&L rather than quietly
 * disappearing off the balance sheet.
 *
 * Cost is visible on this screen by necessity (an adjustment has a dollar
 * value), which is why it sits behind inventory.adjust — a permission the
 * counter role does not hold.
 */

interface Row {
  product: ProductSearchItem;
  /** Raw input text so the field can be cleared while typing. */
  counted: string;
}

const REASONS = [
  "Annual physical count",
  "Cycle count correction",
  "Damaged / unsellable",
  "Warranty return to vendor",
  "Shop use / internal consumption",
  "Theft or shrinkage",
  "Receiving error correction",
];

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

export function AdjustForm({ canViewCost }: { canViewCost: boolean }) {
  const router = useRouter();
  const [rows, setRows] = React.useState<Row[]>([]);
  const [lookupOpen, setLookupOpen] = React.useState(false);
  const [adjustmentDate, setAdjustmentDate] = React.useState(todayISO());
  const [reason, setReason] = React.useState(REASONS[0]);
  const [customReason, setCustomReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const effectiveReason = reason === "__other" ? customReason.trim() : reason;

  const calc = React.useMemo(() => {
    const computed = rows.map((row) => {
      const onHand = row.product.quantityOnHand;
      const counted = row.counted.trim() === "" ? null : Number(row.counted);
      const valid = counted !== null && Number.isFinite(counted);
      const delta = valid ? round4(counted - onHand) : 0;
      const unitCost = row.product.averageCost ?? 0;
      return {
        row,
        onHand,
        counted,
        valid,
        delta,
        unitCost,
        value: round2(extend(delta, unitCost)),
      };
    });
    const changed = computed.filter((c) => c.valid && c.delta !== 0);
    return {
      computed,
      changedCount: changed.length,
      totalValue: round2(changed.reduce((s, c) => s + c.value, 0)),
      anyInvalid: computed.some((c) => !c.valid),
    };
  }, [rows]);

  function addProduct(item: ProductSearchItem) {
    if (item.type !== "INVENTORY") {
      setError(item.sku + " is not a stocked item, so it has no quantity to adjust.");
      return;
    }
    if (rows.some((r) => r.product.id === item.id)) {
      setError(item.sku + " is already on this adjustment.");
      return;
    }
    setError(null);
    setRows((prev) => [...prev, { product: item, counted: String(item.quantityOnHand) }]);
  }

  async function submit() {
    setError(null);
    setDone(null);

    if (calc.changedCount === 0) {
      setError("No counted quantity differs from the system. Nothing to post.");
      return;
    }
    if (effectiveReason.length < 4) {
      setError("Enter a reason for this adjustment.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await adjustInventory({
        adjustmentDate,
        reason: effectiveReason,
        lines: calc.computed
          .filter((c) => c.valid)
          .map((c) => ({ productId: c.row.product.id, newQuantity: c.counted as number })),
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      setDone(
        "Adjusted " +
          result.data.lines +
          " item" +
          (result.data.lines === 1 ? "" : "s") +
          ". Inventory value changed by " +
          formatMoney(result.data.valueChange) +
          ".",
      );
      setRows([]);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The adjustment could not be posted.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="qb-window flex flex-col">
      <div className="qb-window-title qb-no-print">
        <span>Adjust Quantity on Hand</span>
        <span className="font-normal text-white/80 text-qb">
          {rows.length} item{rows.length === 1 ? "" : "s"}
        </span>
      </div>

      <QbRibbon>
        <QbRibbonTab active>Adjust Quantity</QbRibbonTab>
      </QbRibbon>

      <div className="px-2 pt-2 space-y-1 empty:hidden">
        {done ? <QbBanner variant="ok" title="Adjustment posted">{done}</QbBanner> : null}
        {error ? (
          <QbBanner variant="err" onDismiss={() => setError(null)}>
            {error}
          </QbBanner>
        ) : null}
      </div>

      <div className="p-2 space-y-2">
        <div className="border border-qb-line bg-qb-chromeAlt p-2 flex flex-wrap gap-4 items-start">
          <QbField label="Date" htmlFor="adjDate" labelWidth={60}>
            <QbInput
              id="adjDate"
              type="date"
              value={adjustmentDate}
              onChange={(e) => setAdjustmentDate(e.target.value)}
              className="max-w-[140px]"
            />
          </QbField>
          <div className="flex-1 min-w-[320px]">
            <QbField label="Reason" htmlFor="adjReason" labelWidth={60} required>
              <QbSelect
                id="adjReason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="max-w-[300px]"
              >
                {REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
                <option value="__other">Other (type below)...</option>
              </QbSelect>
            </QbField>
            {reason === "__other" ? (
              <QbField label="" labelWidth={60} className="pt-1">
                <QbInput
                  value={customReason}
                  onChange={(e) => setCustomReason(e.target.value)}
                  placeholder="Describe the reason"
                  maxLength={280}
                />
              </QbField>
            ) : null}
          </div>
          <QbButton onClick={() => setLookupOpen(true)}>+ Add Item</QbButton>
        </div>

        <div className="border border-qb-line bg-white">
          {rows.length === 0 ? (
            <QbEmpty>
              No items yet. Use <strong>+ Add Item</strong> to look up the parts you counted.
            </QbEmpty>
          ) : (
            <table className="qb-grid">
              <thead>
                <tr>
                  <th style={{ width: 120 }}>Item</th>
                  <th>Description</th>
                  <th style={{ width: 46 }}>Bin</th>
                  <th style={{ width: 70 }} className="text-right">System</th>
                  <th style={{ width: 80 }} className="text-right">Counted</th>
                  <th style={{ width: 70 }} className="text-right">Difference</th>
                  {canViewCost ? (
                    <>
                      <th style={{ width: 72 }} className="text-right">Unit Cost</th>
                      <th style={{ width: 90 }} className="text-right">Value Change</th>
                    </>
                  ) : null}
                  <th style={{ width: 34 }}>&nbsp;</th>
                </tr>
              </thead>
              <tbody>
                {calc.computed.map((c, index) => (
                  <tr
                    key={c.row.product.id}
                    className={cn(
                      c.delta < 0 && "bg-qb-errBg",
                      c.delta > 0 && "bg-qb-okBg",
                      !c.valid && "bg-qb-warnBg",
                    )}
                  >
                    <td className="font-qbMono">{c.row.product.sku}</td>
                    <td className="truncate" title={c.row.product.description}>
                      {c.row.product.description}
                    </td>
                    <td className="text-qb-xs">{c.row.product.binLocation ?? ""}</td>
                    <td className="qb-grid-num text-qb-inkMuted">{formatQty(c.onHand)}</td>
                    <td className="p-0">
                      <input
                        className="qb-cell-input qb-cell-input-num"
                        type="number"
                        step="0.01"
                        value={c.row.counted}
                        onChange={(e) =>
                          setRows((prev) =>
                            prev.map((r, i) =>
                              i === index ? { ...r, counted: e.target.value } : r,
                            ),
                          )
                        }
                        aria-label={"Counted quantity for " + c.row.product.sku}
                      />
                    </td>
                    <td
                      className={cn(
                        "qb-grid-num font-bold",
                        c.delta < 0 && "text-qb-red",
                        c.delta > 0 && "text-qb-greenDark",
                      )}
                    >
                      {!c.valid ? "?" : c.delta === 0 ? "—" : formatQty(c.delta)}
                    </td>
                    {canViewCost ? (
                      <>
                        <td className="qb-grid-num text-qb-inkMuted">
                          {formatMoney(c.unitCost)}
                        </td>
                        <td
                          className={cn(
                            "qb-grid-num",
                            c.value < 0 && "text-qb-red font-bold",
                          )}
                        >
                          {c.delta === 0 ? "" : formatMoney(c.value)}
                        </td>
                      </>
                    ) : null}
                    <td className="text-center">
                      <button
                        type="button"
                        onClick={() =>
                          setRows((prev) => prev.filter((_, i) => i !== index))
                        }
                        className="text-qb-xs text-qb-red hover:underline"
                        aria-label={"Remove " + c.row.product.sku}
                      >
                        del
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-qb-grid-header font-bold">
                  <td
                    colSpan={canViewCost ? 7 : 5}
                    className="border border-qb-gridLine px-1 text-right"
                  >
                    {calc.changedCount} item{calc.changedCount === 1 ? "" : "s"} changing
                    {canViewCost ? " · total value change" : ""}
                  </td>
                  {canViewCost ? (
                    <td className="border border-qb-gridLine px-1 qb-grid-num">
                      {formatMoney(calc.totalValue)}
                    </td>
                  ) : null}
                  <td className="border border-qb-gridLine" />
                </tr>
              </tfoot>
            </table>
          )}
        </div>

        {canViewCost && calc.totalValue !== 0 ? (
          <div className="text-qb-xs text-qb-inkMuted">
            Posts{" "}
            {calc.totalValue < 0
              ? "DR Inventory Shrinkage / CR Inventory Asset"
              : "DR Inventory Asset / CR Inventory Shrinkage"}{" "}
            for {formatMoney(Math.abs(calc.totalValue))}.
          </div>
        ) : null}
      </div>

      <div className="border-t border-qb-border bg-qb-chrome px-2 py-[6px] flex items-center gap-1 qb-no-print">
        <QbButton
          variant="primary"
          disabled={submitting || calc.changedCount === 0}
          onClick={() => void submit()}
        >
          {submitting ? "Posting..." : "Post Adjustment"}
        </QbButton>
        <QbButton onClick={() => router.push("/dashboard/items")}>Close</QbButton>
        <span className="ml-auto text-qb-xs text-qb-inkMuted">
          Enter the quantity you counted. The difference is worked out for you.
        </span>
      </div>

      <ItemLookupModal
        open={lookupOpen}
        onClose={() => setLookupOpen(false)}
        canViewCost={canViewCost}
        onSelect={addProduct}
      />
    </div>
  );
}
