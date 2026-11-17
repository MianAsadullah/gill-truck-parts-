/**
 * Role-Based Access Control (SEC)
 *
 * This file is the single source of truth for what a role may do. The DB
 * carries Permission/RolePermission rows (so an admin can re-grant at
 * runtime), but these constants are the defaults the seed installs and the
 * fallback the server uses if a role has no rows yet.
 *
 * THE RULE THAT MATTERS MOST
 * --------------------------
 * COUNTER_SALES must never obtain a purchase cost or a margin. Not through a
 * page, not through an API route, not through a server action's return value,
 * not in a React Server Component's serialized props, and not in a report.
 * `INVENTORY_VIEW_COST` is the only gate, it is checked server-side, and
 * `toProductDTO` in src/lib/product-dto.ts physically deletes the fields
 * before they can cross the wire.
 */

export const PERM = {
  // ── Inventory / cost visibility ─────────────────────────────────────────
  INVENTORY_VIEW: "inventory.view",
  INVENTORY_EDIT: "inventory.edit",
  /** Gate on averageCost / lastCost / standardCost. Never give to counter. */
  INVENTORY_VIEW_COST: "inventory.view_cost",
  /** Gate on gross-profit and margin-% figures anywhere in the UI. */
  INVENTORY_VIEW_MARGIN: "inventory.view_margin",
  INVENTORY_ADJUST: "inventory.adjust",

  // ── Pricing ─────────────────────────────────────────────────────────────
  /** May type a price below Product.minimumPrice without a manager code. */
  PRICING_SELL_BELOW_MIN: "pricing.sell_below_min",
  /** May supply the override code that authorizes someone else's low price. */
  PRICING_APPROVE_OVERRIDE: "pricing.approve_override",
  PRICING_EDIT_PRICE_LEVELS: "pricing.edit_price_levels",

  // ── Sales ───────────────────────────────────────────────────────────────
  SALES_VIEW: "sales.view",
  SALES_CREATE_INVOICE: "sales.create_invoice",
  SALES_EDIT_INVOICE: "sales.edit_invoice",
  SALES_VOID_INVOICE: "sales.void_invoice",
  SALES_RECEIVE_PAYMENT: "sales.receive_payment",

  // ── Purchasing ──────────────────────────────────────────────────────────
  PURCHASING_VIEW: "purchasing.view",
  PURCHASING_CREATE_PO: "purchasing.create_po",
  PURCHASING_RECEIVE: "purchasing.receive",
  PURCHASING_ENTER_BILL: "purchasing.enter_bill",
  PURCHASING_PAY_BILL: "purchasing.pay_bill",

  // ── Accounting ──────────────────────────────────────────────────────────
  ACCOUNTING_VIEW_GL: "accounting.view_gl",
  ACCOUNTING_POST_JOURNAL: "accounting.post_journal",
  ACCOUNTING_EDIT_COA: "accounting.edit_coa",
  ACCOUNTING_CLOSE_PERIOD: "accounting.close_period",

  // ── Reporting ───────────────────────────────────────────────────────────
  REPORTS_VIEW_SALES: "reports.view_sales",
  /** Any report with cost, GP$ or GP% columns. */
  REPORTS_VIEW_PROFIT: "reports.view_profit",
  REPORTS_VIEW_INVENTORY_VALUATION: "reports.view_inventory_valuation",
  REPORTS_EXPORT: "reports.export",

  // ── Audit / admin ───────────────────────────────────────────────────────
  AUDIT_VIEW: "audit.view",
  ADMIN_MANAGE_USERS: "admin.manage_users",
  ADMIN_SETTINGS: "admin.settings",
} as const;

export type Permission = (typeof PERM)[keyof typeof PERM];

export const PERMISSION_CATALOG: Record<
  Permission,
  { description: string; category: string }
