"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermission, AuthError, type AuthUser } from "@/lib/auth";
import { PERM, PermissionError } from "@/lib/permissions";
import { writeAuditLog, diffFields } from "@/lib/audit";
import { extend, num, round2, round4 } from "@/lib/money";
import { postJournalEntry, SYSTEM_ACCOUNTS } from "@/lib/ledger";
import { normalizePartNumber } from "@/lib/part-number";
import type { ActionResult } from "@/lib/validation/invoice";
import {
  productFormSchema,
  adjustmentSchema,
  type ProductFormValues,
  type AdjustmentValues,
} from "@/lib/validation/items";

/**
 * Product master and inventory adjustments (INV).
 *
 * Two invariants this file protects:
 *
 *   1. minimumPrice may never exceed standardPrice. A floor above list makes
 *      every sale of that part require an override, which is how a typo in
 *      the catalog turns into a counter queue.
 *   2. Changing cost is a privileged act, separate from changing price. The
 *      schema carries both, but `updateProduct` silently drops cost fields
 *      for a caller without inventory.view_cost rather than trusting that
 *      the form did not submit them.
 */

async function guard(
  perm: (typeof PERM)[keyof typeof PERM],
): Promise<{ user: AuthUser } | { error: string }> {
  try {
    return { user: await requirePermission(perm) };
  } catch (err) {
    if (err instanceof PermissionError) {
      return { error: "You do not have permission to perform this action." };
    }
    if (err instanceof AuthError) {
      return { error: "Your session has expired. Please sign in again." };
    }
    throw err;
  }
}

export async function saveProduct(
  input: ProductFormValues,
): Promise<ActionResult<{ id: string; sku: string; created: boolean }>> {
  const g = await guard(PERM.INVENTORY_EDIT);
  if ("error" in g) return { ok: false, error: g.error };
  const { user } = g;

  const parsed = productFormSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path.join(".");
      if (!fieldErrors[path]) fieldErrors[path] = issue.message;
    }
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Please correct the highlighted fields.",
      fieldErrors,
    };
  }
  const form = parsed.data;
  const mayEditCost = user.permissions.includes(PERM.INVENTORY_VIEW_COST);

  const clash = await prisma.product.findFirst({
    where: { sku: form.sku, ...(form.id ? { NOT: { id: form.id } } : {}) },
    select: { id: true },
  });
  if (clash) {
    return {
      ok: false,
      error: "SKU " + form.sku + " is already in use.",
      fieldErrors: { sku: "Already in use" },
    };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const base = {
        sku: form.sku,
        type: form.type,
        description: form.description,
        longDescription: form.longDescription,
        categoryId: form.categoryId,
        brandId: form.brandId,
        preferredVendorId: form.preferredVendorId,
        unitOfMeasure: form.unitOfMeasure,
        barcode: form.barcode || null,
        binLocation: form.binLocation,
        standardPrice: round2(form.standardPrice),
        minimumPrice: round2(form.minimumPrice),
        reorderPoint: round4(form.reorderPoint),
        reorderQuantity: round4(form.reorderQuantity),
        coreCharge: round2(form.coreCharge),
        isTaxable: form.isTaxable,
        isActive: form.isActive,
        // Cost is only written when the caller is allowed to see it. A
        // counter-role POST carrying averageCost is ignored, not rejected —
        // the field simply never reaches the update.
        ...(mayEditCost && form.standardCost !== null
          ? { standardCost: round4(form.standardCost) }
          : {}),
      };

      if (form.id) {
        const before = await tx.product.findUnique({ where: { id: form.id } });
        if (!before) throw new Error("That item no longer exists.");

        const product = await tx.product.update({
          where: { id: form.id },
          data: base,
          select: { id: true, sku: true },
        });

        await tx.productCrossReference.deleteMany({ where: { productId: product.id } });
        if (form.crossReferences.length > 0) {
          await tx.productCrossReference.createMany({
            data: form.crossReferences.map((x) => ({
              productId: product.id,
              type: x.type,
              number: x.number,
              normalized: normalizePartNumber(x.number),
              manufacturer: x.manufacturer,
            })),
            skipDuplicates: true,
          });
        }

        const changes = diffFields(
          before as unknown as Record<string, unknown>,
          base as unknown as Record<string, unknown>,
          [
            "sku",
            "description",
            "standardPrice",
            "minimumPrice",
            "standardCost",
            "reorderPoint",
            "binLocation",
            "isActive",
            "isTaxable",
          ],
        );

        await writeAuditLog({
          tx,
          user,
          action: "UPDATE",
          entity: "Product",
          entityId: product.id,
          // Price changes are the ones an auditor comes looking for.
          isSensitive:
            num(before.standardPrice) !== round2(form.standardPrice) ||
            num(before.minimumPrice) !== round2(form.minimumPrice),
          summary:
            user.fullName +
            " updated item " +
            product.sku +
            (changes
              ? " (" + Object.keys(changes).join(", ") + ")"
              : " (no field changes)"),
          changes,
        });

        return { id: product.id, sku: product.sku, created: false };
      }

      const product = await tx.product.create({
        data: { ...base, quantityOnHand: 0 },
        select: { id: true, sku: true },
      });

      if (form.crossReferences.length > 0) {
        await tx.productCrossReference.createMany({
          data: form.crossReferences.map((x) => ({
            productId: product.id,
            type: x.type,
            number: x.number,
            normalized: normalizePartNumber(x.number),
            manufacturer: x.manufacturer,
          })),
          skipDuplicates: true,
        });
      }

      await writeAuditLog({
        tx,
        user,
        action: "CREATE",
        entity: "Product",
        entityId: product.id,
        summary:
          user.fullName +
          " created item " +
          product.sku +
          " (" +
          form.description +
          ") at " +
          round2(form.standardPrice).toFixed(2) +
          ", minimum " +
          round2(form.minimumPrice).toFixed(2),
      });

      return { id: product.id, sku: product.sku, created: true };
    });

    revalidatePath("/dashboard/items");
    return { ok: true, data: result };
  } catch (err) {
    console.error("[saveProduct]", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "The item could not be saved.",
    };
  }
}

