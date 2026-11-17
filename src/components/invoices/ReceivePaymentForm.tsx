"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { receiveCustomerPayment } from "@/server/actions/payments";
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
import { CustomerLookupModal } from "./CustomerLookupModal";
import type { CustomerSearchItem } from "@/types/dto";

/**
 * Receive Payments (SAL).
 *
 * QuickBooks' Receive Payments window. The clerk picks the customer, types
 * what the cheque is for, and the open invoices appear. "Auto Apply" walks
 * the invoices oldest-first — which is both what customers expect and what
 * keeps the aging honest.
 *
 * Anything left over is parked as an unapplied credit rather than refused:
 * a fleet customer paying a round number against a statement is routine.
 */

export interface OpenInvoice {
  id: string;
  invoiceNo: string;
  invoiceDate: string;
  dueDate: string | null;
  total: number;
  balanceDue: number;
  daysOverdue: number;
}

export interface DepositAccountOption {
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

export function ReceivePaymentForm({
  depositAccounts,
}: {
  depositAccounts: DepositAccountOption[];
}) {
  const router = useRouter();

  const [customer, setCustomer] = React.useState<CustomerSearchItem | null>(null);
  const [lookupOpen, setLookupOpen] = React.useState(false);
  const [invoices, setInvoices] = React.useState<OpenInvoice[]>([]);
  const [loadingInvoices, setLoadingInvoices] = React.useState(false);
  const [applied, setApplied] = React.useState<Record<string, string>>({});

  const [paymentDate, setPaymentDate] = React.useState(todayISO());
  const [method, setMethod] = React.useState<
    "CASH" | "CHECK" | "CREDIT_CARD" | "ACH" | "STORE_CREDIT" | "OTHER"
  >("CHECK");
  const [referenceNo, setReferenceNo] = React.useState("");
  const [depositAccountId, setDepositAccountId] = React.useState(
    depositAccounts[0]?.id ?? "",
  );
  const [amountRaw, setAmountRaw] = React.useState("");
  const [memo, setMemo] = React.useState("");

  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const amount = round2(asNumber(amountRaw));

  // Pull the customer's open invoices whenever they change.
  React.useEffect(() => {
    if (!customer) {
      setInvoices([]);
      setApplied({});
      return;
    }
    const controller = new AbortController();
    setLoadingInvoices(true);
    fetch("/api/customers/" + customer.id + "/open-invoices", { signal: controller.signal })
      .then((r) => r.json())
      .then((json: { invoices: OpenInvoice[] }) => {
        setInvoices(json.invoices ?? []);
        setApplied({});
      })
      .catch((err) => {
        if ((err as Error).name !== "AbortError") setInvoices([]);
      })
      .finally(() => setLoadingInvoices(false));
    return () => controller.abort();
  }, [customer]);

  const rows = invoices.map((inv) => {
    const raw = applied[inv.id] ?? "";
    const value = round2(asNumber(raw));
    return { inv, raw, value, over: value > inv.balanceDue + 0.005 };
  });

  const appliedTotal = sumMoney(rows.map((r) => r.value));
  const unapplied = round2(amount - appliedTotal);
  const overApplied = appliedTotal > amount + 0.005;
  const anyOver = rows.some((r) => r.over);

  /** Walk the invoices oldest-first, consuming the payment as it goes. */
  function autoApply() {
    let remaining = amount;
    const next: Record<string, string> = {};
    for (const inv of [...invoices].sort((a, b) =>
      a.invoiceDate.localeCompare(b.invoiceDate),
    )) {
      if (remaining <= 0.005) break;
      const take = Math.min(remaining, inv.balanceDue);
      if (take > 0) {
        next[inv.id] = take.toFixed(2);
        remaining = round2(remaining - take);
      }
    }
    setApplied(next);
  }

  async function submit() {
    setError(null);
    setDone(null);

    if (!customer) {
      setError("Select a customer.");
      return;
    }
    if (amount <= 0) {
      setError("Enter the amount received.");
      return;
    }
    if (overApplied) {
      setError("You have applied more than the amount received.");
      return;
    }
    if (anyOver) {
      setError("An applied amount exceeds what is outstanding on that invoice.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await receiveCustomerPayment({
        customerId: customer.id,
        paymentDate,
        method,
        referenceNo: referenceNo || null,
        depositAccountId,
        memo: memo || null,
        amount,
        applications: rows
          .filter((r) => r.value > 0)
          .map((r) => ({ invoiceId: r.inv.id, amount: r.value })),
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      setDone(
        "Payment " +
          result.data.paymentNo +
          " posted. Applied " +
          formatMoney(result.data.applied) +
          (result.data.unapplied > 0
            ? ", " + formatMoney(result.data.unapplied) + " left on account."
            : "."),
      );
      setAmountRaw("");
      setApplied({});
      setReferenceNo("");
      setCustomer(null);
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
        <span>Receive Payments</span>
        <span className="font-normal text-white/80 text-qb">
          {customer ? customer.companyName : "No customer selected"}
        </span>
      </div>

      <QbRibbon>
        <QbRibbonTab active>Main</QbRibbonTab>
      </QbRibbon>

      <div className="px-2 pt-2 space-y-1 empty:hidden">
        {done ? <QbBanner variant="ok" title="Payment received">{done}</QbBanner> : null}
        {error ? (
          <QbBanner variant="err" onDismiss={() => setError(null)}>
            {error}
          </QbBanner>
        ) : null}
        {overApplied ? (
          <QbBanner variant="err" title="Over-applied">
            You have applied {formatMoney(appliedTotal)} but only received{" "}
            {formatMoney(amount)}.
          </QbBanner>
        ) : null}
        {!overApplied && unapplied > 0.005 && amount > 0 ? (
          <QbBanner variant="warn">
            {formatMoney(unapplied)} will be left on account as an unapplied credit. It will
            show as a negative amount on the A/R aging until it is applied.
          </QbBanner>
        ) : null}
      </div>

      <div className="p-2 space-y-2">
        <div className="border border-qb-line bg-qb-chromeAlt p-2 flex flex-wrap gap-6 items-start">
          <div className="flex-1 min-w-[320px] space-y-1">
            <QbField label="Received From" labelWidth={100} required>
              <div className="flex items-stretch gap-1">
                <QbInput
                  readOnly
                  value={customer ? customer.companyName + " (" + customer.customerNo + ")" : ""}
                  placeholder="Press Find to choose a customer"
                  className="max-w-[300px] cursor-pointer"
                  onMouseDown={() => setLookupOpen(true)}
                />
                <QbButton size="sm" onClick={() => setLookupOpen(true)}>
                  Find...
                </QbButton>
              </div>
            </QbField>
            {customer ? (
              <div className="text-qb pl-[108px] text-qb-inkMuted">
                Balance on file: <strong>{formatMoney(customer.balance)}</strong>
              </div>
            ) : null}
            <QbField label="Memo" labelWidth={100}>
              <QbInput value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={500} />
            </QbField>
          </div>

          <div className="w-[290px] space-y-1">
            <QbField label="Amount" labelWidth={88} required>
              <QbInput
                type="number"
                step="0.01"
                min="0"
                numeric
                value={amountRaw}
                onChange={(e) => setAmountRaw(e.target.value)}
                className="max-w-[140px]"
                placeholder="0.00"
              />
            </QbField>
            <QbField label="Date" labelWidth={88}>
              <QbInput
                type="date"
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
                className="max-w-[140px]"
              />
            </QbField>
            <QbField label="Method" labelWidth={88}>
              <QbSelect
                value={method}
                onChange={(e) => setMethod(e.target.value as typeof method)}
                className="max-w-[160px]"
              >
                <option value="CHECK">Check</option>
                <option value="CASH">Cash</option>
                <option value="CREDIT_CARD">Credit Card</option>
                <option value="ACH">ACH / Transfer</option>
                <option value="STORE_CREDIT">Store Credit</option>
                <option value="OTHER">Other</option>
              </QbSelect>
            </QbField>
            <QbField label="Check / Ref" labelWidth={88}>
              <QbInput
                value={referenceNo}
                onChange={(e) => setReferenceNo(e.target.value)}
                className="max-w-[140px] font-qbMono"
              />
            </QbField>
            <QbField label="Deposit To" labelWidth={88}>
              <QbSelect
                value={depositAccountId}
                onChange={(e) => setDepositAccountId(e.target.value)}
                className="max-w-[200px]"
              >
                {depositAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.number} &mdash; {a.name}
                  </option>
                ))}
              </QbSelect>
            </QbField>
          </div>
        </div>

        <div className="border border-qb-line bg-white">
          <div className="bg-qb-chrome border-b border-qb-line px-2 py-1 flex items-center gap-2">
            <span className="qb-label">Outstanding Invoices</span>
            <QbButton size="sm" disabled={!customer || amount <= 0} onClick={autoApply}>
              Auto Apply (oldest first)
            </QbButton>
            <QbButton size="sm" onClick={() => setApplied({})}>
              Clear
            </QbButton>
            <span className="ml-auto text-qb-xs text-qb-inkMuted">
              Applied {formatMoney(appliedTotal)} of {formatMoney(amount)}
            </span>
          </div>

          {!customer ? (
            <QbEmpty>Choose a customer to see their open invoices.</QbEmpty>
          ) : loadingInvoices ? (
            <QbEmpty>Loading invoices...</QbEmpty>
          ) : rows.length === 0 ? (
            <QbEmpty>
              {customer.companyName} has no open invoices. A payment will be recorded entirely
              as an unapplied credit.
            </QbEmpty>
          ) : (
            <table className="qb-grid">
              <thead>
                <tr>
                  <th style={{ width: 96 }}>Invoice</th>
                  <th style={{ width: 86 }}>Date</th>
                  <th style={{ width: 86 }}>Due</th>
                  <th style={{ width: 64 }} className="text-right">Overdue</th>
                  <th>&nbsp;</th>
                  <th style={{ width: 96 }} className="text-right">Original</th>
                  <th style={{ width: 96 }} className="text-right">Balance</th>
                  <th style={{ width: 100 }} className="text-right">Payment</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ inv, raw, value, over }) => (
                  <tr
                    key={inv.id}
                    className={cn(over && "bg-qb-errBg", value > 0 && !over && "bg-qb-gridSelect")}
                  >
                    <td className="font-qbMono">{inv.invoiceNo}</td>
                    <td className="font-qbMono text-qb-xs">{inv.invoiceDate}</td>
                    <td className="font-qbMono text-qb-xs">{inv.dueDate ?? ""}</td>
                    <td
                      className={cn(
                        "qb-grid-num",
                        inv.daysOverdue > 30
                          ? "text-qb-red font-bold"
                          : inv.daysOverdue > 0
                            ? "text-qb-amber"
                            : "text-qb-inkDisabled",
                      )}
                    >
                      {inv.daysOverdue > 0 ? inv.daysOverdue + "d" : ""}
                    </td>
                    <td />
                    <td className="qb-grid-num text-qb-inkMuted">{formatMoney(inv.total)}</td>
                    <td className="qb-grid-num">{formatMoney(inv.balanceDue)}</td>
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
                          setApplied((prev) => ({ ...prev, [inv.id]: e.target.value }))
                        }
                        aria-label={"Amount to apply to invoice " + inv.invoiceNo}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-qb-grid-header font-bold">
                  <td colSpan={7} className="border border-qb-gridLine px-1 text-right">
                    Applied
                  </td>
                  <td className="border border-qb-gridLine px-1 qb-grid-num">
                    {formatMoney(appliedTotal)}
                  </td>
                </tr>
                <tr className={cn("font-bold", unapplied > 0.005 && "bg-qb-warnBg")}>
                  <td colSpan={7} className="border border-qb-gridLine px-1 text-right">
                    Left on account
                  </td>
                  <td className="border border-qb-gridLine px-1 qb-grid-num">
                    {formatMoney(Math.max(0, unapplied))}
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
          disabled={submitting || !customer || amount <= 0 || overApplied || anyOver}
          onClick={() => void submit()}
        >
          {submitting ? "Posting..." : "Save Payment"}
        </QbButton>
        <QbButton onClick={() => router.push("/dashboard/invoices")}>Close</QbButton>
        <span className="ml-auto text-qb-xs text-qb-inkMuted">
          Posts DR the deposit account / CR Accounts Receivable.
        </span>
      </div>

      <CustomerLookupModal
        open={lookupOpen}
        onClose={() => setLookupOpen(false)}
        onSelect={setCustomer}
      />
    </div>
  );
}
