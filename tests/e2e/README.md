# End-to-end suites

Two Playwright scripts that drive a running instance through the behaviour
that actually matters: the cost firewall, the price floor, and the money
trail from purchase order to payment.

They are plain `.mjs` scripts rather than a `@playwright/test` project
because they assert against a *live seeded database* and run in a fixed
order — suite 2 reads stock that suite 1 moved. Promoting them to a proper
test project with per-test fixtures is the natural next step.

## Running them

```bash
npm run build && npm run start -- -p 3100
```

```bash
npm run db:seed
```

```bash
node tests/e2e/01-invoicing-and-cost-firewall.mjs
```

```bash
node tests/e2e/02-purchasing-payables-permissions.mjs
```

Requires `playwright` and a Chromium build available to it:

```bash
npm i -D playwright && npx playwright install chromium
```

Override the target with `E2E_BASE_URL`, and the screenshot directory with
`E2E_OUT`.

## What they cover

**01 — invoicing and the cost firewall (41 checks)**

- counter / manager / accountant permission boundaries
- `/api/items/search` asserted at HTTP level with a counter session cookie,
  against the literal seeded cost value — the check that proves the firewall
  is a serialization control and not just hidden columns
- customer pricing by price level, item lookup by OEM cross-reference
- a below-minimum line: the live warning, the blocked save, a **wrong**
  override code rejected server-side, then a valid one accepted
- the invoice detail and the printable invoice, per role

**02 — purchasing, payables, receivables and permissions (55 checks)**

- raise a PO, receive it short, assert the weighted-average cost roll-in
  and that quantity-on-order falls correctly
- bill the item receipt (asserting it does not post the ledger twice),
  then pay the bill
- take a customer payment with an overpayment left on account
- 11 permission denials on the new screens for a counter login
- trial balance in balance with no cached drift, and inventory valuation
  reconciling to the Inventory Asset account

## Re-runnability

Both suites can be run repeatedly against the same database. Two things
made that work and are worth preserving if you edit them:

- vendor invoice numbers are generated per run, because the application
  rejects a duplicate invoice number for the same vendor (correctly)
- the PO cost assertion checks a plausible range rather than a fixed
  literal, because a part's last purchase cost legitimately changes every
  time the suite receives stock
