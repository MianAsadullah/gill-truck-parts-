import pw from "playwright";
const { chromium } = pw;

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const OUT = process.env.E2E_OUT ?? "./tests/e2e/screenshots";
const pass = [];
const fail = [];
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

/* ═══════════════════════════ 1. COUNTER ROLE: cost firewall ═════════════ */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await login(page, "counter");
  check("counter signs in", page.url().includes("/dashboard"));

  await page.screenshot({ path: OUT + "/01-home-counter.png", fullPage: true });

  // The home page must not contain margin/cost language for counter.
  const homeHtml = await page.content();
  check("counter home has no 'Gross Profit'", !homeHtml.includes("Gross Profit"));
  check("counter home has no 'Inventory Asset' value row", !homeHtml.includes("Inventory Asset"));
  check("counter home shows the cost-hidden notice", homeHtml.includes("Purchase costs and profit margins are not available"));

  // API-level check: hit the item search endpoint directly with the counter's
  // session cookie. This is the attack a UI-only control would miss.
  const api = await page.evaluate(async () => {
    const r = await fetch("/api/items/search?q=BRK-4707");
    return { status: r.status, body: await r.text() };
  });
  check("counter can call item search", api.status === 200, "status " + api.status);
  const costKeys = ["averageCost", "lastCost", "standardCost", "grossProfit", "marginPct"];
  const leaked = costKeys.filter((k) => api.body.includes(k));
  check("item search payload contains NO cost keys for counter", leaked.length === 0, leaked.join(","));
  check("item search still returns selling price + minimum",
    api.body.includes("standardPrice") && api.body.includes("minimumPrice"));
  // The seeded cost of BRK-4707 is 141.25 — the literal must be absent.
  check("counter payload does not contain the literal cost 141.25", !api.body.includes("141.25"));

  /* ── invoice screen as counter ── */
  await page.goto(BASE + "/dashboard/invoices/new", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#customer-field", { timeout: 20000 });
  const formHtml = await page.content();
  check("counter invoice screen has no Cost column header", !/>\s*Cost\s*</.test(formHtml));
  check("counter invoice screen has no GP% column header", !formHtml.includes("GP%"));
  check("counter invoice screen shows 'cost hidden'", formHtml.includes("cost hidden"));

  // pick customer
  await page.click("#customer-field");
  await page.waitForSelector("#cust-search");
  await page.fill("#cust-search", "Valley Freight");
  await page.waitForTimeout(500);
  await page.locator('[role="dialog"] table.qb-grid tbody tr').first().dblclick();
  await page.waitForSelector('[role="dialog"]', { state: "detached", timeout: 10000 });
  await page.waitForTimeout(300);
  check("customer selected", (await page.inputValue("#customer-field")).includes("Valley Freight"));

  // pick an inventory part on line 1
  await page.click('[aria-label="Look up item for line 1"]');
  await page.waitForSelector("#item-search");
  await page.fill("#item-search", "BRK-4707");
  await page.waitForTimeout(550);
  const lookupHtml = await page.content();
  check("item lookup (counter) hides Cost/GP columns",
    !lookupHtml.includes("GP%") && !lookupHtml.includes("141.25"));
  check("item lookup shows OEM cross-reference 3600A", lookupHtml.includes("3600A"));
  await page.locator('[role="dialog"] table.qb-grid tbody tr').first().dblclick();
  await page.waitForSelector('[role="dialog"]', { state: "detached", timeout: 10000 });
  await page.waitForTimeout(400);

  const sku1 = await page.inputValue('[aria-label="Line 1 item"]');
  check("line 1 item populated", sku1 === "BRK-4707", sku1);
  const rate1 = await page.inputValue('[aria-label="Line 1 rate"]');
  // Valley Freight is FLEET with 10% customer discount: 214.50 * 0.90 = 193.05
  check("line 1 rate priced for FLEET customer (193.05)", rate1 === "193.05", rate1);

  await page.fill('[aria-label="Line 1 quantity"]', "4");
  await page.waitForTimeout(300);

  // add a manual labor line (must not touch inventory)
  await page.locator('button:has-text("+ Labor / Service")').first().click();
  await page.waitForTimeout(300);
  await page.fill('[aria-label="Line 4 description"]', "Brake job - R&R drums and shoes, 3.0 hr");
  await page.fill('[aria-label="Line 4 quantity"]', "3");
  await page.fill('[aria-label="Line 4 rate"]', "145");
  await page.waitForTimeout(400);
  check("labor line has no item lookup (is manual)",
    (await page.locator('[aria-label="Look up item for line 4"]').count()) === 0);

  await page.screenshot({ path: OUT + "/02-invoice-counter.png", fullPage: true });

  /* ── the below-minimum block ── */
  // BRK-4707 minimum is 178.00. Try 150.
  await page.fill('[aria-label="Line 1 rate"]', "150");
  await page.waitForTimeout(400);
  const warnHtml = await page.content();
  check("below-minimum warning appears for counter",
    warnHtml.includes("priced below minimum") || warnHtml.includes("minimum price of 178.00"));
  check("override needed marker on line 1",
    (await page.locator('[aria-label="Line 1 needs manager approval"]').count()) === 1);

  await page.screenshot({ path: OUT + "/03-below-minimum-block.png", fullPage: true });

  // Saving must NOT create the invoice; it must open the override dialog.
  await page.locator('button:has-text("Save & Close")').last().click();
  await page.waitForTimeout(900);
  check("save blocked, override dialog opened",
    (await page.locator("#ovr-approver").count()) === 1);
  check("still on the new-invoice screen (nothing saved)", page.url().includes("/invoices/new"));

  const dlgHtml = await page.content();
  check("dialog states the concession amount",
    dlgHtml.includes("Total concession"), "");
  await page.screenshot({ path: OUT + "/04-override-dialog.png", fullPage: true });

  /* ── wrong override code is rejected by the SERVER ── */
  await page.fill("#ovr-approver", "MG");
  await page.fill("#ovr-code", "0000");
  await page.locator('[role="dialog"] button:has-text("Approve Price")').click();
  await page.waitForTimeout(400);
  await page.locator('button:has-text("Save & Close")').last().click();
  await page.waitForTimeout(2500);
  const badHtml = await page.content();
  check("server rejects a wrong override code",
    badHtml.includes("was not accepted") || badHtml.includes("not accepted"),
    "");
  check("invoice still not saved after bad code", page.url().includes("/invoices/new"));

  /* ── correct code: counter cannot self-approve, manager code works ── */
  // Re-open the dialog via the line marker.
  await page.click('[aria-label="Line 1 needs manager approval"]');
  await page.waitForSelector("#ovr-approver");
  const selfHtml = await page.content();
  check("counter is NOT offered self-approval",
    !selfHtml.includes("may authorize this yourself"));

  await page.fill("#ovr-approver", "MG");
  await page.fill("#ovr-code", "4821");
  await page.selectOption("#ovr-reason", { index: 0 });
  await page.locator('[role="dialog"] button:has-text("Approve Price")').click();
  await page.waitForTimeout(400);
  check("override attached marker shown",
    (await page.locator('[aria-label="Line 1 override attached"]').count()) === 1);

  await page.locator('button:has-text("Save & Close")').last().click();
  await page.waitForURL(/\/dashboard\/invoices\/c/, { timeout: 25000 });
  check("invoice saved with a valid manager override", /\/invoices\/[a-z0-9]+$/.test(page.url()), page.url());

  await page.waitForTimeout(600);
  const detailHtml = await page.content();
  check("detail page (counter) shows no Cost column", !detailHtml.includes("GP%"));
  check("detail page (counter) hides the override audit panel",
    !detailHtml.includes("Price Overrides Recorded"));
  check("detail page (counter) hides the GL panel",
    !detailHtml.includes("General Ledger Posting"));
  await page.screenshot({ path: OUT + "/05-invoice-detail-counter.png", fullPage: true });

  const invoiceUrl = page.url();
  await page.goto(invoiceUrl + "/print", { waitUntil: "domcontentloaded" });
  const printHtml = await page.content();
  check("printable invoice shows parts and labor sections",
    printHtml.includes("Parts") && printHtml.includes("Labor &amp; Service"));
  check("printable invoice carries no cost figures",
    !printHtml.includes("141.25") && !printHtml.includes("Gross Profit"));
  await page.screenshot({ path: OUT + "/06-invoice-print.png", fullPage: true });

  globalThis.__invoiceUrl = invoiceUrl;
  await ctx.close();
}

