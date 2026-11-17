import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { PERM } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { num, sumMoney } from "@/lib/money";
import { BillForm, type UnbilledReceipt } from "@/components/purchasing/BillForm";
import { QbWindow, QbBanner } from "@/components/qb/Ui";

export const metadata = { title: "Enter Bill — Gill Truck Parts" };

export default async function NewBillPage({
  searchParams,
}: {
  searchParams: Promise<{ receiptId?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  if (!user.permissions.includes(PERM.PURCHASING_ENTER_BILL)) {
    return (
      <QbWindow title="Enter Bills">
        <div className="p-3">
          <QbBanner variant="err" title="Access denied">
            Your role ({user.roleName}) cannot enter bills.
          </QbBanner>
        </div>
      </QbWindow>
    );
  }

  const params = await searchParams;

  const [vendors, expenseAccounts, terms, receipts] = await Promise.all([
    prisma.vendor.findMany({
      where: { isActive: true },
      select: { id: true, companyName: true, termsId: true },
      orderBy: { companyName: "asc" },
    }),
    prisma.account.findMany({
      where: {
        isActive: true,
        type: { in: ["EXPENSE", "OTHER_EXPENSE", "COST_OF_GOODS_SOLD", "ASSET"] },
      },
      select: { id: true, number: true, name: true },
      orderBy: { number: "asc" },
    }),
    prisma.terms.findMany({ select: { id: true, name: true }, orderBy: { netDays: "asc" } }),
    prisma.receipt.findMany({
      where: { isBilled: false },
      orderBy: { receivedDate: "desc" },
      include: {
        po: {
          select: {
            poNumber: true,
            vendorId: true,
            vendor: { select: { companyName: true } },
          },
        },
        lines: {
          include: { poLine: { select: { sku: true, description: true } } },
        },
      },
    }),
  ]);

  const unbilled: UnbilledReceipt[] = receipts.map((r) => ({
    id: r.id,
    receiptNo: r.receiptNo,
    receivedDate: r.receivedDate.toLocaleDateString("en-US"),
    poNumber: r.po.poNumber,
    vendorId: r.po.vendorId,
    vendorName: r.po.vendor.companyName,
    total: sumMoney(r.lines.map((l) => l.amount)),
    lines: r.lines.map((l) => ({
      description:
        (l.poLine.sku ? l.poLine.sku + " - " : "") + l.poLine.description,
      quantity: num(l.quantity),
      unitCost: num(l.unitCost),
      amount: num(l.amount),
    })),
  }));

  return (
    <BillForm
      vendors={vendors}
      expenseAccounts={expenseAccounts}
      terms={terms}
      unbilledReceipts={unbilled}
      preselectedReceiptId={params.receiptId ?? null}
    />
  );
}