> = {
  [PERM.INVENTORY_VIEW]: { description: "View parts and stock levels", category: "Inventory" },
  [PERM.INVENTORY_EDIT]: { description: "Create and edit parts", category: "Inventory" },
  [PERM.INVENTORY_VIEW_COST]: { description: "View purchase cost on parts", category: "Inventory" },
  [PERM.INVENTORY_VIEW_MARGIN]: { description: "View profit margin figures", category: "Inventory" },
  [PERM.INVENTORY_ADJUST]: { description: "Adjust quantity on hand", category: "Inventory" },
  [PERM.PRICING_SELL_BELOW_MIN]: { description: "Sell below minimum price without approval", category: "Pricing" },
  [PERM.PRICING_APPROVE_OVERRIDE]: { description: "Approve a below-minimum price override", category: "Pricing" },
  [PERM.PRICING_EDIT_PRICE_LEVELS]: { description: "Edit price levels and customer pricing", category: "Pricing" },
  [PERM.SALES_VIEW]: { description: "View invoices and sales orders", category: "Sales" },
  [PERM.SALES_CREATE_INVOICE]: { description: "Create invoices at the counter", category: "Sales" },
  [PERM.SALES_EDIT_INVOICE]: { description: "Edit a posted invoice", category: "Sales" },
  [PERM.SALES_VOID_INVOICE]: { description: "Void an invoice", category: "Sales" },
  [PERM.SALES_RECEIVE_PAYMENT]: { description: "Receive customer payments", category: "Sales" },
  [PERM.PURCHASING_VIEW]: { description: "View vendors and purchase orders", category: "Purchasing" },
  [PERM.PURCHASING_CREATE_PO]: { description: "Create purchase orders", category: "Purchasing" },
  [PERM.PURCHASING_RECEIVE]: { description: "Receive inventory against a PO", category: "Purchasing" },
  [PERM.PURCHASING_ENTER_BILL]: { description: "Enter vendor bills", category: "Purchasing" },
  [PERM.PURCHASING_PAY_BILL]: { description: "Pay vendor bills", category: "Purchasing" },
  [PERM.ACCOUNTING_VIEW_GL]: { description: "View the general ledger", category: "Accounting" },
  [PERM.ACCOUNTING_POST_JOURNAL]: { description: "Post manual journal entries", category: "Accounting" },
  [PERM.ACCOUNTING_EDIT_COA]: { description: "Edit the chart of accounts", category: "Accounting" },
  [PERM.ACCOUNTING_CLOSE_PERIOD]: { description: "Close an accounting period", category: "Accounting" },
  [PERM.REPORTS_VIEW_SALES]: { description: "Run sales reports", category: "Reports" },
  [PERM.REPORTS_VIEW_PROFIT]: { description: "Run reports containing profit", category: "Reports" },
  [PERM.REPORTS_VIEW_INVENTORY_VALUATION]: { description: "Run inventory valuation", category: "Reports" },
  [PERM.REPORTS_EXPORT]: { description: "Export report data", category: "Reports" },
  [PERM.AUDIT_VIEW]: { description: "View audit logs", category: "Audit" },
  [PERM.ADMIN_MANAGE_USERS]: { description: "Manage users, roles and override codes", category: "Admin" },
  [PERM.ADMIN_SETTINGS]: { description: "Change company settings", category: "Admin" },
};

export type RoleCodeName =
  | "ADMIN"
  | "ACCOUNTANT"
  | "MANAGER"
  | "PURCHASING"
  | "COUNTER_SALES"
  | "VIEWER";

const ALL = Object.values(PERM) as Permission[];

/**
 * Counter staff: everything needed to sell a part, and nothing that reveals
 * what the part cost us. Note the deliberate absences:
 *   - INVENTORY_VIEW_COST
 *   - INVENTORY_VIEW_MARGIN
 *   - REPORTS_VIEW_PROFIT
 *   - REPORTS_VIEW_INVENTORY_VALUATION  (valuation is cost x qty)
 *   - PRICING_SELL_BELOW_MIN            (requires a manager override)
 */
const COUNTER_SALES: Permission[] = [
  PERM.INVENTORY_VIEW,
  PERM.SALES_VIEW,
  PERM.SALES_CREATE_INVOICE,
  PERM.SALES_RECEIVE_PAYMENT,
  PERM.REPORTS_VIEW_SALES,
];

