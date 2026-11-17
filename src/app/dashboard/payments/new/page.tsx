import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { PERM } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { ReceivePaymentForm } from "@/components/invoices/ReceivePaymentForm";
import { QbWindow, QbBanner } from "@/components/qb/Ui";

export const metadata = { title: "Receive Payments — Gill Truck Parts" };

export default async function ReceivePaymentPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  if (!user.permissions.includes(PERM.SALES_RECEIVE_PAYMENT)) {
    return (
      <QbWindow title="Receive Payments">
        <div className="p-3">
          <QbBanner variant="err" title="Access denied">
            Your role ({user.roleName}) cannot receive payments.
          </QbBanner>
        </div>
      </QbWindow>
    );
  }

  const depositAccounts = await prisma.account.findMany({
    where: { subType: "BANK", isActive: true },
    select: { id: true, number: true, name: true },
    orderBy: { number: "asc" },
  });

  return <ReceivePaymentForm depositAccounts={depositAccounts} />;
}
