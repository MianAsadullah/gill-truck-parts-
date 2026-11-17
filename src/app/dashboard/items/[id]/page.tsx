import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { PERM } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { num } from "@/lib/money";
import { ItemForm } from "@/components/items/ItemForm";
import { QbWindow, QbBanner } from "@/components/qb/Ui";

export default async function EditItemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  if (!user.permissions.includes(PERM.INVENTORY_EDIT)) {
    return (
      <QbWindow title="Item">
        <div className="p-3">
          <QbBanner variant="err" title="Access denied">
            Your role ({user.roleName}) cannot edit items.
          </QbBanner>
        </div>
      </QbWindow>
    );
  }

  const { id } = await params;
  const canViewCost = user.permissions.includes(PERM.INVENTORY_VIEW_COST);

  const [product, categories, brands, vendors] = await Promise.all([
    prisma.product.findUnique({
      where: { id },
      include: { crossReferences: { orderBy: { type: "asc" } } },
    }),
    prisma.category.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.brand.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.vendor.findMany({
      where: { isActive: true },
      select: { id: true, companyName: true },
      orderBy: { companyName: "asc" },
    }),
  ]);

  if (!product) notFound();

  return (
    <ItemForm
      initial={{
        id: product.id,
        sku: product.sku,
        type: product.type,
        description: product.description,
        longDescription: product.longDescription,
        categoryId: product.categoryId,
        brandId: product.brandId,
        preferredVendorId: product.preferredVendorId,
        unitOfMeasure: product.unitOfMeasure,
        barcode: product.barcode,
        binLocation: product.binLocation,
        standardPrice: num(product.standardPrice),
        minimumPrice: num(product.minimumPrice),
        averageCost: null,
        // Only hand the form a cost figure when the role may see one.
        standardCost: canViewCost ? num(product.standardCost) : 0,
        reorderPoint: num(product.reorderPoint),
        reorderQuantity: num(product.reorderQuantity),
        coreCharge: num(product.coreCharge),
        isTaxable: product.isTaxable,
        isActive: product.isActive,
        crossReferences: product.crossReferences.map((x) => ({
          type: x.type,
          number: x.number,
          manufacturer: x.manufacturer,
        })),
      }}
      categories={categories}
      brands={brands}
      vendors={vendors.map((v) => ({ id: v.id, name: v.companyName }))}
      canViewCost={canViewCost}
      currentAverageCost={canViewCost ? num(product.averageCost) : null}
      onHand={num(product.quantityOnHand)}
    />
  );
}
