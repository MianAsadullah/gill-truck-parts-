"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermission, AuthError, type AuthUser } from "@/lib/auth";
import { PERM, PermissionError } from "@/lib/permissions";
import { writeAuditLog } from "@/lib/audit";
import { extend, num, round2, round4, sumMoney } from "@/lib/money";
import { nextDocumentNumber } from "@/lib/sequence";
import { postJournalEntry, buildReceiptJournalLines } from "@/lib/ledger";
import type { ActionResult } from "@/lib/validation/invoice";
import {
  purchaseOrderFormSchema,
  receiveFormSchema,
  parseFormDate,
  type PurchaseOrderFormValues,
  type ReceiveFormValues,
} from "@/lib/validation/purchasing";

function fieldErrorsFrom(issues: { path: (string | number)[]; message: string }[]) {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const path = issue.path.join(".");
    if (!out[path]) out[path] = issue.message;
  }
  return out;
}

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

/* ═══════════════════════════════════════════════ create purchase order ═══ */

export async function createPurchaseOrder(
  input: PurchaseOrderFormValues,
): Promise<ActionResult<{ id: string; poNumber: string; total: number }>> {
  const g = await guard(PERM.PURCHASING_CREATE_PO);
  if ("error" in g) return { ok: false, error: g.error };
  const { user } = g;

  const parsed = purchaseOrderFormSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please correct the highlighted fields.",
      fieldErrors: fieldErrorsFrom(parsed.error.issues),
    };
  }
  const form = parsed.data;

  const orderDate = parseFormDate(form.orderDate);
  if (!orderDate) return { ok: false, error: "Enter a valid order date." };
  const expectedDate = parseFormDate(form.expectedDate);

  const vendor = await prisma.vendor.findUnique({ where: { id: form.vendorId } });
  if (!vendor) return { ok: false, error: "That vendor no longer exists." };
  if (!vendor.isActive) {
    return { ok: false, error: vendor.companyName + " is marked inactive." };
  }

  // Re-read the parts so SKU and description are snapshotted from the
  // catalog rather than trusted from the browser.
  const productIds = form.lines
    .map((l) => l.productId)
    .filter((id): id is string => !!id);
  const products = productIds.length
    ? await prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, sku: true, description: true, type: true },
      })
    : [];
  const productMap = new Map(products.map((p) => [p.id, p]));

  if (productIds.some((id) => !productMap.has(id))) {
    return { ok: false, error: "One or more items on this PO no longer exist." };
  }

  const lines = form.lines.map((line, index) => {
    const product = line.productId ? productMap.get(line.productId)! : null;
    return {
      lineNo: index + 1,
      productId: line.productId,
      sku: product?.sku ?? null,
      description: line.description || product?.description || "",
      vendorPartNo: line.vendorPartNo,
      quantityOrdered: line.quantityOrdered,
      unitCost: round4(line.unitCost),
      amount: extend(line.quantityOrdered, line.unitCost),
      isStocked: product?.type === "INVENTORY",
    };
  });

  const subtotal = sumMoney(lines.map((l) => l.amount));
  const freight = round2(form.freight);
  const total = round2(subtotal + freight);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const poNumber = await nextDocumentNumber(tx, "PO");

      const po = await tx.purchaseOrder.create({
        data: {
          poNumber,
          vendorId: vendor.id,
          orderDate,
          expectedDate,
          shipVia: form.shipVia,
          status: form.submit ? "OPEN" : "DRAFT",
          memo: form.memo,
          subtotal,
          freight,
          total,
          createdById: user.id,
          lines: {
            create: lines.map((l) => ({
              lineNo: l.lineNo,
              productId: l.productId,
              sku: l.sku,
              description: l.description,
              vendorPartNo: l.vendorPartNo,
              quantityOrdered: l.quantityOrdered,
              quantityReceived: 0,
              quantityBilled: 0,
              unitCost: l.unitCost,
              amount: l.amount,
            })),
          },
        },
        select: { id: true, poNumber: true },
      });

      // Quantity-on-order only moves for a submitted PO. A draft is not a
      // commitment and must not inflate what the reorder report thinks is
      // already coming.
      if (form.submit) {
        for (const line of lines) {
          if (!line.productId || !line.isStocked) continue;
          await tx.product.update({
            where: { id: line.productId },
            data: { quantityOnOrder: { increment: line.quantityOrdered } },
          });
        }
      }

      await writeAuditLog({
        tx,
        user,
        action: form.submit ? "POST" : "CREATE",
        entity: "PurchaseOrder",
        entityId: po.id,
        summary:
          (form.submit ? "Issued" : "Saved draft") +
          " purchase order " +
          po.poNumber +
          " to " +
          vendor.companyName +
          " for " +
          total.toFixed(2) +
          " (" +
          lines.length +
          " line" +
          (lines.length === 1 ? "" : "s") +
          ")",
        changes: { poNumber: po.poNumber, subtotal, freight, total },
      });

      return { id: po.id, poNumber: po.poNumber, total };
    });

    revalidatePath("/dashboard/purchase-orders");
    revalidatePath("/dashboard");
    return { ok: true, data: result };
  } catch (err) {
    console.error("[createPurchaseOrder]", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "The purchase order could not be saved.",
    };
  }
}

