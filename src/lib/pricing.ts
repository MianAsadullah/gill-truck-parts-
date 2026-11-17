/**
 * Pricing engine (SEC / SAL).
 *
 * Two jobs:
 *   1. Suggest the right price for a part given who is buying it.
 *   2. Refuse to let that price go below Product.minimumPrice unless an
 *      authorized manager has approved the specific shortfall.
 *
 * This module is isomorphic on purpose — the client imports it to show the
 * clerk a live warning as they type, and the server imports the same
 * functions to make the actual decision. The client copy is a courtesy; the
 * server copy is the control. `assertLinePricing` runs inside the invoice
 * transaction, so a hand-rolled POST that skips the UI hits the same wall.
 */

import { extend, round2, round4 } from "@/lib/money";

export type PriceLevelName = "RETAIL" | "FLEET" | "WHOLESALE" | "DEALER";

/** Default discount off list per price level, before customer-specific rates. */
export const PRICE_LEVEL_DISCOUNT: Record<PriceLevelName, number> = {
  RETAIL: 0,
  FLEET: 0.08,
  WHOLESALE: 0.15,
  DEALER: 0.22,
};

export interface PricingProduct {
  id: string;
  sku: string;
  standardPrice: number;
  minimumPrice: number;
}

export interface PricingCustomer {
  priceLevel: PriceLevelName;
  /** Customer-specific override of the level discount, 0 when unset. */
  discountPct: number;
}

/**
 * The price to pre-fill when a part is added to an invoice.
 *
 * Discounts stack as: list price, less the greater of (level discount,
 * customer discount), then clamped UP to minimumPrice. The clamp is what
 * stops a generous price level from quietly creating a below-floor sale that
 * nobody approved.
 */
export function resolvePrice(
  product: PricingProduct,
  customer?: PricingCustomer | null,
  negotiatedPrice?: number | null,
): { price: number; source: "negotiated" | "level" | "list"; clamped: boolean } {
  // A negotiated per-part price wins, but still cannot pierce the floor.
  if (negotiatedPrice != null && negotiatedPrice > 0) {
    const clamped = negotiatedPrice < product.minimumPrice;
    return {
      price: round2(clamped ? product.minimumPrice : negotiatedPrice),
      source: "negotiated",
      clamped,
    };
  }

  if (!customer) {
    return { price: round2(product.standardPrice), source: "list", clamped: false };
  }

  const levelDiscount = PRICE_LEVEL_DISCOUNT[customer.priceLevel] ?? 0;
  const discount = Math.max(levelDiscount, customer.discountPct ?? 0);
  const raw = round2(product.standardPrice * (1 - discount));
  const clamped = raw < product.minimumPrice;

  return {
    price: round2(clamped ? product.minimumPrice : raw),
    source: discount > 0 ? "level" : "list",
    clamped,
  };
}

export type PriceCheckStatus =
  /** At or above minimum. Sell it. */
  | "ok"
  /** Below minimum. Blocked unless an override is attached. */
  | "below_minimum"
  /** Negative or non-finite. Always rejected. */
  | "invalid";

export interface PriceCheck {
  status: PriceCheckStatus;
  /** Per-unit dollars below the floor. 0 when ok. */
  shortfallPerUnit: number;
  /** Total dollars conceded across the line quantity. */
  concessionAmount: number;
  /** Fraction below the floor, e.g. 0.12 for 12% under minimum. */
  discountPct: number;
  minimumPrice: number;
  message: string | null;
}

/**
 * Evaluate one line's rate against the part's floor.
 *
 * Service and manual labor lines have no product and therefore no floor —
 * callers pass `null` and get "ok" back. That is correct: shop labor is
 * priced by the service writer, not by the parts catalog.
 */
