import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, userCan } from "@/lib/auth";
import { PERM } from "@/lib/permissions";
import { num } from "@/lib/money";

/** Open invoices for one customer, for the Receive Payments window. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!userCan(user, PERM.SALES_RECEIVE_PAYMENT)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const now = new Date();

  const invoices = await prisma.invoice.findMany({
    where: {
      customerId: id,
      status: { in: ["OPEN", "PARTIALLY_PAID"] },
      balanceDue: { gt: 0 },
    },
    orderBy: { invoiceDate: "asc" },
    select: {
      id: true,
      invoiceNo: true,
      invoiceDate: true,
      dueDate: true,
      total: true,
      balanceDue: true,
    },
  });

  const iso = (d: Date) =>
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0");

  return NextResponse.json(
    {
      invoices: invoices.map((i) => ({
        id: i.id,
        invoiceNo: i.invoiceNo,
        invoiceDate: iso(i.invoiceDate),
        dueDate: i.dueDate ? iso(i.dueDate) : null,
        total: num(i.total),
        balanceDue: num(i.balanceDue),
        daysOverdue: i.dueDate
          ? Math.max(0, Math.floor((now.getTime() - i.dueDate.getTime()) / 86_400_000))
          : 0,
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
