"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  requirePermission,
  verifyOverrideCode,
  getRequestMeta,
  AuthError,
  type AuthUser,
} from "@/lib/auth";
import { PERM, PermissionError } from "@/lib/permissions";
import { writeAuditLog } from "@/lib/audit";
import {
  assertLinePricing,
  PricingViolationError,
  type OverrideGrant,
  type PricingProduct,
} from "@/lib/pricing";
import { extend, num, round2, sumMoney, applyRate } from "@/lib/money";
import { nextDocumentNumber } from "@/lib/sequence";
import { buildInvoiceJournalLines, postJournalEntry } from "@/lib/ledger";
import {
  invoiceFormSchema,
  parseFormDate,
  type ActionResult,
  type InvoiceFormValues,
} from "@/lib/validation/invoice";

/**
 * Create an invoice (SAL / INV-14).
 *
 * Everything the client sent about money is treated as a suggestion. The
 * server re-reads each part's price floor and cost from the database,
 * recomputes every extension, tax figure and total, and posts the result.
 * The client's `amount` fields are never persisted.
 *
 * Order of operations matters:
 *   1. permission
 *   2. shape (Zod)
 *   3. load the real parts + customer + settings
 *   4. verify any manager override codes  (bcrypt — slow, so before the tx)
 *   5. assert pricing legality
 *   6. one transaction: number, invoice, lines, overrides, stock, GL, audit
 */
