"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { createBill } from "@/server/actions/bills";
import { extend, formatMoney, round2, sumMoney } from "@/lib/money";
import {
  QbButton,
  QbField,
  QbInput,
  QbSelect,
  QbBanner,
  QbFieldset,
  QbRibbon,
  QbRibbonTab,
} from "@/components/qb/Ui";

/**
 * Enter Bills (PUR).
 *
 * Two shapes in one window, which is exactly how QuickBooks does it:
 *
 *   ITEM RECEIPT BILL — the buyer picks an unbilled receipt and keys the
 *     vendor's invoice number and terms. The amount is fixed at the receipt
 *     value and the lines are read-only, because the inventory and the
 *     liability were already posted when the parts arrived. Re-keying prices
 *     here would create a second liability for the same goods.
 *
 *   EXPENSE BILL — rent, freight, shop supplies. Free-form lines coded to
 *     expense accounts, which post DR expense / CR Accounts Payable.
 */

export interface UnbilledReceipt {
  id: string;
  receiptNo: string;
  receivedDate: string;
  poNumber: string;
  vendorId: string;
  vendorName: string;
  total: number;
  lines: { description: string; quantity: number; unitCost: number; amount: number }[];
}

export interface AccountOption {
  id: string;
  number: string;
  name: string;
}

export interface BillVendorOption {
  id: string;
  companyName: string;
  termsId: string | null;
}

interface ExpenseLine {
  key: string;
  accountId: string;
  description: string;
  quantity: string;
  unitCost: string;
}

const asNumber = (raw: unknown): number => {
  if (raw === "" || raw === null || raw === undefined) return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
};

function newKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return "bl-" + Math.random().toString(36).slice(2);
  }
}

