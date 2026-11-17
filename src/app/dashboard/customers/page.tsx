import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { PERM } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { formatMoney, num, sumMoney } from "@/lib/money";
import { QbWindow, QbBanner, QbEmpty, QbButton, QbInput } from "@/components/qb/Ui";
import { cn } from "@/lib/cn";

export const metadata = { title: "Customer Center — Gill Truck Parts" };

/**
 * Customer Center (SAL).
 *
 * Lists customers with their balance, credit position and vehicles. Over-limit
 * accounts are flagged here rather than only at invoice time, so the counter
 * can see a problem before the customer is standing in front of them.
 */
export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  if (!user.permissions.includes(PERM.SALES_VIEW)) {
    return (
      <QbWindow title="Customer Center">
        <div className="p-3">
          <QbBanner variant="err" title="Access denied">
            Your role ({user.roleName}) cannot view customers.
          </QbBanner>
        </div>
      </QbWindow>
    );
  }

  const params = await searchParams;
  const q = (params.q ?? "").trim();

  const customers = await prisma.customer.findMany({
    where: q
      ? {
          OR: [
            { companyName: { contains: q, mode: "insensitive" } },
            { customerNo: { contains: q, mode: "insensitive" } },
            { contactName: { contains: q, mode: "insensitive" } },
            { phone: { contains: q } },
            { vehicles: { some: { licensePlate: { contains: q, mode: "insensitive" } } } },
          ],
        }
      : {},
    orderBy: { companyName: "asc" },
    take: 300,
    include: {
      terms: { select: { name: true } },
      vehicles: { select: { licensePlate: true } },
      _count: { select: { invoices: true } },
    },
  });

  const totalBalance = sumMoney(customers.map((c) => c.balance));
  const overLimit = customers.filter(
    (c) => num(c.creditLimit) > 0 && num(c.balance) > num(c.creditLimit),
  );

  return (
    <QbWindow
      title="Customer Center"
      subtitle={"— " + customers.length + " customers"}
      toolbar={
        user.permissions.includes(PERM.SALES_CREATE_INVOICE) ? (
          <Link href="/dashboard/invoices/new">
            <QbButton size="sm" variant="primary">
              New Invoice
            </QbButton>
          </Link>
        ) : null
      }
      bodyClassName="bg-white"
    >
      <form
        method="get"
        className="bg-qb-chrome border-b border-qb-line px-2 py-1 flex items-center gap-2 sticky top-0 z-20"
      >
        <span className="qb-label">Find</span>
        <QbInput
          name="q"
          defaultValue={q}
          className="max-w-[280px]"
          placeholder="Company, number, contact, phone, or plate"
          aria-label="Search customers"
        />
        <QbButton type="submit" size="sm">
          Search
        </QbButton>
        <span className="ml-auto text-qb-xs text-qb-inkMuted">
          Total owed: {formatMoney(totalBalance)}
        </span>
      </form>

      {overLimit.length > 0 ? (
        <div className="px-2 py-1">
          <QbBanner variant="warn" title={overLimit.length + " account(s) over credit limit"}>
            {overLimit.map((c) => c.companyName).join(", ")}
          </QbBanner>
        </div>
      ) : null}

      {customers.length === 0 ? (
        <QbEmpty>No customers match that search.</QbEmpty>
      ) : (
        <table className="qb-grid">
          <thead>
            <tr>
              <th style={{ width: 64 }}>No.</th>
              <th>Company</th>
              <th style={{ width: 130 }}>Contact</th>
              <th style={{ width: 104 }}>Phone</th>
              <th style={{ width: 120 }}>City</th>
              <th style={{ width: 84 }}>Terms</th>
              <th style={{ width: 74 }}>Level</th>
              <th style={{ width: 44 }} className="text-center">Veh</th>
              <th style={{ width: 44 }} className="text-center">Inv</th>
              <th style={{ width: 90 }} className="text-right">Credit</th>
              <th style={{ width: 90 }} className="text-right">Balance</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => {
              const over = num(c.creditLimit) > 0 && num(c.balance) > num(c.creditLimit);
              return (
                <tr key={c.id} className={cn(!c.isActive && "text-qb-inkDisabled")}>
                  <td className="font-qbMono">{c.customerNo}</td>
                  <td className="truncate" title={c.companyName}>
                    <Link
                      href={"/dashboard/invoices?q=" + encodeURIComponent(c.companyName)}
                      className="text-qb-blue hover:underline"
                    >
                      {c.companyName}
                    </Link>
                    {c.taxExempt ? (
                      <span className="text-qb-xs text-qb-amber"> (exempt)</span>
                    ) : null}
                  </td>
                  <td className="truncate">{c.contactName ?? ""}</td>
                  <td className="font-qbMono text-qb-xs">{c.phone ?? ""}</td>
                  <td className="truncate">
                    {c.city ?? ""}
                    {c.state ? ", " + c.state : ""}
                  </td>
                  <td className="text-qb-xs">{c.terms?.name ?? ""}</td>
                  <td className="text-qb-xs">{c.priceLevel}</td>
                  <td className="text-center text-qb-inkMuted">{c.vehicles.length}</td>
                  <td className="text-center text-qb-inkMuted">{c._count.invoices}</td>
                  <td className="qb-grid-num text-qb-inkMuted">
                    {num(c.creditLimit) > 0 ? formatMoney(c.creditLimit) : ""}
                  </td>
                  <td className={cn("qb-grid-num", over && "text-qb-red font-bold")}>
                    {formatMoney(c.balance)}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-qb-grid-header font-bold">
              <td colSpan={10} className="border border-qb-gridLine px-1 text-right">
                Total receivable
              </td>
              <td className="border border-qb-gridLine px-1 qb-grid-num">
                {formatMoney(totalBalance)}
              </td>
            </tr>
          </tfoot>
        </table>
      )}
    </QbWindow>
  );
}
