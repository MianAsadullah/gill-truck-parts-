import "server-only";

import type { Product, ItemType } from "@prisma/client";
import { PERM } from "@/lib/permissions";
import { userCan, type AuthUser } from "@/lib/auth";
import { num, marginPct } from "@/lib/money";

/**
 * The cost firewall.
 *
 * Prisma returns full Product rows. Those rows contain averageCost, lastCost
 * and standardCost. If such a row is handed to a client component, returned
 * from a server action, or serialized into RSC props, the cost travels to the
 * browser and is visible in the page payload — even if no component renders
 * it. React Server Components serialize props as plain JSON in the HTML
 * stream, so "we just don't display it" is NOT a control.
 *
 * Therefore: a Product may only reach the client through `toProductDTO`.
 * The cost keys are absent from `ProductDTO` entirely (not null, not 0 —
 * absent), and present only on `ProductCostDTO`, which the function returns
 * exclusively when the caller holds PERM.INVENTORY_VIEW_COST.
 *
 * Review rule for this repo: any `include`/`select` that reaches a client
 * boundary without passing through here is a bug.
 */

/** Safe for every role, counter staff included. */
export interface ProductDTO {
  id: string;
  sku: string;
  type: ItemType;
  description: string;
  longDescription: string | null;
  unitOfMeasure: string;
  barcode: string | null;
  binLocation: string | null;
  categoryName: string | null;
  brandName: string | null;

  /** Selling prices only. */
  standardPrice: number;
  minimumPrice: number;

  quantityOnHand: number;
  quantityAvailable: number;
  quantityOnOrder: number;
  reorderPoint: number;

  isTaxable: boolean;
  isActive: boolean;
  coreCharge: number;

  /** Cross-reference numbers, for display in the lookup window. */
  crossReferences?: { type: string; number: string; manufacturer: string | null }[];
}

/** Adds the restricted fields. Only ever produced for privileged roles. */
export interface ProductCostDTO extends ProductDTO {
  averageCost: number;
  lastCost: number;
  standardCost: number;
  /** standardPrice - averageCost */
  grossProfit: number;
  /** Fraction, e.g. 0.3421. Null when price is 0. */
  marginPct: number | null;
}

type ProductWithRelations = Product & {
  category?: { name: string } | null;
  brand?: { name: string } | null;
  crossReferences?: {
    type: string;
    number: string;
    manufacturer: string | null;
  }[];
};

function baseDTO(p: ProductWithRelations): ProductDTO {
  const onHand = num(p.quantityOnHand);
  const committed = num(p.quantityCommitted);
  return {
    id: p.id,
    sku: p.sku,
    type: p.type,
    description: p.description,
    longDescription: p.longDescription,
    unitOfMeasure: p.unitOfMeasure,
    barcode: p.barcode,
    binLocation: p.binLocation,
    categoryName: p.category?.name ?? null,
    brandName: p.brand?.name ?? null,
    standardPrice: num(p.standardPrice),
    minimumPrice: num(p.minimumPrice),
    quantityOnHand: onHand,
    quantityAvailable: onHand - committed,
    quantityOnOrder: num(p.quantityOnOrder),
    reorderPoint: num(p.reorderPoint),
    isTaxable: p.isTaxable,
    isActive: p.isActive,
    coreCharge: num(p.coreCharge),
    ...(p.crossReferences
      ? {
          crossReferences: p.crossReferences.map((x) => ({
            type: String(x.type),
            number: x.number,
            manufacturer: x.manufacturer,
          })),
        }
      : {}),
  };
}

/**
 * Convert a Product for transport to the client.
 *
 * @returns a ProductCostDTO when the user holds inventory.view_cost,
 *          otherwise a ProductDTO with no cost keys at all.
 */
export function toProductDTO(
  product: ProductWithRelations,
  user: AuthUser | null,
): ProductDTO | ProductCostDTO {
  const dto = baseDTO(product);
  if (!userCan(user, PERM.INVENTORY_VIEW_COST)) return dto;

  const avgCost = num(product.averageCost);
  const price = num(product.standardPrice);
  return {
    ...dto,
    averageCost: avgCost,
    lastCost: num(product.lastCost),
    standardCost: num(product.standardCost),
    grossProfit: price - avgCost,
    marginPct: marginPct(price, avgCost),
  };
}

export function toProductDTOList(
  products: ProductWithRelations[],
  user: AuthUser | null,
): (ProductDTO | ProductCostDTO)[] {
  return products.map((p) => toProductDTO(p, user));
}

/** Narrowing helper so components can branch without an `any`. */
export function hasCost(
  dto: ProductDTO | ProductCostDTO,
): dto is ProductCostDTO {
  return "averageCost" in dto;
}

/**
 * The `select` to use when a query's result will reach the client and the
 * caller is NOT privileged. Keeps cost columns out of the SQL entirely, so
 * they never enter the Node process — defence in depth behind toProductDTO.
 */
export const PRODUCT_SAFE_SELECT = {
  id: true,
  sku: true,
  type: true,
  description: true,
  longDescription: true,
  unitOfMeasure: true,
  barcode: true,
  binLocation: true,
  standardPrice: true,
  minimumPrice: true,
  quantityOnHand: true,
  quantityCommitted: true,
  quantityOnOrder: true,
  reorderPoint: true,
  isTaxable: true,
  isActive: true,
  coreCharge: true,
} as const;
