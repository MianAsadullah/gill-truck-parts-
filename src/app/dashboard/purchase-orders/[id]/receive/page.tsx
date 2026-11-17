import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { PERM } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { peekDocumentNumber } from "@/lib/sequence";
import { num } from "@/lib/money";
import { ReceiveForm, type ReceivePoLine } from "@/components/purchasing/ReceiveForm";
import { QbWindow, QbBanner, QbButton } from "@/components/qb/Ui";

export const metadata = { title: "Receive Inventory — Gill Truck Parts" };

export default async function ReceivePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  if (!user.permissions.includes(PERM.PURCHASING_RECEIVE)) {
    return (
      <QbWindow title="Receive Inventory">
        <div className="p-3">
          <QbBanner variant="err" title="Access denied">
            Your role ({user.roleName}) cannot receive inventory.
          </QbBanner>
        </div>
      </QbWindow>
    );
  }

  const { id } = await params;

  const [po, nextReceiptNo] = await Promise.all([
    prisma.purchaseOrder.findUnique({
      where: { id },
      include: {
        vendor: { select: { companyName: true } },
        lines: {
          orderBy: { lineNo: "asc" },
          include: {
            product: {
              select: {
                type: true,
                quantityOnHand: true,
                averageCost: true,
              },
            },
          },
        },
      },
    }),
    peekDocumentNumber(prisma, "RECEIPT"),
  ]);

  if (!po) notFound();

  const receivable = po.status === "OPEN" || po.status === "PARTIALLY_RECEIVED";
  if (!receivable) {
    return (
      <QbWindow
        title={"Receive Inventory — " + po.poNumber}
        toolbar={
          <Link href={"/dashboard/purchase-orders/" + po.id}>
            <QbButton size="sm">Back to PO</QbButton>
          </Link>
        }
      >
        <div className="p-3">
          <QbBanner variant="warn" title={"This order is " + po.status.toLowerCase()}>
            {po.status === "DRAFT"
              ? "Issue the purchase order before receiving against it."
              : "Nothing is outstanding on this purchase order."}
          </QbBanner>
        </div>
      </QbWindow>
    );
  }

  // Only lines with something still outstanding are worth showing at the dock.
  const lines: ReceivePoLine[] = po.lines
    .filter((l) => num(l.quantityOrdered) - num(l.quantityReceived) > 0.0001)
    .map((l) => ({
      id: l.id,
      lineNo: l.lineNo,
      sku: l.sku,
      description: l.description,
      vendorPartNo: l.vendorPartNo,
      isStocked: l.product?.type === "INVENTORY",
      quantityOrdered: num(l.quantityOrdered),
      quantityReceived: num(l.quantityReceived),
      unitCost: num(l.unitCost),
      onHand: num(l.product?.quantityOnHand ?? 0),
      averageCost: num(l.product?.averageCost ?? 0),
    }));

  if (lines.length === 0) {
    return (
      <QbWindow title={"Receive Inventory — " + po.poNumber}>
        <div className="p-3">
          <QbBanner variant="warn" title="Nothing outstanding">
            Every line on this purchase order has been received in full.
          </QbBanner>
        </div>
      </QbWindow>
    );
  }

  return (
    <ReceiveForm
      poId={po.id}
      poNumber={po.poNumber}
      vendorName={po.vendor.companyName}
      nextReceiptNo={nextReceiptNo}
      poLines={lines}
    />
  );
}
