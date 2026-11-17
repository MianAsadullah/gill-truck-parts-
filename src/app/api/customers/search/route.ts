import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, userCan } from "@/lib/auth";
import { PERM } from "@/lib/permissions";
import { num } from "@/lib/money";

/**
 * Customer lookup for the invoice header.
 *
 * Also searches vehicles, because at a truck-parts counter the customer is
 * frequently identified by the plate on the truck in the bay rather than by
 * company name.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!userCan(user, PERM.SALES_VIEW)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const q = (request.nextUrl.searchParams.get("q") ?? "").trim();

  const customers = await prisma.customer.findMany({
    where: {
      isActive: true,
      ...(q
        ? {
            OR: [
              { companyName: { contains: q, mode: "insensitive" } },
              { customerNo: { contains: q, mode: "insensitive" } },
              { contactName: { contains: q, mode: "insensitive" } },
              { phone: { contains: q } },
              {
                vehicles: {
                  some: {
                    OR: [
                      { licensePlate: { contains: q, mode: "insensitive" } },
                      { unitNumber: { contains: q, mode: "insensitive" } },
                      { vin: { contains: q, mode: "insensitive" } },
                    ],
                  },
                },
              },
            ],
          }
        : {}),
    },
    include: {
      terms: { select: { id: true, name: true, netDays: true } },
      taxCode: { select: { id: true, code: true, name: true, rate: true } },
      vehicles: {
        select: {
          id: true,
          licensePlate: true,
          unitNumber: true,
          year: true,
          make: true,
          model: true,
        },
        orderBy: { licensePlate: "asc" },
      },
    },
    orderBy: { companyName: "asc" },
    take: 50,
  });

  return NextResponse.json(
    {
      customers: customers.map((c) => ({
        id: c.id,
        customerNo: c.customerNo,
        companyName: c.companyName,
        contactName: c.contactName,
        phone: c.phone,
        billingAddress1: c.billingAddress1,
        city: c.city,
        state: c.state,
        postalCode: c.postalCode,
        priceLevel: c.priceLevel,
        discountPct: num(c.discountPct),
        creditLimit: num(c.creditLimit),
        balance: num(c.balance),
        taxExempt: c.taxExempt,
        terms: c.terms,
        taxCode: c.taxCode ? { ...c.taxCode, rate: num(c.taxCode.rate) } : null,
        vehicles: c.vehicles,
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
