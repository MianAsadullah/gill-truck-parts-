# Gill Truck Parts — Enterprise Management System

Inventory, counter sales, purchasing and accounting for a heavy-duty truck
parts business, built as a QuickBooks Desktop Enterprise look-alike.

Next.js 15 (App Router) · TypeScript · Tailwind CSS · Prisma · PostgreSQL

---

## What actually runs today

Every screen below has been exercised end to end against a live PostgreSQL
database and a real browser — **96 automated checks across two suites**, plus
a ledger-integrity script that re-derives the arithmetic independently of the
application. See [Verification](#verification).

### Modules

| Module | Routes | What it does |
| --- | --- | --- |
| **Sign in** | `/login` | Session cookies, bcrypt, audit-logged including failures |
| **Home** | `/dashboard` | QuickBooks workflow diagram, balances, reminders — permission-gated |
| **Counter POS / Invoicing** | `/dashboard/invoices`, `/new`, `/[id]`, `/[id]/print` | Parts + manual labor lines, live totals, item/customer lookup, minimum-price enforcement, manager override, printable invoice |
| **Receive Payments** | `/dashboard/payments/new` | Auto-apply oldest-first, partial payments, unapplied credits |
| **Item List & Inventory** | `/dashboard/items`, `/new`, `/[id]`, `/adjust` | Product master with OEM cross-references, reorder report, physical-count adjustment posting to shrinkage |
| **Customers** | `/dashboard/customers` | Balances, credit limits, vehicles, over-limit flags |
| **Vendors** | `/dashboard/vendors` | Balances, terms, PO/bill/part counts |
| **Purchase Orders** | `/dashboard/purchase-orders`, `/new`, `/[id]` | Raise, issue, close short, cancel; quantity-on-order tracking |
| **Receiving** | `/dashboard/purchase-orders/[id]/receive` | Partial receipts, per-line landed cost, **live weighted-average cost preview**, posts DR Inventory / CR A/P |
| **Bills** | `/dashboard/bills`, `/new` | Bills against item receipts (no double posting) or free-form expense bills |
| **Pay Bills** | `/dashboard/bills?filter=unpaid` | Multi-vendor payment run, pay-all / pay-overdue, per-vendor documents |
| **Accounting** | `/dashboard/accounting/accounts`, `/general-ledger`, `/trial-balance`, `/ar-aging`, `/ap-aging` | Chart of accounts, GL detail with running balance, trial balance, both agings |
| **Reports** | `/dashboard/reports`, `/sales-summary`, `/inventory-valuation`, `/sales-tax` | Sales by item with margin, valuation reconciled to the GL, tax liability reconciled to Sales Tax Payable |
| **Audit Trail** | `/dashboard/audit` | Filterable append-only log plus a price-override register by approver |
| **Preferences** | `/dashboard/settings` | Company, users, and the permission matrix (read-only) |
| **APIs** | `/api/items/search`, `/api/customers/search`, `/api/customers/[id]/open-invoices` | Cost-firewalled lookup endpoints |

### Known limitations

- **Preferences is read-only.** Company details, users, terms and tax codes
  are changed through the seed or the database.
- **Editing a posted invoice** is not implemented. `voidInvoice` is, and it
  reverses the GL and returns stock correctly.
- **Record Deposits** is not implemented; payments post straight to the
  chosen bank account rather than through Undeposited Funds.
- **Sales tax** is a single flat rate per code. Multi-jurisdiction
  (state + county + district) tax would need a tax-group model.
- **The e2e suites are plain scripts, not a test project.** They live in
  `tests/e2e/` and run in order against a live seeded database. Promoting
  them to `@playwright/test` with per-test fixtures, and adding unit tests
  for `money.ts` / `pricing.ts` / `ledger.ts`, is the natural next step.

## Getting started

```bash
npm install
```

```bash
cp .env.example .env
```

Point `DATABASE_URL` at a PostgreSQL 14+ database (local or Supabase), set
`SESSION_SECRET` to at least 32 random characters, then:

```bash
npx prisma db push && npm run db:seed
```

```bash
npm run dev
```

### Demo logins

All five accounts use the password `parts123`. The roles exist to make the
permission boundaries visible — sign in as `counter` and then as `mgr` on the
same invoice to see the difference.

| User | Role | Sees cost? | Override code |
| --- | --- | --- | --- |
| `admin` | Administrator | yes | `9999` |
| `mgr` | Store Manager | yes, and may approve overrides | `4821` |
| `counter` | Counter Sales | **no** | — |
| `acct` | Accountant | yes | — |
| `purch` | Purchasing Agent | yes | — |

---

## The two rules the system is built around

### 1. Counter staff never see cost

This is enforced in four places, not one:

1. **Permission** — `inventory.view_cost` is absent from the `COUNTER_SALES`
   role (`src/lib/permissions.ts`).
2. **Serialization** — `toProductDTO()` (`src/lib/product-dto.ts`) is the only
   sanctioned way to send a `Product` to a browser. For an unprivileged
   caller the cost keys are *absent from the object*, not null or zero.
3. **Query** — `PRODUCT_SAFE_SELECT` keeps cost columns out of the SQL
   entirely where a result is known to be client-bound.
4. **Rendering** — cost columns are not rendered, and the numbers behind them
   do not exist client-side, so forcing the flag in devtools yields blank
   cells rather than leaked figures.

Point 2 is the one that matters most. React Server Components serialize props
as JSON into the HTML stream, so "we just don't display it" is **not** a
control — the number would sit in the page source. The firewall has to remove
the field, and that is what the DTO layer does.

The automated suite asserts this at the API level, with a counter session
cookie, against the literal seeded cost value.

### 2. Nothing sells below its minimum price without a logged approval

`Product.minimumPrice` is the floor. When a line falls under it:

- the clerk sees the shortfall per unit, the percentage and the total
  concession in dollars, live, as they type
- saving is blocked and the manager-approval dialog opens
- the manager's code is verified **server-side** against a bcrypt hash
- the approver's role must still carry `pricing.approve_override` — a
  demoted manager's old code stops working
- the discount is checked against that role's `maxDiscountPct` ceiling, so a
  25%-limited manager cannot authorize a 60% giveaway
- an immutable `PriceOverride` row and a sensitive `AuditLog` entry are
  written **inside the same transaction as the invoice**, so there is no state
  where the sale exists without its approval record
- a *rejected* code is also logged, and the client detaches the failed
  override so the line does not falsely appear approved

The client-side check is a courtesy. `assertLinePricing` on the server is the
control, and it runs inside the invoice transaction — a hand-rolled POST that
skips the UI hits exactly the same wall.

---

## Architecture

```
prisma/
  schema.prisma          26 models: RBAC, inventory, sales, purchasing, GL, audit
  seed.ts                roles, permissions, COA, 28 parts with OEM cross-refs
scripts/
  verify-integrity.mts   trial balance + ledger/stock/audit reconciliation
tests/e2e/
  01-invoicing-and-cost-firewall.mjs        41 checks
  02-purchasing-payables-permissions.mjs    55 checks
src/
  app/
    layout.tsx           fixed desktop shell
    globals.css          the QuickBooks design system (see below)
    login/               sign-in window
    dashboard/
      layout.tsx         menu bar + icon bar + status bar, shortcuts filtered by permission
      page.tsx           home workflow diagram
      invoices/          list, new, [id], [id]/print
      [...slug]/         not-found window for unknown addresses
    api/                 item and customer lookup
  components/
    qb/                  Ui, Modal, MenuBar, IconBar, StatusBar, Workflow
    invoices/            InvoiceForm, ItemLookupModal, CustomerLookupModal, PriceOverrideModal
  lib/
    permissions.ts       the RBAC matrix — single source of truth
    auth.ts              sessions, password + override-code verification
    product-dto.ts       the cost firewall
    pricing.ts           price resolution and the minimum-price gate (isomorphic)
    ledger.ts            double-entry posting; refuses to write an unbalanced entry
    money.ts             exact money arithmetic
    sequence.ts          gap-free, race-safe document numbering
    audit.ts             append-only audit writes
  server/actions/        invoices.ts, auth.ts
```

### Money

Every monetary column is `Decimal(14,4)`. No floats anywhere in the database.
In JavaScript, `extend(qty, rate)` multiplies in integer mills and rounds once,
half-up — matching QuickBooks, and matching what a customer gets when they
check the math by hand at the counter.

### Double-entry

`postJournalEntry()` refuses to write an entry whose debits and credits differ
by a cent, and it must be called inside a transaction. An invoice posts:

```
DR  Accounts Receivable      total
  CR  Parts Sales                  parts revenue
  CR  Service & Labor Income       labor revenue
  CR  Sales Tax Payable            tax
DR  Cost of Goods Sold       cost of stocked parts
  CR  Inventory Asset              same
```

The COGS pair is omitted entirely for a labor-only ticket, so a service
invoice never touches inventory accounts. Voids post a mirror-image reversal
rather than deleting history.

### Parts vs. labor on one invoice

A line with a `productId` is a part: it snapshots cost, writes an
`InventoryMovement`, decrements `quantityOnHand` and is bound by the price
floor. A line with `isManual: true` and no `productId` is labor or a
misc. charge: free-form description and rate, no stock effect, no floor,
posted to Service Income. Both live in the same grid, which is how a repair
ticket actually reads.

### Inventory

`quantityOnHand` is never the only record. Every change writes a signed
`InventoryMovement` with a `balanceAfter` snapshot in the same transaction, so
stock is always reconstructable and a discrepancy is traceable to a document.

### Part-number lookup

Counter staff search by whatever they have: our SKU, the OEM number off the
old part, an interchange number, a barcode, or a few words of description.
`ProductCrossReference.normalized` stores an uppercased alphanumeric form so
`RE-50749`, `re 50749` and `RE50749` all find the same part through an indexed
lookup. Results are ranked the way a counter conversation goes — exact
barcode, exact SKU, cross-reference, prefix, then description.

---

## The QuickBooks aesthetic

The design tokens in `tailwind.config.ts` and the component layer in
`src/app/globals.css` reproduce QuickBooks Desktop Enterprise 2021:

- 11px Tahoma, 20px grid rows, 22px inputs, 2px maximum border radius
- gradient chrome, inset field bevels, raised push-buttons
- blue title bars, the light-blue transaction ribbon with Main / Formatting /
  Send-Ship / Reports tabs and captioned command groups
- the dark left icon bar, collapsible and persisted per browser
- a status bar carrying company, user, role and clock
- grid cells that are borderless until hovered or focused, the way QuickBooks
  line-item entry behaves

Classes are real CSS (`.qb-input`, `.qb-grid`, `.qb-btn`), not utility soup,
so a screen reads as markup rather than as a wall of class names.

Keyboard behaviour is part of the look: `Ctrl+I` opens a new invoice, `Ctrl+L`
the item list, `Ctrl+A` the chart of accounts; menus switch on hover once
open; lookup windows take arrow keys and `Enter`; `Esc` closes; `Enter` inside
the grid does not submit the invoice.

---

## Verification

```bash
npx tsc --noEmit && npx next build
```

```bash
npm run verify
```

`npm run verify` re-computes the most recent invoice's arithmetic independently
of the application, proves its journal entry balances and that the A/R debit
equals the invoice total, confirms manual labor lines produced no stock
movement, prints a full trial balance, and checks that approved *and rejected*
override attempts were audit-logged.

Two Playwright suites in `tests/e2e/` cover the behaviour that matters
(`npm run test:e2e`, with the app running on port 3100 — see
`tests/e2e/README.md`):

**Suite 1 — invoicing and the cost firewall (41 checks).** Counter vs. manager
vs. accountant boundaries; the item-search API asserted at HTTP level with a
counter session cookie against the literal seeded cost; the price-floor block;
a wrong override code; a correct one; the printable invoice.

**Suite 2 — purchasing, payables and receivables (55 checks).** Raise a PO,
receive it short, assert the weighted-average roll-in, bill the receipt, pay
the bill, take a customer payment with an overpayment, then 11 permission
denials and the reconciliation reports.

### Two defects these checks caught

Worth recording, because both were invisible from reading the code:

1. **`watch()` did not re-render on nested field-array changes** (RHF 7.92).
   The Amount column, the totals panel and the live price check all kept stale
   values while the input showed what the clerk had typed. Fixed by switching
   to `useWatch`. The server-side floor check meant this could never produce an
   underpriced invoice — but the clerk got no warning until they hit Save.

2. **The seed wrote opening balances directly to `Account.balance`** with no
   journal entry behind them. The trial balance sums *postings* rather than the
   cached column — deliberately, since a trial balance built from the figure it
   is meant to validate proves nothing — so it correctly reported drift, and
   the inventory valuation correctly disagreed with the ledger. Both reports
   were right; the seed was lying. It now posts a real `JE-OPENING` entry
   (DR Inventory Asset / CR Owner's Capital).

## Deploying on Supabase

The schema targets PostgreSQL and uses no Prisma features Supabase lacks. Use
the pooled connection string for `DATABASE_URL` and the direct one for
`DIRECT_URL` so migrations run outside PgBouncer:

```
DATABASE_URL="postgresql://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:6543/postgres?pgbouncer=true"
DIRECT_URL="postgresql://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:5432/postgres"
```

If you expose tables through Supabase's auto-generated REST API, add row-level
security policies on `products` restricting the cost columns, and a trigger on
`audit_logs` raising on `UPDATE`/`DELETE`. The application enforces both today;
the database should enforce them too if anything other than this app can reach
it.
