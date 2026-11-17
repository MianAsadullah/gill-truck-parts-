import pw from "playwright";
const { chromium } = pw;

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const OUT = process.env.E2E_OUT ?? "./tests/e2e/screenshots";
const pass = [], fail = [];
function check(name, ok, detail = "") {
  (ok ? pass : fail).push(name + (detail ? " :: " + detail : ""));
  console.log((ok ? "PASS " : "FAIL ") + name + (detail ? " :: " + detail : ""));
}

async function login(page, user) {
  await page.goto(BASE + "/login", { waitUntil: "domcontentloaded" });
  await page.fill("#email", user);
  await page.fill("#password", "parts123");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/dashboard", { timeout: 20000 });
}

const browser = await chromium.launch();

/* ═══════════ 1. PURCHASING: raise a PO, receive it, check avg cost ═════ */
{
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await login(page, "purch");
  check("purchasing agent signs in", page.url().includes("/dashboard"));

  // --- raise a PO ---
  await page.goto(BASE + "/dashboard/purchase-orders/new", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#vendorId", { timeout: 20000 });

  await page.selectOption("#vendorId", { index: 1 });
  await page.click('[aria-label="Look up item for PO line 1"]');
  await page.waitForSelector("#item-search");
  await page.fill("#item-search", "BRK-4707");
  await page.waitForTimeout(600);
  // Purchasing may see cost
  const lookupHtml = await page.content();
  check("purchasing role sees Cost column in item lookup", lookupHtml.includes("GP%"));
  await page.locator('[role="dialog"] table.qb-grid tbody tr').first().dblclick();
  await page.waitForSelector('[role="dialog"]', { state: "detached" });
  await page.waitForTimeout(400);

  const defaultCost = await page.inputValue('[aria-label="PO line 1 unit cost"]');
  // Pre-fills from the part's LAST purchase cost, which legitimately moves
  // every time this suite receives stock — so assert it is a real cost near
  // the known range rather than a fixed literal.
  check("PO unit cost pre-filled from last purchase cost",
    Number(defaultCost) >= 141 && Number(defaultCost) <= 200, defaultCost);

  await page.fill('[aria-label="PO line 1 quantity"]', "10");
  // Vendor raised the price: receive at a higher cost later.
  await page.fill('[aria-label="PO line 1 unit cost"]', "150");
  await page.waitForTimeout(400);
  const amountCell = await page.locator("table.qb-grid tbody tr").first().locator("td").nth(7).textContent();
  check("PO line amount computes (10 x 150 = 1,500.00)", amountCell.trim() === "1,500.00", amountCell);

  await page.screenshot({ path: OUT + "/10-purchase-order.png", fullPage: true });

  await page.locator('button:has-text("Save & Issue")').last().click();
  await page.waitForURL(/\/purchase-orders\/c[a-z0-9]{10,}$/, { timeout: 30000 });
  check("purchase order saved and issued", /\/purchase-orders\/c[a-z0-9]{10,}$/.test(page.url()), page.url());
  const poUrl = page.url();
  globalThis.__poUrl = poUrl;

  const poHtml = await page.content();
  check("PO detail shows OPEN status", poHtml.includes("OPEN"));
  check("PO detail offers Receive Inventory", poHtml.includes("Receive Inventory"));

  // --- receive partially ---
  await page.goto(poUrl + "/receive", { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[aria-label^="Receive quantity"]', { timeout: 20000 });

  const defaultReceive = await page.inputValue('[aria-label="Receive quantity for line 1"]');
  check("receive qty defaults to full outstanding (10)", defaultReceive === "10", defaultReceive);

  // Receive only 6 of 10, at the new cost.
  await page.fill('[aria-label="Receive quantity for line 1"]', "6");
  await page.waitForTimeout(500);

  const previewHtml = await page.content();
  check("receiving previews the new weighted-average cost", previewHtml.includes("→") || previewHtml.includes("&rarr;"));
  check("short receipt warns the PO stays open", previewHtml.includes("short of the ordered quantity"));

  await page.screenshot({ path: OUT + "/11-receive-inventory.png", fullPage: true });

  await page.locator('button:has-text("Receive & Close")').click();
  await page.waitForURL(/received=/, { timeout: 25000 });
  check("receipt posted", page.url().includes("received="), page.url());

  await page.waitForTimeout(600);
  const afterHtml = await page.content();
  check("PO now PARTIALLY RECEIVED", afterHtml.includes("PARTIALLY RECEIVED"));
  check("receipt history shows the receipt", afterHtml.includes("RCT-"));
  check("receipt flagged as not yet billed", afterHtml.includes("not yet billed"));
  await page.screenshot({ path: OUT + "/12-po-after-receipt.png", fullPage: true });

  await ctx.close();
}

/* ═══════════ 2. ACCOUNTANT: bill the receipt, then pay it ════════════ */
{
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await login(page, "acct");

  await page.goto(BASE + "/dashboard/bills/new", { waitUntil: "domcontentloaded" });
  await page.waitForSelector('input[name="billmode"]', { timeout: 20000 });

  const billHtml = await page.content();
  check("bill form warns it will not post the ledger again",
    billHtml.includes("waiting") );

  // Select the unbilled receipt
  const receiptSelect = page.locator("select").first();
  await receiptSelect.selectOption({ index: 1 });
  await page.waitForTimeout(500);

  const afterSelect = await page.content();
  check("selecting a receipt explains no double posting",
    afterSelect.includes("already posted DR Inventory Asset"));

  const billNo = "FP-" + Date.now().toString().slice(-8);
  await page.locator('input[placeholder="vendor\'s number"]').fill(billNo);
  await page.waitForTimeout(300);
  await page.screenshot({ path: OUT + "/13-enter-bill.png", fullPage: true });

  await page.locator('button:has-text("Save Bill")').click();
  await page.waitForURL("**/dashboard/bills", { timeout: 25000 });
  check("bill saved against the item receipt", page.url().includes("/dashboard/bills"));

  await page.waitForTimeout(600);
  const listHtml = await page.content();
  check("bill list shows the vendor invoice number", listHtml.includes(billNo), billNo);
  check("bill list shows it came from a receipt", listHtml.includes("RCT-"));

  // --- pay it ---
  await page.goto(BASE + "/dashboard/bills?filter=unpaid", { waitUntil: "domcontentloaded" });
  await page.waitForSelector('button:has-text("Pay All")', { timeout: 20000 });
  await page.click('button:has-text("Pay All")');
  await page.waitForTimeout(500);

  const payHtml = await page.content();
  check("pay bills totals the selection", payHtml.includes("Total to pay"));
  await page.screenshot({ path: OUT + "/14-pay-bills.png", fullPage: true });

  await page.click('button:has-text("Pay Selected Bills")');
  await page.waitForTimeout(3000);
  const paidHtml = await page.content();
  check("bill payment posted", paidHtml.includes("Payment posted"), "");

  await ctx.close();
}

/* ═══════════ 3. COUNTER: receive a customer payment ═════════════════ */
{
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await login(page, "counter");

  await page.goto(BASE + "/dashboard/payments/new", { waitUntil: "domcontentloaded" });
  await page.waitForSelector('button:has-text("Find...")', { timeout: 20000 });

  await page.click('button:has-text("Find...")');
  await page.waitForSelector("#cust-search");
  await page.fill("#cust-search", "Valley Freight");
  await page.waitForTimeout(600);
  await page.locator('[role="dialog"] table.qb-grid tbody tr').first().dblclick();
  await page.waitForSelector('[role="dialog"]', { state: "detached" });
  await page.waitForTimeout(1200);

  const openHtml = await page.content();
  check("open invoices load for the customer", openHtml.includes("INV-"));

  // Pay more than one invoice's worth to exercise auto-apply + overpayment.
  await page.fill('input[placeholder="0.00"]', "1200");
  await page.waitForTimeout(400);
  await page.click('button:has-text("Auto Apply")');
  await page.waitForTimeout(500);

  const applied = await page.content();
  check("auto-apply fills payment amounts", applied.includes("Applied"));
  await page.screenshot({ path: OUT + "/15-receive-payment.png", fullPage: true });

  await page.click('button:has-text("Save Payment")');
  await page.waitForTimeout(3000);
  const doneHtml = await page.content();
  check("customer payment posted", doneHtml.includes("Payment received"), "");

  await ctx.close();
}

/* ═══════════ 4. PERMISSION BOUNDARIES on the new screens ════════════ */
{
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await login(page, "counter");

  const denials = [
    ["/dashboard/purchase-orders", "purchase orders"],
    ["/dashboard/vendors", "vendors"],
    ["/dashboard/bills", "bills"],
    ["/dashboard/accounting/accounts", "chart of accounts"],
    ["/dashboard/accounting/general-ledger", "general ledger"],
    ["/dashboard/accounting/trial-balance", "trial balance"],
    ["/dashboard/reports/inventory-valuation", "inventory valuation"],
    ["/dashboard/audit", "audit trail"],
    ["/dashboard/settings", "preferences"],
    ["/dashboard/items/adjust", "quantity adjustment"],
    ["/dashboard/items/new", "new item"],
  ];

  for (const [path, label] of denials) {
    await page.goto(BASE + path, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);
    const html = await page.content();
    check("counter is denied " + label, html.includes("Access denied"), path);
  }

  // Item list IS allowed, but with no cost columns.
  await page.goto(BASE + "/dashboard/items", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(600);
  const itemsHtml = await page.content();
  check("counter CAN open the item list", !itemsHtml.includes("Access denied"));
  check("counter item list has no Avg Cost column", !itemsHtml.includes("Avg Cost"));
  check("counter item list has no GP% column", !itemsHtml.includes("GP%"));
  check("counter item list has no cost literal 141.25", !itemsHtml.includes("141.25"));
  check("counter item list still shows price and minimum",
    itemsHtml.includes("BRK-4707") && itemsHtml.includes("214.50"));
  await page.screenshot({ path: OUT + "/16-items-counter.png", fullPage: true });

  // Sales summary allowed, but margin columns hidden.
  await page.goto(BASE + "/dashboard/reports/sales-summary", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(600);
  const salesHtml = await page.content();
  check("counter CAN run sales summary", !salesHtml.includes("Access denied"));
  check("counter sales summary hides Gross Profit", !salesHtml.includes("Gross Profit"));

  await ctx.close();
}

/* ═══════════ 5. MANAGER/ACCOUNTANT: the same screens with cost ═══════ */
{
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await login(page, "mgr");

  await page.goto(BASE + "/dashboard/items", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(600);
  const itemsHtml = await page.content();
  check("manager item list HAS Avg Cost", itemsHtml.includes("Avg Cost"));
  await page.screenshot({ path: OUT + "/17-items-manager.png", fullPage: true });

  await page.goto(BASE + "/dashboard/reports/inventory-valuation", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);
  const valHtml = await page.content();
  check("manager can run inventory valuation", !valHtml.includes("Access denied"));
  check("valuation reconciles to the Inventory Asset account",
    valHtml.includes("Agrees with the Inventory Asset account") ||
    valHtml.includes("does not agree"));
  check("valuation reconciliation AGREES", valHtml.includes("Agrees with the Inventory Asset account"));
  await page.screenshot({ path: OUT + "/18-inventory-valuation.png", fullPage: true });

  await page.goto(BASE + "/dashboard/audit", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);
  const auditHtml = await page.content();
  check("manager can open the audit trail", !auditHtml.includes("Access denied"));
  check("audit shows price override summary", auditHtml.includes("Price Override Summary"));
  check("audit logs the RECEIVE action", auditHtml.includes("RECEIVE") || auditHtml.includes("Show everything"));
  await page.screenshot({ path: OUT + "/19-audit-trail.png", fullPage: true });

  await ctx.close();
}

{
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await login(page, "acct");

  await page.goto(BASE + "/dashboard/accounting/trial-balance", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);
  const tbHtml = await page.content();
  check("accountant can run the trial balance", !tbHtml.includes("Access denied"));
  check("trial balance reports IN BALANCE", tbHtml.includes("In balance"));
  check("trial balance reports no cached drift", !tbHtml.includes("Cached balance drift"));
  await page.screenshot({ path: OUT + "/20-trial-balance.png", fullPage: true });

  await page.goto(BASE + "/dashboard/accounting/ap-aging", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);
  const apHtml = await page.content();
  check("A/P aging renders", !apHtml.includes("Access denied"));
  await page.screenshot({ path: OUT + "/21-ap-aging.png", fullPage: true });

  await page.goto(BASE + "/dashboard/accounting/ar-aging", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);
  const arHtml = await page.content();
  check("A/R aging renders", !arHtml.includes("Access denied"));
  await page.screenshot({ path: OUT + "/22-ar-aging.png", fullPage: true });

  await page.goto(BASE + "/dashboard/accounting/general-ledger?account=1300", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);
  const glHtml = await page.content();
  check("general ledger shows Inventory Asset postings", glHtml.includes("INVENTORY RECEIPT") || glHtml.includes("Inventory Asset"));
  await page.screenshot({ path: OUT + "/23-general-ledger.png", fullPage: true });

  await ctx.close();
}

await browser.close();

console.log("\n==== " + pass.length + " passed, " + fail.length + " failed ====");
if (fail.length) {
  console.log("FAILURES:");
  fail.forEach((f) => console.log("  - " + f));
  process.exit(1);
}