export function checkLinePrice(
  product: PricingProduct | null,
  rate: number,
  quantity: number,
): PriceCheck {
  const base: PriceCheck = {
    status: "ok",
    shortfallPerUnit: 0,
    concessionAmount: 0,
    discountPct: 0,
    minimumPrice: product?.minimumPrice ?? 0,
    message: null,
  };

  if (!Number.isFinite(rate) || rate < 0) {
    return { ...base, status: "invalid", message: "Rate must be zero or greater." };
  }
  if (!product) return base;

  const minimum = round2(product.minimumPrice);
  if (minimum <= 0) return base;
  if (round2(rate) >= minimum) return base;

  const shortfallPerUnit = round2(minimum - rate);
  const concessionAmount = Math.abs(extend(quantity, shortfallPerUnit));
  const discountPct = round4(shortfallPerUnit / minimum);

  return {
    status: "below_minimum",
    shortfallPerUnit,
    concessionAmount,
    discountPct,
    minimumPrice: minimum,
    message:
      product.sku +
      " has a minimum price of " +
      minimum.toFixed(2) +
      ". Manager approval is required to sell at " +
      round2(rate).toFixed(2) +
      ".",
  };
}

/** Raised by assertLinePricing; surfaces as a field error on the line. */
export class PricingViolationError extends Error {
  readonly statusCode = 422;
  readonly lineNo: number;
  readonly check: PriceCheck;
  constructor(lineNo: number, check: PriceCheck) {
    super(check.message ?? "Line " + lineNo + " price is not allowed.");
    this.name = "PricingViolationError";
    this.lineNo = lineNo;
    this.check = check;
  }
}

export interface OverrideGrant {
  /** Resolved by verifyOverrideCode — proof a manager authorized this. */
  approvedById: string;
  approverRole: string;
  /** Ceiling from the approver's role, e.g. 0.25 = may go 25% under. */
  maxDiscountPct: number;
  reason: string;
}

/**
 * The server-side gate. Throws unless the line is sellable.
 *
 * Three ways to fail:
 *   - rate is invalid (negative)
 *   - rate is under the floor and no override was supplied
 *   - rate is under the floor by more than the approver's role permits
 *
 * The last case is the one that matters in practice: it stops a shift
 * manager with a 25% ceiling from signing off a 60% giveaway, which is the
 * shape most internal-fraud cases take.
 */
export function assertLinePricing(args: {
  lineNo: number;
  product: PricingProduct | null;
  rate: number;
  quantity: number;
  /** True when the SELLING user may go below minimum unaided (manager+). */
  callerMaySellBelowMin: boolean;
  callerMaxDiscountPct: number;
  override?: OverrideGrant | null;
  /** CompanySettings.allowPriceOverride — a hard company-wide switch. */
  overridesEnabled: boolean;
}): PriceCheck {
  const check = checkLinePrice(args.product, args.rate, args.quantity);

  if (check.status === "invalid") throw new PricingViolationError(args.lineNo, check);
  if (check.status === "ok") return check;

  // Below minimum from here down.
  if (!args.overridesEnabled) {
    throw new PricingViolationError(args.lineNo, {
      ...check,
      message:
        "Below-minimum pricing is disabled company-wide. " +
        (check.message ?? ""),
    });
  }

  // A manager selling at their own terminal needs no second signature, but
  // is still bound by their role's ceiling.
  if (args.callerMaySellBelowMin) {
    if (check.discountPct > args.callerMaxDiscountPct) {
      throw new PricingViolationError(args.lineNo, {
        ...check,
        message:
          "Your role may not discount more than " +
          (args.callerMaxDiscountPct * 100).toFixed(0) +
          "% below minimum. This line is " +
          (check.discountPct * 100).toFixed(1) +
          "% below.",
      });
    }
    return check;
  }

  if (!args.override) {
    throw new PricingViolationError(args.lineNo, check);
  }

  if (check.discountPct > args.override.maxDiscountPct) {
    throw new PricingViolationError(args.lineNo, {
      ...check,
      message:
        "The approving role (" +
        args.override.approverRole +
        ") may not authorize more than " +
        (args.override.maxDiscountPct * 100).toFixed(0) +
        "% below minimum. This line is " +
        (check.discountPct * 100).toFixed(1) +
        "% below.",
    });
  }

  if (!args.override.reason || args.override.reason.trim().length < 4) {
    throw new PricingViolationError(args.lineNo, {
      ...check,
      message: "A reason is required to record a price override.",
    });
  }

  return check;
}
