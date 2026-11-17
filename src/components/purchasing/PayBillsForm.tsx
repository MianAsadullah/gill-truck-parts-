"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { payBills } from "@/server/actions/bills";
import { formatMoney, round2, sumMoney } from "@/lib/money";
import { cn } from "@/lib/cn";
import {
  QbButton,
  QbField,
  QbInput,
  QbSelect,
  QbBanner,
  QbEmpty,
  QbRibbon,
  QbRibbonTab,
} from "@/components/qb/Ui";

/**
 * Pay Bills (ACC).
 *
 * QuickBooks' Pay Bills window: tick the bills to settle, adjust the amount
 * if you are part-paying, and the payment total follows. "Pay All" and
 * "Pay Overdue" are there because that is how the run is actually done —
 * nobody ticks forty rows individually at month end.
 */

export interface PayableBill {
  id: string;
  billNo: string;
  vendorId: string;
  vendorName: string;
  billDate: string;
  dueDate: string | null;
  daysOverdue: number;
  total: number;
  balanceDue: number;
}

export interface BankAccountOption {
  id: string;
  number: string;
  name: string;
}

const asNumber = (raw: string): number => {
  if (raw.trim() === "") return 0;
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

export function PayBillsForm({
  bills,
  bankAccounts,
}: {
  bills: PayableBill[];
  bankAccounts: BankAccountOption[];
}) {
  const router = useRouter();
  const [amounts, setAmounts] = React.useState<Record<string, string>>({});
  const [paymentDate, setPaymentDate] = React.useState(todayISO());
  const [bankAccountId, setBankAccountId] = React.useState(bankAccounts[0]?.id ?? "");
  const [method, setMethod] = React.useState<"CHECK" | "ACH" | "CREDIT_CARD" | "CASH" | "OTHER">(
    "CHECK",
  );
  const [referenceNo, setReferenceNo] = React.useState("");
  const [memo, setMemo] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const rows = bills.map((bill) => {
    const raw = amounts[bill.id] ?? "";
    const amount = round2(asNumber(raw));
    return {
      bill,
      raw,
      amount,
      over: amount > bill.balanceDue + 0.005,
      selected: amount > 0,
    };
  });

  const selected = rows.filter((r) => r.selected);
  const total = sumMoney(selected.map((r) => r.amount));
  const anyOver = rows.some((r) => r.over);
  const vendorCount = new Set(selected.map((r) => r.bill.vendorId)).size;

  function setAll(predicate: (b: PayableBill) => boolean) {
    const next: Record<string, string> = {};
    for (const bill of bills) {
      if (predicate(bill)) next[bill.id] = bill.balanceDue.toFixed(2);
    }
    setAmounts(next);
  }

  async function submit() {
    setError(null);
    setDone(null);

    if (!bankAccountId) {
      setError("Choose the account to pay from.");
      return;
    }
    if (selected.length === 0) {
      setError("Enter an amount to pay on at least one bill.");
      return;
    }
    if (anyOver) {
      setError("One or more amounts exceed what is outstanding on the bill.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await payBills({
        paymentDate,
        bankAccountId,
        method,
        referenceNo: referenceNo || null,
        memo: memo || null,
        payments: selected.map((r) => ({ billId: r.bill.id, amount: r.amount })),
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      setDone(
        "Paid " +
          formatMoney(result.data.amount) +
          " across " +
          result.data.billCount +
          " bill" +
          (result.data.billCount === 1 ? "" : "s") +
          ".",
      );
      setAmounts({});
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The payment could not be posted.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="qb-window flex flex-col">
      <div className="qb-window-title qb-no-print">
        <span>Pay Bills</span>
        <span className="font-normal text-white/80 text-qb">
          {selected.length} selected &middot; {formatMoney(total)}
        </span>
      </div>

      <QbRibbon>
        <QbRibbonTab active>Pay Bills</QbRibbonTab>
      </QbRibbon>

      <div className="px-2 pt-2 space-y-1 empty:hidden">
        {done ? <QbBanner variant="ok" title="Payment posted">{done}</QbBanner> : null}
        {error ? (
          <QbBanner variant="err" onDismiss={() => setError(null)}>
            {error}
          </QbBanner>
        ) : null}
        {vendorCount > 1 ? (
          <QbBanner variant="warn">
            This run covers {vendorCount} vendors. Each will get its own payment document
            and its own ledger entry.
          </QbBanner>
        ) : null}
      </div>

      <div className="p-2 space-y-2">
        <div className="border border-qb-line bg-qb-chromeAlt p-2 flex flex-wrap gap-6 items-start">
          <div className="space-y-1">
            <QbField label="Pay From" labelWidth={84} required>
              <QbSelect
                value={bankAccountId}
                onChange={(e) => setBankAccountId(e.target.value)}
                className="max-w-[240px]"
              >
                {bankAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.number} &mdash; {a.name}
                  </option>
                ))}
              </QbSelect>
            </QbField>
            <QbField label="Date" labelWidth={84}>
              <QbInput
                type="date"
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
                className="max-w-[140px]"
              />
            </QbField>
          </div>
          <div className="space-y-1">
            <QbField label="Method" labelWidth={78}>
              <QbSelect
                value={method}
                onChange={(e) => setMethod(e.target.value as typeof method)}
                className="max-w-[160px]"
              >
                <option value="CHECK">Check</option>
                <option value="ACH">ACH / Transfer</option>
                <option value="CREDIT_CARD">Credit Card</option>
                <option value="CASH">Cash</option>
                <option value="OTHER">Other</option>
              </QbSelect>
            </QbField>
            <QbField label="Ref / Check" labelWidth={78}>
              <QbInput
                value={referenceNo}
                onChange={(e) => setReferenceNo(e.target.value)}
                className="max-w-[140px] font-qbMono"
              />
            </QbField>
          </div>
          <div className="flex-1 min-w-[220px] space-y-1">
            <QbField label="Memo" labelWidth={54}>
              <QbInput value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={500} />
            </QbField>
            <div className="flex gap-1 pt-1">
              <QbButton size="sm" onClick={() => setAll(() => true)}>
                Pay All
              </QbButton>
              <QbButton size="sm" onClick={() => setAll((b) => b.daysOverdue > 0)}>
                Pay Overdue
              </QbButton>
              <QbButton size="sm" onClick={() => setAmounts({})}>
                Clear
              </QbButton>
            </div>
          </div>
        </div>

        <div className="border border-qb-line bg-white">
          {bills.length === 0 ? (
            <QbEmpty>No bills are outstanding.</QbEmpty>
          ) : (
            <table className="qb-grid">
              <thead>
                <tr>
                  <th style={{ width: 90 }}>Invoice No.</th>
                  <th>Vendor</th>
                  <th style={{ width: 80 }}>Bill Date</th>
                  <th style={{ width: 80 }}>Due</th>
                  <th style={{ width: 60 }} className="text-right">Overdue</th>
                  <th style={{ width: 96 }} className="text-right">Amount Due</th>
                  <th style={{ width: 100 }} className="text-right">Payment</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ bill, raw, over, selected: isSel }) => (
                  <tr
                    key={bill.id}
                    className={cn(over && "bg-qb-errBg", isSel && !over && "bg-qb-gridSelect")}
                  >
                    <td className="font-qbMono">{bill.billNo}</td>
                    <td className="truncate">{bill.vendorName}</td>
                    <td className="font-qbMono text-qb-xs">{bill.billDate}</td>
                    <td className="font-qbMono text-qb-xs">{bill.dueDate ?? ""}</td>
                    <td
                      className={cn(
                        "qb-grid-num",
                        bill.daysOverdue > 30
                          ? "text-qb-red font-bold"
                          : bill.daysOverdue > 0
                            ? "text-qb-amber"
                            : "text-qb-inkDisabled",
                      )}
                    >
                      {bill.daysOverdue > 0 ? bill.daysOverdue + "d" : ""}
                    </td>
                    <td className="qb-grid-num">{formatMoney(bill.balanceDue)}</td>
                    <td className="p-0">
                      <input
                        className={cn(
                          "qb-cell-input qb-cell-input-num",
                          over && "qb-cell-input-err",
                        )}
                        type="number"
                        step="0.01"
                        min="0"
                        value={raw}
                        placeholder="0.00"
                        onChange={(e) =>
                          setAmounts((prev) => ({ ...prev, [bill.id]: e.target.value }))
                        }
                        aria-label={"Payment amount for bill " + bill.billNo}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-qb-grid-header font-bold">
                  <td colSpan={6} className="border border-qb-gridLine px-1 text-right">
                    Total to pay ({selected.length} bill{selected.length === 1 ? "" : "s"})
                  </td>
                  <td className="border border-qb-gridLine px-1 qb-grid-num">
                    {formatMoney(total)}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>

      <div className="border-t border-qb-border bg-qb-chrome px-2 py-[6px] flex items-center gap-1 qb-no-print">
        <QbButton
          variant="primary"
          disabled={submitting || selected.length === 0 || anyOver}
          onClick={() => void submit()}
        >
          {submitting ? "Posting..." : "Pay Selected Bills"}
        </QbButton>
        <QbButton onClick={() => router.push("/dashboard/bills")}>Close</QbButton>
        <span className="ml-auto text-qb-xs text-qb-inkMuted">
          Posts DR Accounts Payable / CR the account above.
        </span>
      </div>
    </div>
  );
}
