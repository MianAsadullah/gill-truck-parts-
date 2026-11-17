import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { PERM } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { formatMoney, sumMoney } from "@/lib/money";
import { QbWindow, QbBanner, QbEmpty, QbButton, QbInput } from "@/components/qb/Ui";
import { cn } from "@/lib/cn";

export const metadata = { title: "Vendor Center — Gill Truck Parts" };

export default async function VendorsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  if (!user.permissions.includes(PERM.PURCHASING_VIEW)) {
    return (
      <QbWindow title="Vendor Center">
        <div className="p-3">
          <QbBanner variant="err" title="Access denied">
            Your role ({user.roleName}) cannot view vendors.
          </QbBanner>
        </div>
      </QbWindow>
    );
  }

  const params = await searchParams;
  const q = (params.q ?? "").trim();

  const vendors = await prisma.vendor.findMany({
    where: q
      ? {
          OR: [
            { companyName: { contains: q, mode: "insensitive" } },
            { vendorNo: { contains: q, mode: "insensitive" } },
            { contactName: { contains: q, mode: "insensitive" } },
            { phone: { contains: q } },
          ],
        }
      : {},
    orderBy: { companyName: "asc" },
    include: {
      terms: { select: { name: true } },
      _count: { select: { purchaseOrders: true, bills: true, products: true } },
    },
  });

  const totalOwed = sumMoney(vendors.map((v) => v.balance));

  return (
    <QbWindow
      title="Vendor Center"
      subtitle={"— " + vendors.length + " vendors"}
      toolbar={
        user.permissions.includes(PERM.PURCHASING_CREATE_PO) ? (
          <Link href="/dashboard/purchase-orders/new">
            <QbButton size="sm" variant="primary">
              New Purchase Order
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
          placeholder="Company, number, contact, phone"
          aria-label="Search vendors"
        />
        <QbButton type="submit" size="sm">
          Search
        </QbButton>
        <span className="ml-auto text-qb-xs text-qb-inkMuted">
          Total payable: {formatMoney(totalOwed)}
        </span>
      </form>

      {vendors.length === 0 ? (
        <QbEmpty>No vendors match that search.</QbEmpty>
      ) : (
        <table className="qb-grid">
          <thead>
            <tr>
              <th style={{ width: 64 }}>No.</th>
              <th>Company</th>
              <th style={{ width: 130 }}>Contact</th>
              <th style={{ width: 110 }}>Phone</th>
              <th style={{ width: 130 }}>City</th>
              <th style={{ width: 90 }}>Terms</th>
              <th style={{ width: 46 }} className="text-center">POs</th>
              <th style={{ width: 54 }} className="text-center">Bills</th>
              <th style={{ width: 56 }} className="text-center">Parts</th>
              <th style={{ width: 96 }} className="text-right">Balance</th>
            </tr>
          </thead>
          <tbody>
            {vendors.map((v) => (
              <tr key={v.id} className={cn(!v.isActive && "text-qb-inkDisabled")}>
                <td className="font-qbMono">{v.vendorNo}</td>
                <td className="truncate" title={v.companyName}>
                  <Link
                    href={"/dashboard/purchase-orders?q=" + encodeURIComponent(v.companyName)}
                    className="text-qb-blue hover:underline"
                  >
                    {v.companyName}
                  </Link>
                </td>
                <td className="truncate">{v.contactName ?? ""}</td>
                <td className="font-qbMono text-qb-xs">{v.phone ?? ""}</td>
                <td className="truncate">
                  {v.city ?? ""}
                  {v.state ? ", " + v.state : ""}
                </td>
                <td className="text-qb-xs">{v.terms?.name ?? ""}</td>
                <td className="text-center text-qb-inkMuted">{v._count.purchaseOrders}</td>
                <td className="text-center text-qb-inkMuted">{v._count.bills}</td>
                <td className="text-center text-qb-inkMuted">{v._count.products}</td>
                <td className="qb-grid-num font-bold">{formatMoney(v.balance)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-qb-grid-header font-bold">
              <td colSpan={9} className="border border-qb-gridLine px-1 text-right">
                Total payable
              </td>
              <td className="border border-qb-gridLine px-1 qb-grid-num">
                {formatMoney(totalOwed)}
              </td>
            </tr>
          </tfoot>
        </table>
      )}
    </QbWindow>
  );
}
