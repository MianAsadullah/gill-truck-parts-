import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { PERM } from "@/lib/permissions";
import { AdjustForm } from "@/components/items/AdjustForm";
import { QbWindow, QbBanner } from "@/components/qb/Ui";

export const metadata = { title: "Adjust Quantity — Gill Truck Parts" };

export default async function AdjustPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  if (!user.permissions.includes(PERM.INVENTORY_ADJUST)) {
    return (
      <QbWindow title="Adjust Quantity on Hand">
        <div className="p-3">
          <QbBanner variant="err" title="Access denied">
            Your role ({user.roleName}) cannot adjust inventory quantities.
          </QbBanner>
        </div>
      </QbWindow>
    );
  }

  return <AdjustForm canViewCost={user.permissions.includes(PERM.INVENTORY_VIEW_COST)} />;
}