const MANAGER: Permission[] = [
  ...COUNTER_SALES,
  PERM.INVENTORY_EDIT,
  PERM.INVENTORY_VIEW_COST,
  PERM.INVENTORY_VIEW_MARGIN,
  PERM.INVENTORY_ADJUST,
  PERM.PRICING_SELL_BELOW_MIN,
  PERM.PRICING_APPROVE_OVERRIDE,
  PERM.PRICING_EDIT_PRICE_LEVELS,
  PERM.SALES_EDIT_INVOICE,
  PERM.SALES_VOID_INVOICE,
  PERM.PURCHASING_VIEW,
  PERM.PURCHASING_CREATE_PO,
  PERM.PURCHASING_RECEIVE,
  PERM.REPORTS_VIEW_PROFIT,
  PERM.REPORTS_VIEW_INVENTORY_VALUATION,
  PERM.REPORTS_EXPORT,
  PERM.AUDIT_VIEW,
];

const ACCOUNTANT: Permission[] = [
  PERM.INVENTORY_VIEW,
  PERM.INVENTORY_VIEW_COST,
  PERM.INVENTORY_VIEW_MARGIN,
  PERM.SALES_VIEW,
  PERM.SALES_RECEIVE_PAYMENT,
  PERM.PURCHASING_VIEW,
  PERM.PURCHASING_ENTER_BILL,
  PERM.PURCHASING_PAY_BILL,
  PERM.ACCOUNTING_VIEW_GL,
  PERM.ACCOUNTING_POST_JOURNAL,
  PERM.ACCOUNTING_EDIT_COA,
  PERM.ACCOUNTING_CLOSE_PERIOD,
  PERM.REPORTS_VIEW_SALES,
  PERM.REPORTS_VIEW_PROFIT,
  PERM.REPORTS_VIEW_INVENTORY_VALUATION,
  PERM.REPORTS_EXPORT,
  PERM.AUDIT_VIEW,
];

const PURCHASING_ROLE: Permission[] = [
  PERM.INVENTORY_VIEW,
  PERM.INVENTORY_EDIT,
  PERM.INVENTORY_VIEW_COST,
  PERM.INVENTORY_ADJUST,
  PERM.PURCHASING_VIEW,
  PERM.PURCHASING_CREATE_PO,
  PERM.PURCHASING_RECEIVE,
  PERM.PURCHASING_ENTER_BILL,
  PERM.REPORTS_VIEW_INVENTORY_VALUATION,
  PERM.SALES_VIEW,
];

const VIEWER: Permission[] = [PERM.INVENTORY_VIEW, PERM.SALES_VIEW];

export const ROLE_PERMISSIONS: Record<RoleCodeName, Permission[]> = {
  ADMIN: ALL,
  ACCOUNTANT,
  MANAGER,
  PURCHASING: PURCHASING_ROLE,
  COUNTER_SALES,
  VIEWER,
};

/** Hard ceiling on how far below minimum a role may authorize. */
export const ROLE_MAX_DISCOUNT: Record<RoleCodeName, number> = {
  ADMIN: 1,
  MANAGER: 0.25,
  ACCOUNTANT: 0,
  PURCHASING: 0,
  COUNTER_SALES: 0,
  VIEWER: 0,
};

export const ROLE_LABELS: Record<RoleCodeName, string> = {
  ADMIN: "Administrator",
  ACCOUNTANT: "Accountant",
  MANAGER: "Store Manager",
  PURCHASING: "Purchasing Agent",
  COUNTER_SALES: "Counter Sales",
  VIEWER: "Read Only",
};

export function roleHasPermission(role: RoleCodeName, perm: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(perm) ?? false;
}

/** Thrown by `requirePermission`; mapped to a 403 by API routes. */
export class PermissionError extends Error {
  readonly permission: Permission;
  readonly statusCode = 403;
  constructor(permission: Permission, message?: string) {
    super(message ?? `Permission denied: ${permission}`);
    this.name = "PermissionError";
    this.permission = permission;
  }
}
