/**
 * Money and quantity arithmetic.
 *
 * Prisma gives us Decimal on the server, but Decimal cannot cross the
 * server/client boundary in RSC props, so DTOs carry plain numbers. To keep
 * those numbers exact we never chain floating-point multiplications: every
 * monetary product is computed in integer "mills" (4 dp, matching the
 * Decimal(14,4) columns) and rounded once, half-up, at the end.
 *
 * Half-up (not banker's rounding) is deliberate: it matches QuickBooks and
 * is what the customer standing at the counter expects when they check the
 * math by hand.
 */

/** Anything that might arrive where a number is wanted. */
export type Numeric = number | string | { toString(): string } | null | undefined;

const SCALE = 10_000; // 4 dp, matches Decimal(14,4)

/** Coerce a Prisma Decimal / string / number / null into a finite number. */
export function num(value: Numeric): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = typeof value === "string" ? Number(value) : Number(value.toString());
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Round half-up to `dp` decimal places, immune to 1.005 -> 1.00 float error. */
export function round(value: number, dp = 2): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** dp;
  // The epsilon nudge corrects values like 1.005 that are stored as
  // 1.00499999999999989 and would otherwise round down.
  const scaled = value * factor;
  const nudged =
    scaled >= 0
      ? Math.floor(scaled + 0.5 + Number.EPSILON * Math.abs(scaled))
      : Math.ceil(scaled - 0.5 - Number.EPSILON * Math.abs(scaled));
  return nudged / factor;
}

export const round2 = (v: number) => round(v, 2);
export const round4 = (v: number) => round(v, 4);

/**
 * quantity x rate, exact. Both operands are taken to 4 dp, multiplied as
 * integers, then rounded once to cents.
 */
export function extend(quantity: Numeric, rate: Numeric): number {
  const q = Math.round(num(quantity) * SCALE);
  const r = Math.round(num(rate) * SCALE);
  // q and r are mills; their product is in SCALE^2, so divide back out.
  return round2((q * r) / (SCALE * SCALE));
}

/** Sum a list of money values without accumulating float drift. */
export function sumMoney(values: Numeric[]): number {
  const cents = values.reduce<number>((acc, v) => acc + Math.round(num(v) * 100), 0);
  return cents / 100;
}

/** value x rate (a tax or discount rate), rounded to cents. */
export function applyRate(value: Numeric, rate: Numeric): number {
  return round2(num(value) * num(rate));
}

/** 1,234.50 — the invoice-grid format: no symbol, always 2 dp. */
export function formatMoney(value: Numeric, opts?: { blankZero?: boolean }): string {
  const n = num(value);
  if (opts?.blankZero && n === 0) return "";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** $1,234.50 — for totals panels and report headers. */
export function formatCurrency(value: Numeric): string {
  const n = num(value);
  const body = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return n < 0 ? "-$" + body : "$" + body;
}

/** Accounting style: negatives in parentheses, as QuickBooks reports show. */
export function formatAccounting(value: Numeric): string {
  const n = round2(num(value));
  const body = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return n < 0 ? "(" + body + ")" : body;
}

/** Quantities drop trailing zeros: 3 not 3.0000, but 2.5 stays 2.5. */
export function formatQty(value: Numeric): string {
  const n = round4(num(value));
  if (Number.isInteger(n)) return String(n);
  return String(parseFloat(n.toFixed(4)));
}

export function formatPercent(rate: Numeric, dp = 2): string {
  return round(num(rate) * 100, dp).toFixed(dp) + "%";
}

/**
 * Parse what a human typed into a money field: strips currency symbols and
 * thousands separators, tolerates a bare "." or "-" mid-typing, and reads
 * "(12.34)" as -12.34.
 */
export function parseMoneyInput(input: string): number | null {
  if (input == null) return null;
  let s = String(input).trim();
  if (s === "" || s === "-" || s === "." || s === "-.") return null;
  let negative = false;
  if (s.startsWith("(") && s.endsWith(")")) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[^0-9.\-]/g, "");
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  }
  if (s === "" || s === "." || !/^[0-9]*\.?[0-9]*$/.test(s)) return null;
  const value = Number(s);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

/** Gross profit percent of revenue. Returns null when revenue is 0. */
export function marginPct(revenue: Numeric, cost: Numeric): number | null {
  const r = num(revenue);
  if (r === 0) return null;
  return (r - num(cost)) / r;
}