export async function createInvoice(
  input: InvoiceFormValues,
): Promise<ActionResult<{ id: string; invoiceNo: string; total: number }>> {
  let user: AuthUser;
  try {
    user = await requirePermission(PERM.SALES_CREATE_INVOICE);
  } catch (err) {
    if (err instanceof PermissionError) {
      return { ok: false, error: "You do not have permission to create invoices." };
    }
    if (err instanceof AuthError) {
      return { ok: false, error: "Your session has expired. Please sign in again." };
    }
    throw err;
  }

  // ── 2. Shape ────────────────────────────────────────────────────────────
  const parsed = invoiceFormSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path.join(".");
      if (!fieldErrors[path]) fieldErrors[path] = issue.message;
    }
    return {
      ok: false,
      error: "Please correct the highlighted fields.",
      fieldErrors,
    };
  }
  const form = parsed.data;

  // Dates arrive as "YYYY-MM-DD" strings (see validation/invoice.ts). Convert
  // once, here, so everything downstream deals in Date objects.
  const invoiceDate = parseFormDate(form.invoiceDate);
  if (!invoiceDate) return { ok: false, error: "Enter a valid invoice date." };
  const serviceDate = parseFormDate(form.serviceDate);
  const requestedDueDate = parseFormDate(form.dueDate);

  // ── 3. Load authoritative data ──────────────────────────────────────────
  const productIds = form.lines
    .map((l) => l.productId)
    .filter((id): id is string => !!id);

  const [customer, products, settings, taxCode] = await Promise.all([
    prisma.customer.findUnique({
      where: { id: form.customerId },
      include: { terms: true, taxCode: true },
    }),
    productIds.length
      ? prisma.product.findMany({
          where: { id: { in: productIds } },
          select: {
            id: true,
            sku: true,
            type: true,
            description: true,
            standardPrice: true,
            minimumPrice: true,
            averageCost: true,
            quantityOnHand: true,
            unitOfMeasure: true,
            isTaxable: true,
            isActive: true,
          },
        })
      : Promise.resolve([]),
    prisma.companySettings.findUnique({ where: { id: "default" } }),
    form.taxCodeId
      ? prisma.taxCode.findUnique({ where: { id: form.taxCodeId } })
      : Promise.resolve(null),
  ]);

  if (!customer) return { ok: false, error: "That customer no longer exists." };
  if (!customer.isActive) {
    return { ok: false, error: customer.companyName + " is marked inactive." };
  }

  const productMap = new Map(products.map((p) => [p.id, p]));
  const missing = productIds.filter((id) => !productMap.has(id));
  if (missing.length > 0) {
    return { ok: false, error: "One or more items on this invoice no longer exist." };
  }

  const inactive = products.filter((p) => !p.isActive);
  if (inactive.length > 0) {
    return {
      ok: false,
      error:
        "These items are inactive and cannot be sold: " +
        inactive.map((p) => p.sku).join(", "),
    };
  }

  const overridesEnabled = settings?.allowPriceOverride ?? true;
  const callerMaySellBelowMin = user.permissions.includes(PERM.PRICING_SELL_BELOW_MIN);

  // Effective tax rate: the invoice's code, else the customer's default.
  // A tax-exempt customer with a valid resale certificate pays none.
  const effectiveTaxCode = taxCode ?? customer.taxCode ?? null;
  const taxRate = customer.taxExempt ? 0 : num(effectiveTaxCode?.rate ?? 0);

  // ── 4. Verify override codes (bcrypt, so outside the transaction) ───────
  const grants = new Map<number, OverrideGrant & { approver: AuthUser }>();
  for (const line of form.lines) {
    if (!line.override) continue;
    const approver = await verifyOverrideCode(
      line.override.approverCode,
      line.override.overrideCode,
    );
    if (!approver) {
      await writeAuditLog({
        action: "PRICE_OVERRIDE_DENIED",
        entity: "Invoice",
        entityId: null,
        summary:
          "Invalid price-override code presented for approver '" +
          line.override.approverCode +
          "' on line " +
          line.lineNo +
          " by " +
          user.fullName,
        isSensitive: true,
        user,
      });
      return {
        ok: false,
        error:
          "The override code for " +
          line.override.approverCode +
          " was not accepted. Ask a manager to re-enter it.",
        fieldErrors: {
          ["lines." + (line.lineNo - 1) + ".override.overrideCode"]:
            "Code not accepted",
        },
      };
    }
    grants.set(line.lineNo, {
      approvedById: approver.id,
      approverRole: approver.roleName,
      maxDiscountPct: approver.maxDiscountPct,
      reason: line.override.reason,
      approver,
    });
  }

  // ── 5. Recompute every line, then assert pricing ────────────────────────
  interface ComputedLine {
    lineNo: number;
    productId: string | null;
    isManual: boolean;
    itemType: "INVENTORY" | "NON_INVENTORY" | "SERVICE" | "OTHER_CHARGE";
    sku: string | null;
    description: string;
    quantity: number;
    unitOfMeasure: string;
    rate: number;
    amount: number;
    isTaxable: boolean;
    unitCost: number;
    costAmount: number;
    /** Set when this line breached the floor and was approved. */
    override: (OverrideGrant & { approver: AuthUser }) | null;
    minimumPrice: number;
    standardPrice: number;
    concessionAmount: number;
    discountPct: number;
  }

  const computed: ComputedLine[] = [];

  for (const line of form.lines) {
    const product = line.productId ? productMap.get(line.productId)! : null;

    const pricingProduct: PricingProduct | null = product
      ? {
          id: product.id,
          sku: product.sku,
          standardPrice: num(product.standardPrice),
          minimumPrice: num(product.minimumPrice),
        }
      : null;

    const grant = grants.get(line.lineNo) ?? null;

    try {
      const check = assertLinePricing({
        lineNo: line.lineNo,
        product: pricingProduct,
        rate: line.rate,
        quantity: line.quantity,
        callerMaySellBelowMin,
        callerMaxDiscountPct: user.maxDiscountPct,
        override: grant,
        overridesEnabled,
      });

      // Only an actual breach produces an override record. A manager who
      // happened to type an override on a line priced at list does not get
      // a spurious audit row.
      const breached = check.status === "below_minimum";

      // An inventory part carries its cost snapshot; labor does not.
      const unitCost = product ? num(product.averageCost) : 0;
      const quantity = line.quantity;
      const amount = extend(quantity, line.rate);

      computed.push({
        lineNo: line.lineNo,
        productId: line.productId,
        isManual: line.isManual,
        itemType: line.isManual ? line.itemType : (product!.type as ComputedLine["itemType"]),
        sku: product?.sku ?? null,
        // Snapshot the description so a later catalog edit cannot alter a
        // document the customer already has in hand.
        description: line.description || product?.description || "",
        quantity,
        unitOfMeasure: product?.unitOfMeasure ?? line.unitOfMeasure ?? "EA",
        rate: round2(line.rate),
        amount,
        isTaxable: product ? product.isTaxable && line.isTaxable : line.isTaxable,
        unitCost,
        costAmount: extend(quantity, unitCost),
        override: breached ? grant : null,
        minimumPrice: check.minimumPrice,
        standardPrice: pricingProduct?.standardPrice ?? 0,
        concessionAmount: breached ? check.concessionAmount : 0,
        discountPct: breached ? check.discountPct : 0,
      });
    } catch (err) {
      if (err instanceof PricingViolationError) {
        const sku = pricingProduct?.sku ?? "";
        return {
          ok: false,
          error: err.message,
          fieldErrors: { ["lines." + (line.lineNo - 1) + ".rate"]: "Below minimum" },
          pricingViolation: {
            lineNo: line.lineNo,
            sku,
            minimumPrice: err.check.minimumPrice,
            attemptedRate: round2(line.rate),
            discountPct: err.check.discountPct,
            // Tells the UI whether to open the override dialog or just
            // refuse (refuse when overrides are off company-wide).
            requiresApproval: overridesEnabled && !callerMaySellBelowMin,
          },
        };
      }
      throw err;
    }
  }

  // ── Totals, computed from our own numbers ───────────────────────────────
  const subtotal = sumMoney(computed.map((l) => l.amount));
  const taxableBase = sumMoney(
    computed.filter((l) => l.isTaxable).map((l) => l.amount),
  );
  const taxTotal = applyRate(taxableBase, taxRate);
  const total = round2(subtotal + taxTotal);
  const costTotal = sumMoney(computed.map((l) => l.costAmount));

  const partsRevenue = sumMoney(
    computed
      .filter((l) => l.itemType === "INVENTORY" || l.itemType === "NON_INVENTORY")
      .map((l) => l.amount),
  );
  const serviceRevenue = sumMoney(
    computed.filter((l) => l.itemType === "SERVICE").map((l) => l.amount),
  );
  const otherRevenue = sumMoney(
    computed.filter((l) => l.itemType === "OTHER_CHARGE").map((l) => l.amount),
  );

  // COGS only for stocked parts actually leaving the shelf.
  const cogs = sumMoney(
    computed
      .filter((l) => l.itemType === "INVENTORY" && l.productId)
      .map((l) => l.costAmount),
  );

  // Due date from terms, when the customer has them.
  const netDays = customer.terms?.netDays ?? 0;
  const dueDate =
    requestedDueDate ??
    (netDays > 0
      ? new Date(invoiceDate.getTime() + netDays * 86_400_000)
      : invoiceDate);

  const meta = await getRequestMeta();

  // ── 6. One transaction ──────────────────────────────────────────────────
  try {
    const result = await prisma.$transaction(
      async (tx) => {
        const invoiceNo = await nextDocumentNumber(tx, "INVOICE");
        const posting = form.postToLedger;

        const invoice = await tx.invoice.create({
          data: {
            invoiceNo,
            customerId: customer.id,
            vehicleId: form.vehicleId,
            licensePlate: form.licensePlate,
            invoiceDate,
            serviceDate,
            dueDate,
            termsId: form.termsId ?? customer.termsId,
            repId: form.repId ?? user.id,
            poNumber: form.poNumber,
            status: posting ? "OPEN" : "DRAFT",
            memo: form.memo,
            customerMessage: form.customerMessage,
            subtotal,
            taxCodeId: effectiveTaxCode?.id ?? null,
            taxRate,
            taxTotal,
            total,
            amountPaid: 0,
            balanceDue: total,
            costTotal,
            createdById: user.id,
            postedAt: posting ? new Date() : null,
          },
          select: { id: true, invoiceNo: true },
        });

        // Lines, plus an immutable PriceOverride for any breached line.
        for (const line of computed) {
          let priceOverrideId: string | null = null;

          if (line.override && line.productId) {
            const override = await tx.priceOverride.create({
              data: {
                invoiceId: invoice.id,
                productId: line.productId,
                sku: line.sku ?? "",
                lineNo: line.lineNo,
                minimumPrice: line.minimumPrice,
                standardPrice: line.standardPrice,
                approvedPrice: line.rate,
                quantity: line.quantity,
                concessionAmount: line.concessionAmount,
                discountPct: line.discountPct,
                requestedById: user.id,
                approvedById: line.override.approvedById,
                reason: line.override.reason,
                ipAddress: meta.ipAddress,
              },
              select: { id: true },
            });
            priceOverrideId = override.id;

            // Audit row joins this transaction: if the invoice rolls back,
            // so does the log, and vice versa.
            await writeAuditLog({
              tx,
              user,
              action: "PRICE_OVERRIDE_APPROVED",
              entity: "Invoice",
              entityId: invoice.id,
              isSensitive: true,
              summary:
                line.override.approver.fullName +
                " (" +
                line.override.approver.employeeCode +
                ") approved " +
                line.sku +
                " at " +
                line.rate.toFixed(2) +
                " against a minimum of " +
                line.minimumPrice.toFixed(2) +
                " on " +
                invoice.invoiceNo +
                " line " +
                line.lineNo +
                " (" +
                (line.discountPct * 100).toFixed(1) +
                "% below, " +
                line.concessionAmount.toFixed(2) +
                " conceded). Requested by " +
                user.fullName +
                ". Reason: " +
                line.override.reason,
              changes: {
                sku: line.sku,
                minimumPrice: line.minimumPrice,
                approvedPrice: line.rate,
                quantity: line.quantity,
                concessionAmount: line.concessionAmount,
                discountPct: line.discountPct,
                approverCode: line.override.approver.employeeCode,
                requestedBy: user.employeeCode,
              },
            });
          }

          await tx.invoiceLine.create({
            data: {
              invoiceId: invoice.id,
              lineNo: line.lineNo,
              productId: line.productId,
              isManual: line.isManual,
              itemType: line.itemType,
              sku: line.sku,
              description: line.description,
              quantity: line.quantity,
              unitOfMeasure: line.unitOfMeasure,
              rate: line.rate,
              amount: line.amount,
              isTaxable: line.isTaxable,
              unitCost: line.unitCost,
              costAmount: line.costAmount,
              priceOverrideId,
            },
          });

          // Stock movement — INVENTORY lines only. This is the branch that
          // makes a labor line leave inventory untouched.
          if (line.itemType === "INVENTORY" && line.productId) {
            const updatedProduct = await tx.product.update({
              where: { id: line.productId },
              data: { quantityOnHand: { decrement: line.quantity } },
              select: { quantityOnHand: true },
            });

            await tx.inventoryMovement.create({
              data: {
                productId: line.productId,
                type: "SALE",
                quantity: -line.quantity,
                unitCost: line.unitCost,
                balanceAfter: num(updatedProduct.quantityOnHand),
                referenceType: "INVOICE",
                referenceId: invoice.id,
                referenceNumber: invoice.invoiceNo,
                memo: "Sold on " + invoice.invoiceNo,
                createdById: user.id,
              },
            });
          }
        }

        // Customer A/R balance and the GL entry.
        if (posting) {
          await tx.customer.update({
            where: { id: customer.id },
            data: { balance: { increment: total } },
          });

          await postJournalEntry({
            tx,
            source: "INVOICE",
            entryDate: invoiceDate,
            memo: "Invoice " + invoice.invoiceNo + " - " + customer.companyName,
            referenceType: "INVOICE",
            referenceId: invoice.id,
            invoiceId: invoice.id,
            createdById: user.id,
            lines: buildInvoiceJournalLines({
              customerId: customer.id,
              invoiceNo: invoice.invoiceNo,
              total,
              partsRevenue,
              serviceRevenue,
              otherRevenue,
              taxTotal,
              costOfGoodsSold: cogs,
            }),
          });
        }

        await writeAuditLog({
          tx,
          user,
          action: posting ? "POST" : "CREATE",
          entity: "Invoice",
          entityId: invoice.id,
          summary:
            (posting ? "Posted" : "Saved draft") +
            " invoice " +
            invoice.invoiceNo +
            " for " +
            customer.companyName +
            " totalling " +
            total.toFixed(2) +
            " (" +
            computed.length +
            " line" +
            (computed.length === 1 ? "" : "s") +
            ")",
          changes: {
            invoiceNo: invoice.invoiceNo,
            subtotal,
            taxTotal,
            total,
            lineCount: computed.length,
            overrideCount: computed.filter((l) => l.override).length,
          },
        });

        return { id: invoice.id, invoiceNo: invoice.invoiceNo, total };
      },
      { timeout: 20_000 },
    );

    revalidatePath("/dashboard/invoices");
    revalidatePath("/dashboard");

    return { ok: true, data: result };
  } catch (err) {
    console.error("[createInvoice] failed", err);

    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2002") {
        return {
          ok: false,
          error: "That invoice number was just taken. Press Save again.",
        };
      }
    }
    const message =
      err instanceof Error ? err.message : "The invoice could not be saved.";
    return { ok: false, error: message };
  }
}

