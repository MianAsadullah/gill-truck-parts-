/**
 * Client-safe transport shapes.
 *
 * These mirror the DTOs produced on the server but live in their own module
 * because `src/lib/product-dto.ts` is marked `server-only` — importing it
 * from a client component, even for types, risks pulling the guard into the
 * browser bundle.
 *
 * Note that cost fields are OPTIONAL here. That is the whole point: a
 * counter terminal receives objects where `averageCost` is simply absent, so
 * `item.averageCost` is `undefined` and any attempt to render it produces
 * nothing rather than a number. TypeScript forces callers to acknowledge the
 * possibility.
 */

export type ItemTypeName =
  | "INVENTORY"
  | "NON_INVENTORY"
  | "SERVICE"
  | "OTHER_CHARGE";

export const ITEM_TYPE_LABELS: Record<ItemTypeName, string> = {
  INVENTORY: "Inventory Part",
  NON_INVENTORY: "Non-Inventory",
  SERVICE: "Service / Labor",
  OTHER_CHARGE: "Other Charge",
};

export interface CrossReferenceDTO {
  type: string;
  number: string;
  manufacturer: string | null;
}

export interface ProductSearchItem {
  id: string;
  sku: string;
  type: ItemTypeName;
  description: string;
  longDescription: string | null;
  unitOfMeasure: string;
  barcode: string | null;
  binLocation: string | null;
  categoryName: string | null;
  brandName: string | null;

  standardPrice: number;
  minimumPrice: number;

  quantityOnHand: number;
  quantityAvailable: number;
  quantityOnOrder: number;
  reorderPoint: number;

  isTaxable: boolean;
  isActive: boolean;
  coreCharge: number;

  crossReferences?: CrossReferenceDTO[];

  /** Present only for roles holding inventory.view_cost. */
  averageCost?: number;
  lastCost?: number;
  standardCost?: number;
  grossProfit?: number;
  marginPct?: number | null;
}

export interface VehicleDTO {
  id: string;
  licensePlate: string;
  unitNumber: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
}

export interface CustomerSearchItem {
  id: string;
  customerNo: string;
  companyName: string;
  contactName: string | null;
  phone: string | null;
  billingAddress1: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  priceLevel: "RETAIL" | "FLEET" | "WHOLESALE" | "DEALER";
  discountPct: number;
  creditLimit: number;
  balance: number;
  taxExempt: boolean;
  terms: { id: string; name: string; netDays: number } | null;
  taxCode: { id: string; code: string; name: string; rate: number } | null;
  vehicles: VehicleDTO[];
}

/** Option lists handed to the invoice form by its server component. */
export interface TermsOption {
  id: string;
  name: string;
  netDays: number;
}
export interface TaxCodeOption {
  id: string;
  code: string;
  name: string;
  rate: number;
}
export interface RepOption {
  id: string;
  employeeCode: string;
  fullName: string;
}
