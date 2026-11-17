import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, userCan } from "@/lib/auth";
import { PERM } from "@/lib/permissions";
import { toProductDTOList } from "@/lib/product-dto";
import { normalizePartNumber } from "@/lib/part-number";

/**
 * Item lookup for the counter (INV).
 *
 * The clerk types anything — our SKU, the OEM number off the old part, a
 * scanned barcode, or a few words of description — and the part has to come
 * up. Search order mirrors how a counter conversation actually goes:
 *
 *   1. exact barcode        (they scanned it)
 *   2. exact SKU            (they read it off the shelf tag)
 *   3. cross-reference      (they have the OEM/competitor number)
 *   4. SKU prefix           (they are part-way through typing)
 *   5. description words    (they only know what it is)
 *
 * SECURITY: the response passes through toProductDTOList, which strips cost
 * fields unless the caller holds inventory.view_cost. A counter terminal
 * calling this endpoint directly gets the same sanitized payload the UI does.
 */

const LIMIT = 50;

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  if (!userCan(user, PERM.INVENTORY_VIEW)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const params = request.nextUrl.searchParams;
  const q = (params.get("q") ?? "").trim();
  const includeInactive = params.get("includeInactive") === "1";
  const typeFilter = params.get("type");

  const baseWhere = {
    ...(includeInactive ? {} : { isActive: true }),
    ...(typeFilter ? { type: typeFilter as never } : {}),
  };

  // An empty query lists the catalog — this is the "browse" state of the
  // lookup window, which QuickBooks shows when you press the dropdown arrow.
  if (q.length === 0) {
    const products = await prisma.product.findMany({
      where: baseWhere,
      include: {
        category: { select: { name: true } },
        brand: { select: { name: true } },
      },
      orderBy: { sku: "asc" },
      take: LIMIT,
    });
    return NextResponse.json(
      { items: toProductDTOList(products, user), total: products.length },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const normalized = normalizePartNumber(q);
  const words = q.split(/\s+/).filter((w) => w.length >= 2);

  const products = await prisma.product.findMany({
    where: {
      ...baseWhere,
      OR: [
        { barcode: q },
        { sku: { equals: q, mode: "insensitive" } },
        { sku: { contains: q, mode: "insensitive" } },
        {
          crossReferences: {
            some: { normalized: { contains: normalized } },
          },
        },
        { description: { contains: q, mode: "insensitive" } },
        // Every word must appear somewhere in the description, so
        // "brake drum" does not return every brake part in the building.
        ...(words.length > 1
          ? [
              {
                AND: words.map((w) => ({
                  description: { contains: w, mode: "insensitive" as const },
                })),
              },
            ]
          : []),
      ],
    },
    include: {
      category: { select: { name: true } },
      brand: { select: { name: true } },
      crossReferences: {
        select: { type: true, number: true, manufacturer: true },
        take: 6,
      },
    },
    take: LIMIT,
  });

  // Rank in the order a counter clerk expects, since Postgres gave us no
  // relevance ordering across these very different predicates.
  const lowered = q.toLowerCase();
  const ranked = products
    .map((p) => {
      let score = 50;
      if (p.barcode && p.barcode === q) score = 0;
      else if (p.sku.toLowerCase() === lowered) score = 1;
      else if (
        p.crossReferences?.some(
          (x) => normalizePartNumber(x.number) === normalized,
        )
      )
        score = 2;
      else if (p.sku.toLowerCase().startsWith(lowered)) score = 3;
      else if (p.crossReferences?.length) score = 4;
      else if (p.description.toLowerCase().startsWith(lowered)) score = 5;
      return { product: p, score };
    })
    .sort((a, b) => a.score - b.score || a.product.sku.localeCompare(b.product.sku))
    .map((r) => r.product);

  return NextResponse.json(
    { items: toProductDTOList(ranked, user), total: ranked.length },
    { headers: { "Cache-Control": "no-store" } },
  );
}