/* ═══════════════════════════ 2. MANAGER ROLE: cost visible ══════════════ */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await login(page, "mgr");

  const api = await page.evaluate(async () => {
    const r = await fetch("/api/items/search?q=BRK-4707");
    return await r.text();
  });
  check("manager item search DOES include averageCost", api.includes("averageCost"));
  check("manager item search includes the real cost 141.25", api.includes("141.25"));

  await page.goto(BASE + "/dashboard/invoices/new", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#customer-field", { timeout: 20000 });
  const html = await page.content();
  check("manager invoice screen HAS a GP% column", html.includes("GP%"));

  await page.goto(globalThis.__invoiceUrl, { waitUntil: "domcontentloaded" });
  const detail = await page.content();
  check("manager sees the override audit panel", detail.includes("Price Overrides Recorded"));
  check("manager sees gross profit on the invoice", detail.includes("Gross Profit"));
  await page.screenshot({ path: OUT + "/07-invoice-detail-manager.png", fullPage: true });

  await page.goto(BASE + "/dashboard", { waitUntil: "domcontentloaded" });
  await page.screenshot({ path: OUT + "/08-home-manager.png", fullPage: true });

  await ctx.close();
}

/* ═══════════════════════════ 3. ACCOUNTANT: GL posting ══════════════════ */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await login(page, "acct");
  await page.goto(globalThis.__invoiceUrl, { waitUntil: "domcontentloaded" });
  const html = await page.content();
  check("accountant sees the GL posting panel", html.includes("General Ledger Posting"));
  check("GL panel shows Accounts Receivable", html.includes("Accounts Receivable"));
  check("GL panel shows Cost of Goods Sold", html.includes("Cost of Goods Sold"));
  await page.screenshot({ path: OUT + "/09-invoice-gl-accountant.png", fullPage: true });

  // An accountant must not be able to reach the invoice-creation form.
  await page.goto(BASE + "/dashboard/invoices/new", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".qb-banner", { timeout: 20000 });
  const denied = await page.content();
  check("accountant is denied the invoice form", denied.includes("Access denied"));
  await ctx.close();
}

await browser.close();

console.log("\n==== " + pass.length + " passed, " + fail.length + " failed ====");
if (fail.length) {
  console.log("FAILURES:");
  fail.forEach((f) => console.log("  - " + f));
  process.exit(1);
}