/* ════════════════════════════════════════════════ inventory adjustment ═══ */


/**
 * Adjust quantity on hand from a physical count (INV).
 *
 * Takes the COUNTED quantity rather than a delta, because that is what the
 * person holding the clipboard actually knows. The delta is derived here,
 * inside the transaction, from the on-hand figure at that moment — so two
 * people counting different aisles cannot overwrite each other with stale
 * arithmetic.
 *
 * Posts the value difference to Inventory Shrinkage, which is what makes a
 * write-off visible on the P&L instead of quietly vanishing from the
 * balance sheet.
 */
export async function adjustInventory(
  input: AdjustmentValues,
): Promise<ActionResult<{ lines: number; valueChange: number }>> {
  const g = await guard(PERM.INVENTORY_ADJUST);
  if ("error" in g) return { ok: false, error: g.error };
  const { user } = g;

  const parsed = adjustmentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Please correct the form.",
    };
  }
  const form = parsed.data;

  const adjustmentDate = new Date(form.adjustmentDate + "T00:00:00");
  if (Number.isNaN(adjustmentDate.getTime())) {
    return { ok: false, error: "Enter a valid adjustment date." };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      let valueChange = 0;
      let changed = 0;

      for (const line of form.lines) {
        const product = await tx.product.findUnique({
          where: { id: line.productId },
          select: {
            id: true,
            sku: true,
            type: true,
            quantityOnHand: true,
            averageCost: true,
          },
        });
        if (!product) throw new Error("An item on this adjustment no longer exists.");
        if (product.type !== "INVENTORY") {
          throw new Error(
            product.sku + " is not a stocked item and has no quantity to adjust.",
          );
        }

        const before = num(product.quantityOnHand);
        const after = round4(line.newQuantity);
        const delta = round4(after - before);
        if (delta === 0) continue;

        changed += 1;
        const unitCost = num(product.averageCost);
        valueChange = round2(valueChange + extend(delta, unitCost));

        await tx.product.update({
          where: { id: product.id },
          data: { quantityOnHand: after },
        });

        await tx.inventoryMovement.create({
          data: {
            productId: product.id,
            type: "ADJUSTMENT",
            quantity: delta,
            unitCost,
            balanceAfter: after,
            referenceType: "ADJUSTMENT",
            referenceNumber: null,
            memo: form.reason,
            createdById: user.id,
          },
        });
      }

      if (changed === 0) {
        throw new Error("Nothing to adjust — every counted quantity matches the system.");
      }

      // DR/CR depends on direction: a shortage credits inventory and debits
      // shrinkage; an overage does the reverse.
      if (Math.abs(valueChange) >= 0.005) {
        await postJournalEntry({
          tx,
          source: "INVENTORY_ADJUSTMENT",
          entryDate: adjustmentDate,
          memo: "Inventory adjustment - " + form.reason,
          referenceType: "ADJUSTMENT",
          createdById: user.id,
          lines:
            valueChange > 0
              ? [
                  {
                    accountNumber: SYSTEM_ACCOUNTS.INVENTORY,
                    debit: valueChange,
                    memo: form.reason,
                  },
                  {
                    accountNumber: SYSTEM_ACCOUNTS.INVENTORY_SHRINKAGE,
                    credit: valueChange,
                    memo: form.reason,
                  },
                ]
              : [
                  {
                    accountNumber: SYSTEM_ACCOUNTS.INVENTORY_SHRINKAGE,
                    debit: Math.abs(valueChange),
                    memo: form.reason,
                  },
                  {
                    accountNumber: SYSTEM_ACCOUNTS.INVENTORY,
                    credit: Math.abs(valueChange),
                    memo: form.reason,
                  },
                ],
        });
      }

      await writeAuditLog({
        tx,
        user,
        action: "UPDATE",
        entity: "InventoryAdjustment",
        isSensitive: true,
        summary:
          user.fullName +
          " adjusted " +
          changed +
          " item" +
          (changed === 1 ? "" : "s") +
          " with a value change of " +
          valueChange.toFixed(2) +
          ". Reason: " +
          form.reason,
        changes: { lines: changed, valueChange },
      });

      return { lines: changed, valueChange };
    });

    revalidatePath("/dashboard/items");
    revalidatePath("/dashboard");
    return { ok: true, data: result };
  } catch (err) {
    console.error("[adjustInventory]", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "The adjustment could not be posted.",
    };
  }
}
