import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { PERM } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { formatMoney, num, sumMoney } from "@/lib/money";
import { QbWindow, QbBanner, QbEmpty, QbButton, QbPill } from "@/components/qb/Ui";
import { PayBillsForm, type PayableBill } from "@/components/purchasing/PayBillsForm";

export const metadata = { title: "Bills — Gill Truck Parts" };

function isoDate(d: Date | null): string | null {
  if (!d) return null;
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
}

/**
 * Bills (PUR / ACC).
 *
 * `?filter=unpaid` switches the window into the Pay Bills workflow rather
 * than a read-only list, which is how the Vendors menu and the home-page
 * "Pay Bills" tile reach it.
 */
export default async function BillsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  if (!user.permissions.includes(PERM.PURCHASING_VIEW)) {
    return (
      <QbWindow title="Bills">
        <div className="p-3">
          <QbBanner variant="err" title="Access denied">
            Your role ({user.roleName}) cannot view payables.
          </QbBanner>
        </div>
      </QbWindow>
    );
  }

  const params = await searchParams;
  const payMode = params.filter === "unpaid";
  const canPay = user.permissions.includes(PERM.PURCHASING_PAY_BILL);
  const canEnter = user.permissions.includes(PERM.PURCHASING_ENTER_BILL);

  if (payMode && canPay) {
    const [openBills, bankAccounts] = await Promise.all([
      prisma.bill.findMany({
        where: { status: { in: ["OPEN", "PARTIALLY_PAID"] }, balanceDue: { gt: 0 } },
        orderBy: [{ dueDate: "asc" }, { billDate: "asc" }],
        include: { vendor: { select: { id: true, companyName: true } } },
      }),
      prisma.account.findMany({
        where: { subType: { in: ["BANK", "CREDIT_CARD"] }, isActive: true },
        select: { id: true, number: true, name: true },
        orderBy: { number: "asc" },
      }),
    ]);

    const now = new Date();
    const payable: PayableBill[] = openBills.map((b) => ({
      id: b.id,
      billNo: b.billNo,
      vendorId: b.vendorId,
      vendorName: b.vendor.companyName,
      billDate: isoDate(b.billDate) ?? "",
      dueDate: isoDate(b.dueDate),
      daysOverdue: b.dueDate
        ? Math.max(0, Math.floor((now.getTime() - b.dueDate.getTime()) / 86_400_000))
        : 0,
      total: num(b.total),
      balanceDue: num(b.balanceDue),
    }));

    return <PayBillsForm bills={payable} bankAccounts={bankAccounts} />;
  }

  const bills = await prisma.bill.findMany({
    orderBy: { billDate: "desc" },
    take: 200,
    include: {
      vendor: { select: { companyName: true } },
      po: { select: { poNumber: true, id: true } },
      receipt: { select: { receiptNo: true } },
    },
  });

  const outstanding = sumMoney(bills.map((b) => b.balanceDue));

  return (
    <QbWindow
      title="Bills"
      subtitle={"— " + bills.length + " shown"}
      toolbar={
        <>
          {canPay ? (
            <Link href="/dashboard/bills?filter=unpaid">
              <QbButton size="sm">Pay Bills</QbButton>
            </Link>
          ) : null}
          {canEnter ? (
            <Link href="/dashboard/bills/new">
              <QbButton size="sm" variant="primary">
                Enter Bill
              </QbButton>
            </Link>
          ) : null}
        </>
      }
      bodyClassName="bg-white"
    >
      {bills.length === 0 ? (
        <QbEmpty>
          No bills entered yet.{" "}
          {canEnter ? (
            <Link href="/dashboard/bills/new" className="text-qb-blue hover:underline">
              Enter one.
            </Link>
          ) : null}
        </QbEmpty>
      ) : (
        <table className="qb-grid">
          <thead>
            <tr>
              <th style={{ width: 100 }}>Invoice No.</th>
              <th>Vendor</th>
              <th style={{ width: 80 }}>Bill Date</th>
              <th style={{ width: 80 }}>Due</th>
              <th style={{ width: 120 }}>Source</th>
              <th style={{ width: 110 }}>Status</th>
              <th style={{ width: 92 }} className="text-right">Amount</th>
              <th style={{ width: 92 }} className="text-right">Balance</th>
            </tr>
          </thead>
          <tbody>
            {bills.map((b) => {
              const overdue =
                b.dueDate !== null && b.dueDate < new Date() && num(b.balanceDue) > 0;
              return (
                <tr key={b.id}>
                  <td className="font-qbMono">{b.billNo}</td>
                  <td className="truncate">{b.vendor.companyName}</td>
                  <td className="font-qbMono text-qb-xs">
                    {b.billDate.toLocaleDateString("en-US", {
                      month: "2-digit",
                      day: "2-digit",
                      year: "2-digit",
                    })}
                  </td>
                  <td
                    className={
                      "font-qbMono text-qb-xs " + (overdue ? "text-qb-red font-bold" : "")
                    }
                  >
                    {b.dueDate
                      ? b.dueDate.toLocaleDateString("en-US", {
                          month: "2-digit",
                          day: "2-digit",
                          year: "2-digit",
                        })
                      : ""}
                  </td>
                  <td className="text-qb-xs">
                    {b.receipt ? (
                      <span title="Settles an item receipt — the GL was posted at receiving">
                        {b.receipt.receiptNo}
                      </span>
                    ) : (
                      <span className="text-qb-inkMuted">expense</span>
                    )}
                    {b.po ? (
                      <Link
                        href={"/dashboard/purchase-orders/" + b.po.id}
                        className="text-qb-blue hover:underline"
                      >
                        {" "}
                        {b.po.poNumber}
                      </Link>
                    ) : null}
                  </td>
                  <td>
                    <QbPill status={b.status} />
                    {overdue ? (
                      <span className="text-qb-xs text-qb-red font-bold"> OVERDUE</span>
                    ) : null}
                  </td>
                  <td className="qb-grid-num">{formatMoney(b.total)}</td>
                  <td
                    className={
                      "qb-grid-num " +
                      (num(b.balanceDue) > 0 ? "font-bold" : "text-qb-inkMuted")
                    }
                  >
                    {formatMoney(b.balanceDue)}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-qb-grid-header font-bold">
              <td colSpan={7} className="border border-qb-gridLine px-1 text-right">
                Outstanding
              </td>
              <td className="border border-qb-gridLine px-1 qb-grid-num">
                {formatMoney(outstanding)}
              </td>
            </tr>
          </tfoot>
        </table>
      )}
    </QbWindow>
  );
}