/* ═════════════════════════════════════════════════ receive against PO ═══ */

/**
 * Receive stock against a purchase order (PUR).
 *
 * This is the only path that increases inventory, and it is where weighted
 * average cost is recalculated. Everything happens in one transaction:
 *
 *   1. a Receipt + ReceiptLines document what physically arrived
 *   2. PurchaseOrderLine.quantityReceived advances (partial receipts are
 *      normal — a vendor ships what they have)
 *   3. Product.quantityOnHand goes up, quantityOnOrder comes down
 *   4. Product.averageCost is re-weighted, and lastCost is set
 *   5. an InventoryMovement records the change with a balance snapshot
 *   6. the GL is posted: DR Inventory Asset / CR Accounts Payable
 *   7. the PO status advances to PARTIALLY_RECEIVED or RECEIVED
 */
export async function receiveAgainstPurchaseOrder(
  input: ReceiveFormValues,
): Promise<
  ActionResult<{ receiptId: string; receiptNo: string; poStatus: string; value: number }>
> {
  const g = await guard(PERM.PURCHASING_RECEIVE);
  if ("error" in g) return { ok: false, error: g.error };
  const { user } = g;

  const parsed = receiveFormSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Please correct the form.",
      fieldErrors: fieldErrorsFrom(parsed.error.issues),
    };
  }
  const form = parsed.data;

  const receivedDate = parseFormDate(form.receivedDate);
  if (!receivedDate) return { ok: false, error: "Enter a valid receipt date." };

  const po = await prisma.purchaseOrder.findUnique({
    where: { id: form.poId },
    include: {
      vendor: { select: { id: true, companyName: true } },
      lines: { include: { product: { select: { id: true, sku: true, type: true } } } },
    },
  });

  if (!po) return { ok: false, error: "That purchase order no longer exists." };
  if (po.status === "DRAFT") {
    return { ok: false, error: "This purchase order is still a draft. Issue it first." };
  }
  if (po.status === "CANCELLED") {
    return { ok: false, error: "This purchase order was cancelled." };
  }
  if (po.status === "CLOSED" || po.status === "RECEIVED") {
    return { ok: false, error: "This purchase order is already fully received." };
  }

  const lineMap = new Map(po.lines.map((l) => [l.id, l]));

  // Validate every line before writing anything.
  const toReceive: {
    poLine: (typeof po.lines)[number];
    quantity: number;
    unitCost: number;
    amount: number;
  }[] = [];

  for (const line of form.lines) {
    if (line.quantity <= 0) continue;
    const poLine = lineMap.get(line.poLineId);
    if (!poLine) {
      return { ok: false, error: "A line on this receipt is not part of the purchase order." };
    }
    const outstanding = num(poLine.quantityOrdered) - num(poLine.quantityReceived);
    if (line.quantity > outstanding + 0.0001) {
      return {
        ok: false,
        error:
          "Line " +
          poLine.lineNo +
          " (" +
          (poLine.sku ?? poLine.description) +
          "): cannot receive " +
          line.quantity +
          " when only " +
          outstanding +
          " is outstanding.",
      };
    }
    toReceive.push({
      poLine,
      quantity: line.quantity,
      unitCost: round4(line.unitCost),
      amount: extend(line.quantity, line.unitCost),
    });
  }

  if (toReceive.length === 0) {
    return { ok: false, error: "Enter a quantity on at least one line." };
  }

  // Only stocked parts carry inventory value. A non-stock line on a PO
  // (shop rags, a one-off expense) is received for paperwork but posts no
  // inventory asset.
  const inventoryValue = sumMoney(
    toReceive.filter((r) => r.poLine.product?.type === "INVENTORY").map((r) => r.amount),
  );

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        const receiptNo = await nextDocumentNumber(tx, "RECEIPT");

        const receipt = await tx.receipt.create({
          data: {
            receiptNo,
            poId: po.id,
            receivedDate,
            vendorPackingSlip: form.vendorPackingSlip,
            memo: form.memo,
            createdById: user.id,
            lines: {
              create: toReceive.map((r) => ({
                poLineId: r.poLine.id,
                quantity: r.quantity,
                unitCost: r.unitCost,
                amount: r.amount,
              })),
            },
          },
          select: { id: true, receiptNo: true },
        });

        for (const r of toReceive) {
          await tx.purchaseOrderLine.update({
            where: { id: r.poLine.id },
            data: { quantityReceived: { increment: r.quantity } },
          });

          const productId = r.poLine.productId;
          if (!productId || r.poLine.product?.type !== "INVENTORY") continue;

          // ── Weighted average cost ───────────────────────────────────
          // Read inside the transaction so two receiving terminals cannot
          // both compute from the same stale on-hand figure.
          const current = await tx.product.findUniqueOrThrow({
            where: { id: productId },
            select: { quantityOnHand: true, averageCost: true, quantityOnOrder: true },
          });

          const oldQty = num(current.quantityOnHand);
          const oldAvg = num(current.averageCost);
          const newQty = round4(oldQty + r.quantity);

          // When stock was at or below zero the old average is meaningless
          // (it describes units we did not have), so this receipt's cost
          // becomes the new basis outright.
          const newAvg =
            oldQty <= 0 || newQty <= 0
              ? r.unitCost
              : round4((oldQty * oldAvg + r.quantity * r.unitCost) / newQty);

          // Never let quantityOnOrder go negative — a receipt against a PO
          // raised before this feature existed would otherwise drive it down
          // past zero and corrupt the reorder report.
          const onOrderRelief = Math.min(num(current.quantityOnOrder), r.quantity);

          const updated = await tx.product.update({
            where: { id: productId },
            data: {
              quantityOnHand: { increment: r.quantity },
              quantityOnOrder: { decrement: onOrderRelief },
              averageCost: newAvg,
              lastCost: r.unitCost,
            },
            select: { quantityOnHand: true, sku: true },
          });

          await tx.inventoryMovement.create({
            data: {
              productId,
              type: "RECEIPT",
              quantity: r.quantity,
              unitCost: r.unitCost,
              balanceAfter: num(updated.quantityOnHand),
              referenceType: "PO_RECEIPT",
              referenceId: receipt.id,
              referenceNumber: receipt.receiptNo,
              memo:
                "Received on " +
                receipt.receiptNo +
                " against " +
                po.poNumber +
                " (avg cost " +
                oldAvg.toFixed(4) +
                " -> " +
                newAvg.toFixed(4) +
                ")",
              createdById: user.id,
            },
          });
        }

        // ── PO status ────────────────────────────────────────────────
        const refreshed = await tx.purchaseOrderLine.findMany({
          where: { poId: po.id },
          select: { quantityOrdered: true, quantityReceived: true },
        });
        const fullyReceived = refreshed.every(
          (l) => num(l.quantityReceived) >= num(l.quantityOrdered) - 0.0001,
        );
        const anyReceived = refreshed.some((l) => num(l.quantityReceived) > 0);

        const nextStatus = fullyReceived
          ? ("RECEIVED" as const)
          : form.closeShort
            ? ("CLOSED" as const)
            : anyReceived
              ? ("PARTIALLY_RECEIVED" as const)
              : ("OPEN" as const);

        await tx.purchaseOrder.update({
          where: { id: po.id },
          data: {
            status: nextStatus,
            closedAt: nextStatus === "RECEIVED" || nextStatus === "CLOSED" ? new Date() : null,
          },
        });

        // Closing short releases the quantity that will never arrive.
        if (nextStatus === "CLOSED") {
          const outstanding = await tx.purchaseOrderLine.findMany({
            where: { poId: po.id },
            select: {
              productId: true,
              quantityOrdered: true,
              quantityReceived: true,
              product: { select: { type: true, quantityOnOrder: true } },
            },
          });
          for (const l of outstanding) {
            if (!l.productId || l.product?.type !== "INVENTORY") continue;
            const remaining = num(l.quantityOrdered) - num(l.quantityReceived);
            if (remaining <= 0) continue;
            const relief = Math.min(num(l.product.quantityOnOrder), remaining);
            if (relief <= 0) continue;
            await tx.product.update({
              where: { id: l.productId },
              data: { quantityOnOrder: { decrement: relief } },
            });
          }
        }

        // ── GL: DR Inventory Asset / CR Accounts Payable ─────────────
        // This is the "item receipt" posting. When the vendor's bill
        // arrives it settles this receipt and does NOT post again — see
        // createBill in actions/bills.ts.
        if (inventoryValue > 0) {
          await postJournalEntry({
            tx,
            source: "INVENTORY_RECEIPT",
            entryDate: receivedDate,
            memo:
              "Item receipt " + receipt.receiptNo + " - " + po.vendor.companyName,
            referenceType: "RECEIPT",
            referenceId: receipt.id,
            createdById: user.id,
            lines: buildReceiptJournalLines({
              vendorId: po.vendor.id,
              receiptNo: receipt.receiptNo,
              inventoryValue,
            }),
          });

          await tx.vendor.update({
            where: { id: po.vendor.id },
            data: { balance: { increment: inventoryValue } },
          });
        }

        await writeAuditLog({
          tx,
          user,
          action: "RECEIVE",
          entity: "Receipt",
          entityId: receipt.id,
          summary:
            user.fullName +
            " received " +
            toReceive.length +
            " line" +
            (toReceive.length === 1 ? "" : "s") +
            " on " +
            receipt.receiptNo +
            " against " +
            po.poNumber +
            " from " +
            po.vendor.companyName +
            " valued at " +
            inventoryValue.toFixed(2) +
            ". PO is now " +
            nextStatus +
            ".",
          changes: {
            receiptNo: receipt.receiptNo,
            poNumber: po.poNumber,
            inventoryValue,
            status: nextStatus,
            lines: toReceive.map((r) => ({
              sku: r.poLine.sku,
              quantity: r.quantity,
              unitCost: r.unitCost,
            })),
          },
        });

        return {
          receiptId: receipt.id,
          receiptNo: receipt.receiptNo,
          poStatus: nextStatus as string,
          value: inventoryValue,
        };
      },
      { timeout: 25_000 },
    );

    revalidatePath("/dashboard/purchase-orders");
    revalidatePath("/dashboard/items");
    revalidatePath("/dashboard");
    return { ok: true, data: result };
  } catch (err) {
    console.error("[receiveAgainstPurchaseOrder]", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "The receipt could not be posted.",
    };
  }
}