/**
 * Void an invoice (never delete). Reverses the GL entry, returns stock, and
 * leaves the original document readable for audit.
 */
export async function voidInvoice(
  invoiceId: string,
  reason: string,
): Promise<ActionResult<{ id: string }>> {
  let user: AuthUser;
  try {
    user = await requirePermission(PERM.SALES_VOID_INVOICE);
  } catch {
    return { ok: false, error: "You do not have permission to void invoices." };
  }

  if (!reason || reason.trim().length < 4) {
    return { ok: false, error: "Enter a reason for voiding this invoice." };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findUnique({
        where: { id: invoiceId },
        include: { lines: true, customer: { select: { id: true, companyName: true } } },
      });
      if (!invoice) throw new Error("Invoice not found.");
      if (invoice.status === "VOID") throw new Error("That invoice is already void.");
      if (num(invoice.amountPaid) > 0) {
        throw new Error(
          "This invoice has payments applied. Remove the payments before voiding.",
        );
      }

      // Put the parts back and log the reversal movement.
      for (const line of invoice.lines) {
        if (line.itemType !== "INVENTORY" || !line.productId) continue;
        const qty = num(line.quantity);
        const updated = await tx.product.update({
          where: { id: line.productId },
          data: { quantityOnHand: { increment: qty } },
          select: { quantityOnHand: true },
        });
        await tx.inventoryMovement.create({
          data: {
            productId: line.productId,
            type: "SALE_RETURN",
            quantity: qty,
            unitCost: num(line.unitCost),
            balanceAfter: num(updated.quantityOnHand),
            referenceType: "INVOICE_VOID",
            referenceId: invoice.id,
            referenceNumber: invoice.invoiceNo,
            memo: "Void of " + invoice.invoiceNo,
            createdById: user.id,
          },
        });
      }

      // Mirror-image journal entry rather than deleting the original.
      const original = await tx.journalEntry.findFirst({
        where: { invoiceId: invoice.id, isReversal: false },
        include: { lines: { include: { account: true } } },
      });

      if (original) {
        await postJournalEntry({
          tx,
          source: "INVOICE_VOID",
          memo: "Void of invoice " + invoice.invoiceNo + " - " + reason.trim(),
          referenceType: "INVOICE",
          referenceId: invoice.id,
          invoiceId: invoice.id,
          createdById: user.id,
          isReversal: true,
          reversesId: original.id,
          lines: original.lines.map((l) => ({
            accountNumber: l.account.number,
            // Swap the sides.
            debit: num(l.credit),
            credit: num(l.debit),
            memo: "Void " + invoice.invoiceNo,
            customerId: l.customerId,
            vendorId: l.vendorId,
          })),
        });
      }

      await tx.customer.update({
        where: { id: invoice.customerId },
        data: { balance: { decrement: num(invoice.total) } },
      });

      await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          status: "VOID",
          voidedAt: new Date(),
          voidReason: reason.trim(),
          balanceDue: 0,
        },
      });

      await writeAuditLog({
        tx,
        user,
        action: "VOID",
        entity: "Invoice",
        entityId: invoice.id,
        isSensitive: true,
        summary:
          user.fullName +
          " voided invoice " +
          invoice.invoiceNo +
          " (" +
          num(invoice.total).toFixed(2) +
          ") for " +
          invoice.customer.companyName +
          ". Reason: " +
          reason.trim(),
      });
    });

    revalidatePath("/dashboard/invoices");
    return { ok: true, data: { id: invoiceId } };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not void the invoice.";
    return { ok: false, error: message };
  }
}
