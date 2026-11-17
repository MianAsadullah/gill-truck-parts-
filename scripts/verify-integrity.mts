import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const n = (x: any) => Number(x);

const inv = await p.invoice.findFirst({
  orderBy: { createdAt: "desc" },
  include: { lines: { orderBy: { lineNo: "asc" } }, customer: true, overrides: true },
});
if (!inv) throw new Error("no invoice");

console.log("=== INVOICE " + inv.invoiceNo + " ===");
console.log("customer:", inv.customer.companyName, "| status:", inv.status);
console.log("subtotal", n(inv.subtotal), "tax", n(inv.taxTotal), "total", n(inv.total), "cost", n(inv.costTotal));
for (const l of inv.lines) {
  console.log(`  L${l.lineNo} ${l.sku ?? "(manual " + l.itemType + ")"} qty=${n(l.quantity)} rate=${n(l.rate)} amt=${n(l.amount)} cost=${n(l.costAmount)} manual=${l.isManual} ovr=${l.priceOverrideId ? "YES" : "-"}`);
}

// Arithmetic re-check, independently of the app.
const sub = inv.lines.reduce((s, l) => s + n(l.amount), 0);
const taxBase = inv.lines.filter(l => l.isTaxable).reduce((s, l) => s + n(l.amount), 0);
const tax = Math.round(taxBase * n(inv.taxRate) * 100) / 100;
console.log("\nrecomputed: subtotal", sub.toFixed(2), "taxBase", taxBase.toFixed(2), "tax", tax.toFixed(2), "total", (sub + tax).toFixed(2));
console.log("CHECK totals match:", Math.abs(sub + tax - n(inv.total)) < 0.005 ? "OK" : "MISMATCH");

console.log("\n=== PRICE OVERRIDES ===");
for (const o of inv.overrides) {
  console.log(`  ${o.sku}: min ${n(o.minimumPrice)} -> sold ${n(o.approvedPrice)}, ${(n(o.discountPct)*100).toFixed(1)}% below, conceded ${n(o.concessionAmount)}, reason: ${o.reason}`);
}

console.log("\n=== JOURNAL ENTRY ===");
const entries = await p.journalEntry.findMany({
  where: { invoiceId: inv.id },
  include: { lines: { include: { account: true }, orderBy: { lineNo: "asc" } } },
});
for (const e of entries) {
  console.log(` ${e.entryNo} (${e.source})`);
  let d = 0, c = 0;
  for (const l of e.lines) {
    d += n(l.debit); c += n(l.credit);
    console.log(`   ${l.account.number} ${l.account.name.padEnd(28)} DR ${n(l.debit).toFixed(2).padStart(10)}  CR ${n(l.credit).toFixed(2).padStart(10)}`);
  }
  console.log(`   ${"".padEnd(33)} == ${d.toFixed(2).padStart(10)}  == ${c.toFixed(2).padStart(10)}`);
  console.log("   CHECK balanced:", Math.abs(d - c) < 0.005 ? "OK" : "UNBALANCED");
  console.log("   CHECK AR debit equals invoice total:",
    Math.abs(n(e.lines.find(l => l.account.number === "1200")?.debit ?? 0) - n(inv.total)) < 0.005 ? "OK" : "MISMATCH");
}

console.log("\n=== INVENTORY MOVEMENTS for this invoice ===");
const mv = await p.inventoryMovement.findMany({
  where: { referenceId: inv.id },
  include: { product: { select: { sku: true, quantityOnHand: true } } },
});
for (const m of mv) {
  console.log(`  ${m.product.sku}: ${m.type} qty ${n(m.quantity)} -> balanceAfter ${n(m.balanceAfter)} (now ${n(m.product.quantityOnHand)})`);
}
const manualLines = inv.lines.filter(l => l.isManual);
console.log("CHECK manual/labor lines created no stock movement:",
  mv.length === inv.lines.filter(l => l.itemType === "INVENTORY" && l.productId).length ? "OK" : "WRONG",
  `(${manualLines.length} manual line(s), ${mv.length} movement(s))`);

console.log("\n=== TRIAL BALANCE (all accounts) ===");
const accts = await p.account.findMany({ where: { NOT: { balance: 0 } }, orderBy: { number: "asc" } });
let dr = 0, cr = 0;
for (const a of accts) {
  const debitNormal = ["ASSET","EXPENSE","COST_OF_GOODS_SOLD","OTHER_EXPENSE"].includes(a.type);
  const bal = n(a.balance);
  if (debitNormal) dr += bal; else cr += bal;
  console.log(`  ${a.number} ${a.name.padEnd(30)} ${debitNormal ? "DR" : "CR"} ${bal.toFixed(2).padStart(12)}`);
}
console.log(`  TOTAL DR ${dr.toFixed(2)}  /  TOTAL CR ${cr.toFixed(2)}`);
console.log("CHECK trial balance:", Math.abs(dr - cr) < 0.005 ? "OK (balanced)" : "OUT OF BALANCE by " + (dr-cr).toFixed(2));

console.log("\n=== AUDIT TRAIL (last 12) ===");
const logs = await p.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 12 });
for (const l of logs) {
  console.log(`  [${l.isSensitive ? "!" : " "}] ${l.action.padEnd(26)} ${l.roleCode ?? "-"} :: ${l.summary.slice(0, 120)}`);
}
// Query by action rather than scanning the last N rows: a busy day pushes
// override entries out of any fixed window, which would make this check
// report a false failure.
const [deniedCount, approvedCount, overrideCount] = await Promise.all([
  p.auditLog.count({ where: { action: "PRICE_OVERRIDE_DENIED" } }),
  p.auditLog.count({ where: { action: "PRICE_OVERRIDE_APPROVED" } }),
  p.priceOverride.count(),
]);
console.log("\nCHECK rejected override attempts logged:", deniedCount > 0 ? "OK (" + deniedCount + ")" : "NONE RECORDED");
console.log("CHECK approved overrides logged:", approvedCount > 0 ? "OK (" + approvedCount + ")" : "NONE RECORDED");
console.log("CHECK every PriceOverride row has an approval log:",
  overrideCount === 0 ? "n/a (no overrides)" : approvedCount >= overrideCount ? "OK" : "MISMATCH " + overrideCount + " rows vs " + approvedCount + " logs");

await p.$disconnect();
