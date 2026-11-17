import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { PERM } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { peekDocumentNumber } from "@/lib/sequence";
import { num } from "@/lib/money";
import { InvoiceForm } from "@/components/invoices/InvoiceForm";
import { QbWindow, QbBanner } from "@/components/qb/Ui";

export const metadata = { title: "Create Invoices — Gill Truck Parts" };

/**
 * /dashboard/invoices/new
 *
 * Server component. Its job is to resolve the signed-in user's permissions
 * and hand the client form a set of option lists plus three booleans. The
 * booleans are advisory for the UI only — every one of them is re-checked by
 * `createInvoice` on the server, so flipping them in devtools changes what
 * the clerk sees and nothing about what the database accepts.
 */
export default async function NewInvoicePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // Server-side authorization gate: a counter clerk without
  // sales.create_invoice never reaches the form.
  if (!user.permissions.includes(PERM.SALES_CREATE_INVOICE)) {
    return (
      <QbWindow title="Create Invoices">
        <div className="p-3">
          <QbBanner variant="err" title="Access denied">
            Your role ({user.roleName}) does not include permission to create
            invoices. Ask an administrator if you believe this is wrong.
          </QbBanner>
        </div>
      </QbWindow>
    );
  }

  const [terms, taxCodes, reps, settings, nextInvoiceNo] = await Promise.all([
    prisma.terms.findMany({
      select: { id: true, name: true, netDays: true },
      orderBy: { netDays: "asc" },
    }),
    prisma.taxCode.findMany({
      where: { isActive: true },
      select: { id: true, code: true, name: true, rate: true },
      orderBy: { code: "asc" },
    }),
    // Anyone who can write an invoice can be the Rep on one.
    prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, employeeCode: true, fullName: true },
      orderBy: { employeeCode: "asc" },
    }),
    prisma.companySettings.findUnique({ where: { id: "default" } }),
    peekDocumentNumber(prisma, "INVOICE"),
  ]);

  return (
    <InvoiceForm
      nextInvoiceNo={nextInvoiceNo}
      terms={terms}
      taxCodes={taxCodes.map((t) => ({ ...t, rate: num(t.rate) }))}
      reps={reps}
      defaultTaxCodeId={settings?.defaultTaxCodeId ?? taxCodes[0]?.id ?? null}
      currentUser={{
        id: user.id,
        employeeCode: user.employeeCode,
        fullName: user.fullName,
        roleName: user.roleName,
      }}
      canViewCost={user.permissions.includes(PERM.INVENTORY_VIEW_COST)}
      canSellBelowMin={user.permissions.includes(PERM.PRICING_SELL_BELOW_MIN)}
      canApproveOverride={user.permissions.includes(PERM.PRICING_APPROVE_OVERRIDE)}
      overridesEnabled={settings?.allowPriceOverride ?? true}
    />
  );
}