function blankExpense(): ExpenseLine {
  return { key: newKey(), accountId: "", description: "", quantity: "1", unitCost: "" };
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

export function BillForm({
  vendors,
  expenseAccounts,
  terms,
  unbilledReceipts,
  preselectedReceiptId,
}: {
  vendors: BillVendorOption[];
  expenseAccounts: AccountOption[];
  terms: { id: string; name: string }[];
  unbilledReceipts: UnbilledReceipt[];
  preselectedReceiptId: string | null;
}) {
  const router = useRouter();

  const preselected = unbilledReceipts.find((r) => r.id === preselectedReceiptId) ?? null;

  const [mode, setMode] = React.useState<"receipt" | "expense">(
    preselected ? "receipt" : unbilledReceipts.length > 0 ? "receipt" : "expense",
  );
  const [receiptId, setReceiptId] = React.useState(preselected?.id ?? "");
  const [vendorId, setVendorId] = React.useState(preselected?.vendorId ?? "");
  const [billNo, setBillNo] = React.useState("");
  const [billDate, setBillDate] = React.useState(todayISO());
  const [dueDate, setDueDate] = React.useState("");
  const [termsId, setTermsId] = React.useState("");
  const [memo, setMemo] = React.useState("");
  const [lines, setLines] = React.useState<ExpenseLine[]>([blankExpense()]);
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const receipt = unbilledReceipts.find((r) => r.id === receiptId) ?? null;

  // Selecting a receipt dictates the vendor — a bill cannot settle another
  // company's delivery.
  React.useEffect(() => {
    if (mode === "receipt" && receipt) setVendorId(receipt.vendorId);
  }, [mode, receipt]);

  const expenseTotal = sumMoney(
    lines.map((l) => extend(asNumber(l.quantity) || 1, asNumber(l.unitCost))),
  );
  const total = mode === "receipt" ? (receipt?.total ?? 0) : round2(expenseTotal);

  async function submit() {
    setError(null);

    if (mode === "receipt" && !receipt) {
      setError("Select the item receipt this bill is for.");
      return;
    }
    if (!vendorId) {
      setError("Select a vendor.");
      return;
    }
    if (!billNo.trim()) {
      setError("Enter the vendor's invoice number.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await createBill({
        vendorId,
        billNo: billNo.trim(),
        billDate,
        dueDate: dueDate || null,
        termsId: termsId || null,
        memo: memo || null,
        receiptId: mode === "receipt" ? receiptId : null,
        lines:
          mode === "receipt"
            ? []
            : lines
                .filter((l) => l.description.trim() || asNumber(l.unitCost) !== 0)
                .map((l, index) => ({
                  key: l.key,
                  lineNo: index + 1,
                  accountId: l.accountId || null,
                  description: l.description.trim(),
                  quantity: asNumber(l.quantity) || 1,
                  unitCost: asNumber(l.unitCost),
                })),
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push("/dashboard/bills");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The bill could not be saved.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="qb-window flex flex-col">
      <div className="qb-window-title qb-no-print">
        <span>Enter Bills</span>
        <span className="font-normal text-white/80 text-qb">
          {vendors.find((v) => v.id === vendorId)?.companyName ?? "No vendor selected"}
        </span>
      </div>

      <QbRibbon>
        <QbRibbonTab active>Main</QbRibbonTab>
      </QbRibbon>

      <div className="bg-qb-ribbon border-b border-qb-ribbonLine px-2 py-1 flex gap-4 qb-no-print">
        <label className="flex items-center gap-1 text-qb">
          <input
            type="radio"
            name="billmode"
            checked={mode === "receipt"}
            onChange={() => setMode("receipt")}
            disabled={unbilledReceipts.length === 0}
          />
          Bill against an item receipt
          <span className="text-qb-xs text-qb-inkMuted">
            ({unbilledReceipts.length} waiting)
          </span>
        </label>
        <label className="flex items-center gap-1 text-qb">
          <input
            type="radio"
            name="billmode"
            checked={mode === "expense"}
            onChange={() => setMode("expense")}
          />
          Expense bill (no inventory)
        </label>
      </div>

      <div className="px-2 pt-2 space-y-1 empty:hidden">
        {error ? (
          <QbBanner variant="err" onDismiss={() => setError(null)}>
            {error}
          </QbBanner>
        ) : null}
        {mode === "receipt" && receipt ? (
          <QbBanner variant="warn" title="This bill will not post to the ledger again">
            Receiving {receipt.receiptNo} already posted DR Inventory Asset / CR Accounts
            Payable. This bill records the vendor&rsquo;s invoice number and due date against
            that existing liability.
          </QbBanner>
        ) : null}
        {mode === "receipt" && unbilledReceipts.length === 0 ? (
          <QbBanner variant="warn">
            Nothing has been received that is still waiting for a vendor invoice. Switch to
            an expense bill, or receive against a purchase order first.
          </QbBanner>
        ) : null}
      </div>

      <div className="p-2 space-y-2">
        <div className="border border-qb-line bg-qb-chromeAlt p-2 flex flex-wrap gap-6">
          <div className="space-y-1 min-w-[340px] flex-1">
            {mode === "receipt" ? (
              <QbField label="Item Receipt" labelWidth={90} required>
                <QbSelect
                  value={receiptId}
                  onChange={(e) => setReceiptId(e.target.value)}
                  className="max-w-[420px]"
                >
                  <option value="">-- select a receipt --</option>
                  {unbilledReceipts.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.receiptNo} &middot; {r.vendorName} &middot; {r.poNumber} &middot;{" "}
                      {formatMoney(r.total)} &middot; {r.receivedDate}
                    </option>
                  ))}
                </QbSelect>
              </QbField>
            ) : null}

            <QbField label="Vendor" labelWidth={90} required>
              <QbSelect
                value={vendorId}
                onChange={(e) => {
                  setVendorId(e.target.value);
                  const v = vendors.find((x) => x.id === e.target.value);
                  if (v?.termsId) setTermsId(v.termsId);
                }}
                className="max-w-[300px]"
                disabled={mode === "receipt" && !!receipt}
              >
                <option value="">-- select vendor --</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.companyName}
                  </option>
                ))}
              </QbSelect>
            </QbField>

            <QbField label="Memo" labelWidth={90}>
              <QbInput value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={500} />
            </QbField>
          </div>

          <div className="space-y-1 w-[290px]">
            <QbField label="Invoice No." labelWidth={88} required>
              <QbInput
                value={billNo}
                onChange={(e) => setBillNo(e.target.value)}
                className="max-w-[160px] font-qbMono"
                placeholder="vendor's number"
              />
            </QbField>
            <QbField label="Bill Date" labelWidth={88}>
              <QbInput
                type="date"
                value={billDate}
                onChange={(e) => setBillDate(e.target.value)}
                className="max-w-[140px]"
              />
            </QbField>
            <QbField label="Terms" labelWidth={88}>
              <QbSelect
                value={termsId}
                onChange={(e) => setTermsId(e.target.value)}
                className="max-w-[160px]"
              >
                <option value="">-- none --</option>
                {terms.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </QbSelect>
            </QbField>
            <QbField
              label="Due Date"
              labelWidth={88}
              hint="Left blank, this is worked out from the terms."
            >
              <QbInput
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="max-w-[140px]"
              />
            </QbField>
          </div>
        </div>

        {mode === "receipt" ? (
          receipt ? (
            <QbFieldset legend={"Received on " + receipt.receiptNo + " (read-only)"}>
              <table className="qb-grid bg-white">
                <thead>
                  <tr>
                    <th>Description</th>
                    <th style={{ width: 70 }} className="text-right">Qty</th>
                    <th style={{ width: 90 }} className="text-right">Unit Cost</th>
                    <th style={{ width: 100 }} className="text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {receipt.lines.map((l, i) => (
                    <tr key={i}>
                      <td>{l.description}</td>
                      <td className="qb-grid-num">{l.quantity}</td>
                      <td className="qb-grid-num">{formatMoney(l.unitCost)}</td>
                      <td className="qb-grid-num">{formatMoney(l.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </QbFieldset>
          ) : null
        ) : (
          <QbFieldset legend="Expenses">
            <table className="qb-grid bg-white">
              <thead>
                <tr>
                  <th style={{ width: 230 }}>Account</th>
                  <th>Description / Memo</th>
                  <th style={{ width: 60 }} className="text-right">Qty</th>
                  <th style={{ width: 90 }} className="text-right">Amount Each</th>
                  <th style={{ width: 96 }} className="text-right">Amount</th>
                  <th style={{ width: 34 }}>&nbsp;</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, index) => (
                  <tr key={line.key}>
                    <td className="p-0">
                      <select
                        className="qb-cell-input"
                        value={line.accountId}
                        onChange={(e) =>
                          setLines((prev) =>
                            prev.map((l, i) =>
                              i === index ? { ...l, accountId: e.target.value } : l,
                            ),
                          )
                        }
                        aria-label={"Expense account for line " + (index + 1)}
                      >
                        <option value="">-- account --</option>
                        {expenseAccounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.number} {a.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="p-0">
                      <input
                        className="qb-cell-input"
                        value={line.description}
                        onChange={(e) =>
                          setLines((prev) =>
                            prev.map((l, i) =>
                              i === index ? { ...l, description: e.target.value } : l,
                            ),
                          )
                        }
                        aria-label={"Description for line " + (index + 1)}
                      />
                    </td>
                    <td className="p-0">
                      <input
                        className="qb-cell-input qb-cell-input-num"
                        type="number"
                        step="0.01"
                        value={line.quantity}
                        onChange={(e) =>
                          setLines((prev) =>
                            prev.map((l, i) =>
                              i === index ? { ...l, quantity: e.target.value } : l,
                            ),
                          )
                        }
                        aria-label={"Quantity for line " + (index + 1)}
                      />
                    </td>
                    <td className="p-0">
                      <input
                        className="qb-cell-input qb-cell-input-num"
                        type="number"
                        step="0.01"
                        value={line.unitCost}
                        onChange={(e) =>
                          setLines((prev) =>
                            prev.map((l, i) =>
                              i === index ? { ...l, unitCost: e.target.value } : l,
                            ),
                          )
                        }
                        aria-label={"Amount for line " + (index + 1)}
                      />
                    </td>
                    <td className="qb-grid-num">
                      {formatMoney(
                        extend(asNumber(line.quantity) || 1, asNumber(line.unitCost)),
                      )}
                    </td>
                    <td className="text-center">
                      <button
                        type="button"
                        className="text-qb-xs text-qb-red hover:underline"
                        onClick={() =>
                          setLines((prev) =>
                            prev.length === 1
                              ? [blankExpense()]
                              : prev.filter((_, i) => i !== index),
                          )
                        }
                      >
                        del
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <QbButton
              size="sm"
              className="mt-1"
              onClick={() => setLines((prev) => [...prev, blankExpense()])}
            >
              + Expense Line
            </QbButton>
          </QbFieldset>
        )}

        <div className="flex justify-end">
          <table className="qb-grid w-[260px]">
            <tbody>
              <tr className="bg-qb-gridSelect">
                <td className="font-bold text-qb-md">Amount Due</td>
                <td className="qb-grid-num font-bold text-qb-md w-[110px]">
                  {formatMoney(total)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="border-t border-qb-border bg-qb-chrome px-2 py-[6px] flex items-center gap-1 qb-no-print">
        <QbButton variant="primary" disabled={submitting} onClick={() => void submit()}>
          {submitting ? "Saving..." : "Save Bill"}
        </QbButton>
        <QbButton onClick={() => router.push("/dashboard/bills")}>Cancel</QbButton>
      </div>
    </div>
  );
}