/* ═══════════════════════════════════════════════════════ close / cancel ══ */

export async function setPurchaseOrderStatus(
  poId: string,
  action: "issue" | "close" | "cancel",
): Promise<ActionResult<{ id: string; status: string }>> {
  const g = await guard(PERM.PURCHASING_CREATE_PO);
  if ("error" in g) return { ok: false, error: g.error };
  const { user } = g;

  try {
    const status = await prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findUnique({
        where: { id: poId },
        include: {
          vendor: { select: { companyName: true } },
          lines: {
            select: {
              productId: true,
              quantityOrdered: true,
              quantityReceived: true,
              product: { select: { type: true, quantityOnOrder: true } },
            },
          },
        },
      });
      if (!po) throw new Error("Purchase order not found.");

      if (action === "issue") {
        if (po.status !== "DRAFT") throw new Error("Only a draft can be issued.");
        for (const l of po.lines) {
          if (!l.productId || l.product?.type !== "INVENTORY") continue;
          await tx.product.update({
            where: { id: l.productId },
            data: { quantityOnOrder: { increment: num(l.quantityOrdered) } },
          });
        }
        await tx.purchaseOrder.update({ where: { id: poId }, data: { status: "OPEN" } });
        await writeAuditLog({
          tx,
          user,
          action: "POST",
          entity: "PurchaseOrder",
          entityId: poId,
          summary:
            user.fullName + " issued purchase order " + po.poNumber + " to " + po.vendor.companyName,
        });
        return "OPEN";
      }

      if (po.status === "RECEIVED" || po.status === "CLOSED" || po.status === "CANCELLED") {
        throw new Error("This purchase order is already " + po.status.toLowerCase() + ".");
      }

      // Release whatever will never arrive from quantity-on-order.
      for (const l of po.lines) {
        if (!l.productId || l.product?.type !== "INVENTORY") continue;
        const remaining = num(l.quantityOrdered) - num(l.quantityReceived);
        if (remaining <= 0) continue;
        const relief = Math.min(num(l.product.quantityOnOrder), remaining);
        if (relief <= 0) continue;
        await tx.product.update({
          where: { id: l.productId },
          data: { quantityOnOrder: { decrement: relief } },
        });
      }

      const next = action === "cancel" ? ("CANCELLED" as const) : ("CLOSED" as const);
      await tx.purchaseOrder.update({
        where: { id: poId },
        data: { status: next, closedAt: new Date() },
      });

      await writeAuditLog({
        tx,
        user,
        action: "UPDATE",
        entity: "PurchaseOrder",
        entityId: poId,
        isSensitive: true,
        summary:
          user.fullName +
          " " +
          (action === "cancel" ? "cancelled" : "closed") +
          " purchase order " +
          po.poNumber +
          " (" +
          po.vendor.companyName +
          ")",
      });

      return next as string;
    });

    revalidatePath("/dashboard/purchase-orders");
    return { ok: true, data: { id: poId, status } };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not update the purchase order.",
    };
  }
}
