import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { PERM } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { ItemForm } from "@/components/items/ItemForm";
import { QbWindow, QbBanner } from "@/components/qb/Ui";

export const metadata = { title: "New Item — Gill Truck Parts" };

export default async function NewItemPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  if (!user.permissions.includes(PERM.INVENTORY_EDIT)) {
    return (
      <QbWindow title="New Item">
        <div className="p-3">
          <QbBanner variant="err" title="Access denied">
            Your role ({user.roleName}) cannot create items.
          </QbBanner>
        </div>
      </QbWindow>
    );
  }

  const [categories, brands, vendors] = await Promise.all([
    prisma.category.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.brand.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.vendor.findMany({
      where: { isActive: true },
      select: { id: true, companyName: true },
      orderBy: { companyName: "asc" },
    }),
  ]);

  return (
    <ItemForm
      initial={{
        id: null,
        sku: "",
        type: "INVENTORY",
        description: "",
        longDescription: null,
        categoryId: null,
        brandId: null,
        preferredVendorId: null,
        unitOfMeasure: "EA",
        barcode: null,
        binLocation: null,
        standardPrice: 0,
        minimumPrice: 0,
        averageCost: null,
        standardCost: 0,
        reorderPoint: 0,
        reorderQuantity: 0,
        coreCharge: 0,
        isTaxable: true,
        isActive: true,
        crossReferences: [],
      }}
      categories={categories}
      brands={brands}
      vendors={vendors.map((v) => ({ id: v.id, name: v.companyName }))}
      canViewCost={user.permissions.includes(PERM.INVENTORY_VIEW_COST)}
      currentAverageCost={null}
      onHand={0}
    />
  );
}
