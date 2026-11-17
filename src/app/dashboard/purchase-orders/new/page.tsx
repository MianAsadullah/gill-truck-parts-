import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { PERM } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { peekDocumentNumber } from "@/lib/sequence";
import { PurchaseOrderForm } from "@/components/purchasing/PurchaseOrderForm";
import { QbWindow, QbBanner } from "@/components/qb/Ui";

export const metadata = { title: "Create Purchase Order — Gill Truck Parts" };

export default async function NewPurchaseOrderPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  if (!user.permissions.includes(PERM.PURCHASING_CREATE_PO)) {
    return (
      <QbWindow title="Create Purchase Orders">
        <div className="p-3">
          <QbBanner variant="err" title="Access denied">
            Your role ({user.roleName}) cannot raise purchase orders.
          </QbBanner>
        </div>
      </QbWindow>
    );
  }

  const [vendors, nextPoNumber] = await Promise.all([
    prisma.vendor.findMany({
      where: { isActive: true },
      select: {
        id: true,
        vendorNo: true,
        companyName: true,
        terms: { select: { name: true } },
      },
      orderBy: { companyName: "asc" },
    }),
    peekDocumentNumber(prisma, "PO"),
  ]);

  return (
    <PurchaseOrderForm
      nextPoNumber={nextPoNumber}
      vendors={vendors.map((v) => ({
        id: v.id,
        vendorNo: v.vendorNo,
        companyName: v.companyName,
        termsName: v.terms?.name ?? null,
      }))}
      currentUser={{
        fullName: user.fullName,
        employeeCode: user.employeeCode,
        roleName: user.roleName,
      }}
    />
  );
}
