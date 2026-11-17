/**
 * Seed for Gill Truck Parts.
 *
 * Installs: roles + permission grants, four demo users spanning the
 * permission tiers, a heavy-duty-truck chart of accounts, terms, tax codes,
 * vendors, customers with vehicles, and a parts catalog with OEM
 * cross-references and deliberately varied margins.
 *
 * Run:  npm run db:push && npm run db:seed
 */

import "dotenv/config";
import { PrismaClient, type AccountType, type AccountSubType } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import {
  PERMISSION_CATALOG,
  ROLE_PERMISSIONS,
  ROLE_MAX_DISCOUNT,
  ROLE_LABELS,
  type RoleCodeName,
} from "../src/lib/permissions";
import { SEQUENCE_DEFAULTS } from "../src/lib/sequence-config";
import { normalizePartNumber } from "../src/lib/part-number";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

const DEMO_PASSWORD = "parts123";
const BCRYPT_ROUNDS = 10;

/* ───────────────────────────────────────────────── chart of accounts */

interface AccountSeed {
  number: string;
  name: string;
  type: AccountType;
  subType: AccountSubType;
  isSystem?: boolean;
}

const ACCOUNTS: AccountSeed[] = [
  { number: "1000", name: "Operating Checking", type: "ASSET", subType: "BANK", isSystem: true },
  { number: "1010", name: "Counter Cash Drawer", type: "ASSET", subType: "BANK" },
  { number: "1200", name: "Accounts Receivable", type: "ASSET", subType: "ACCOUNTS_RECEIVABLE", isSystem: true },
  { number: "1300", name: "Inventory Asset", type: "ASSET", subType: "INVENTORY", isSystem: true },
  { number: "1400", name: "Prepaid Expenses", type: "ASSET", subType: "OTHER_CURRENT_ASSET" },
  { number: "1500", name: "Shop Equipment", type: "ASSET", subType: "FIXED_ASSET" },
  { number: "1510", name: "Delivery Vehicles", type: "ASSET", subType: "FIXED_ASSET" },

  { number: "2000", name: "Accounts Payable", type: "LIABILITY", subType: "ACCOUNTS_PAYABLE", isSystem: true },
  { number: "2100", name: "Company Credit Card", type: "LIABILITY", subType: "CREDIT_CARD" },
  { number: "2200", name: "Sales Tax Payable", type: "LIABILITY", subType: "SALES_TAX_PAYABLE", isSystem: true },
  { number: "2300", name: "Accrued Payroll", type: "LIABILITY", subType: "OTHER_CURRENT_LIABILITY" },
  { number: "2700", name: "Equipment Note Payable", type: "LIABILITY", subType: "LONG_TERM_LIABILITY" },

  { number: "3000", name: "Owner's Capital", type: "EQUITY", subType: "EQUITY" },
  { number: "3900", name: "Retained Earnings", type: "EQUITY", subType: "RETAINED_EARNINGS" },

  { number: "4000", name: "Parts Sales", type: "INCOME", subType: "SALES_INCOME", isSystem: true },
  { number: "4100", name: "Service & Labor Income", type: "INCOME", subType: "SERVICE_INCOME", isSystem: true },
  { number: "4200", name: "Freight & Handling Income", type: "INCOME", subType: "SALES_INCOME", isSystem: true },
  { number: "4300", name: "Core Charge Income", type: "INCOME", subType: "SALES_INCOME" },
  { number: "4900", name: "Price Concessions & Discounts", type: "INCOME", subType: "SALES_INCOME", isSystem: true },

  { number: "5000", name: "Cost of Goods Sold - Parts", type: "COST_OF_GOODS_SOLD", subType: "COGS", isSystem: true },
  { number: "5100", name: "Freight In", type: "COST_OF_GOODS_SOLD", subType: "COGS" },
  { number: "5900", name: "Inventory Shrinkage", type: "COST_OF_GOODS_SOLD", subType: "COGS", isSystem: true },

  { number: "6000", name: "Wages & Salaries", type: "EXPENSE", subType: "OPERATING_EXPENSE" },
  { number: "6100", name: "Rent", type: "EXPENSE", subType: "OPERATING_EXPENSE" },
  { number: "6200", name: "Utilities", type: "EXPENSE", subType: "OPERATING_EXPENSE" },
  { number: "6300", name: "Shop Supplies", type: "EXPENSE", subType: "OPERATING_EXPENSE" },
  { number: "6400", name: "Insurance", type: "EXPENSE", subType: "OPERATING_EXPENSE" },
  { number: "6500", name: "Delivery & Fuel", type: "EXPENSE", subType: "OPERATING_EXPENSE" },
  { number: "6900", name: "Bank & Merchant Fees", type: "EXPENSE", subType: "OPERATING_EXPENSE" },
];

/* ─────────────────────────────────────────────────────── parts catalog */

interface ProductSeed {
  sku: string;
  description: string;
  category: string;
  brand: string;
  uom?: string;
  bin?: string;
  barcode?: string;
  /** [standardPrice, minimumPrice, averageCost] */
  price: [number, number, number];
  onHand: number;
  reorderPoint?: number;
  reorderQty?: number;
  core?: number;
  type?: "INVENTORY" | "SERVICE" | "NON_INVENTORY" | "OTHER_CHARGE";
  taxable?: boolean;
  xrefs?: [type: "OEM" | "ALTERNATE" | "INTERCHANGE" | "SUPERSEDED" | "VENDOR_PART", number: string, mfr?: string][];
}

const PRODUCTS: ProductSeed[] = [
  {
    sku: "BRK-4707",
    description: 'Brake Drum 16.5" x 7" - 10 Hole Outboard',
    category: "BRAKES",
    brand: "GUNITE",
    bin: "A-12",
    barcode: "0081234470700",
    price: [214.5, 178.0, 141.25],
    onHand: 18,
    reorderPoint: 6,
    reorderQty: 12,
    xrefs: [
      ["OEM", "3600A", "Gunite"],
      ["INTERCHANGE", "66864B", "Webb"],
      ["ALTERNATE", "HDB-4707"],
    ],
  },
  {
    sku: "BRK-SHOE-4515",
    description: "Brake Shoe Kit 4515 Q Plus - Remanufactured",
    category: "BRAKES",
    brand: "MERITOR",
    bin: "A-14",
    price: [168.0, 139.0, 103.4],
    onHand: 24,
    reorderPoint: 8,
    reorderQty: 16,
    core: 45,
    xrefs: [
      ["OEM", "XK-2124515Q", "Meritor"],
      ["INTERCHANGE", "SK4515Q", "Haldex"],
    ],
  },
  {
    sku: "BRK-SLACK-28",
    description: 'Automatic Slack Adjuster 1.5" 28 Spline - 5.5" Arm',
    category: "BRAKES",
    brand: "HALDEX",
    bin: "A-20",
    price: [189.95, 156.0, 118.6],
    onHand: 9,
    reorderPoint: 4,
    reorderQty: 8,
    xrefs: [
      ["OEM", "40010217", "Haldex"],
      ["INTERCHANGE", "S-9801", "Meritor"],
    ],
  },
  {
    sku: "AIR-DRYER-AD9",
    description: "Air Dryer AD-9 Remanufactured with Cartridge",
    category: "AIR",
    brand: "BENDIX",
    bin: "B-03",
    barcode: "0065000109900",
    price: [392.0, 318.0, 241.75],
    onHand: 6,
    reorderPoint: 2,
    reorderQty: 4,
    core: 110,
    xrefs: [
      ["OEM", "065225", "Bendix"],
      ["ALTERNATE", "AD9-RMFG"],
      ["INTERCHANGE", "109685X", "Bendix"],
    ],
  },
  {
    sku: "AIR-GOV-D2",
    description: "Air Governor D-2 Standard",
    category: "AIR",
    brand: "BENDIX",
    bin: "B-05",
    price: [86.4, 71.0, 52.3],
    onHand: 14,
    reorderPoint: 5,
    xrefs: [["OEM", "275491", "Bendix"]],
  },
  {
    sku: "AIR-BAG-9780",
    description: "Air Spring / Suspension Bag - Rolling Lobe 9780",
    category: "SUSPENSION",
    brand: "FIRESTONE",
    bin: "C-08",
    price: [128.75, 104.0, 76.9],
    onHand: 22,
    reorderPoint: 8,
    reorderQty: 12,
    xrefs: [
      ["OEM", "W01-358-9780", "Firestone"],
      ["INTERCHANGE", "1R12-183", "Goodyear"],
      ["INTERCHANGE", "AS-9780"],
    ],
  },
  {
    sku: "FLT-LF9080",
    description: "Lube Filter - Spin On, Extended Service",
    category: "FILTERS",
    brand: "FLEETGUARD",
    bin: "D-01",
    barcode: "0091205908000",
    price: [24.85, 19.5, 13.42],
    onHand: 96,
    reorderPoint: 36,
    reorderQty: 72,
    xrefs: [
      ["OEM", "LF9080", "Fleetguard"],
      ["INTERCHANGE", "P553000", "Donaldson"],
      ["INTERCHANGE", "B7577", "Baldwin"],
      ["INTERCHANGE", "57202", "Wix"],
    ],
  },
  {
    sku: "FLT-FS1000",
    description: "Fuel Water Separator FS1000",
    category: "FILTERS",
    brand: "FLEETGUARD",
    bin: "D-04",
    price: [38.9, 31.0, 21.15],
    onHand: 64,
    reorderPoint: 24,
    reorderQty: 48,
    xrefs: [
      ["OEM", "FS1000", "Fleetguard"],
      ["INTERCHANGE", "P551000", "Donaldson"],
    ],
  },
  {
    sku: "FLT-AF25247",
    description: "Air Filter Element - Radial Seal Outer",
    category: "FILTERS",
    brand: "FLEETGUARD",
    bin: "D-10",
    price: [62.4, 50.0, 34.8],
    onHand: 31,
    reorderPoint: 12,
    xrefs: [
      ["OEM", "AF25247", "Fleetguard"],
      ["INTERCHANGE", "P606086", "Donaldson"],
    ],
  },
  {
    sku: "TRB-HE351CW",
    description: "Turbocharger HE351CW Remanufactured - 6.7L Cummins",
    category: "ENGINE",
    brand: "HOLSET",
    bin: "E-01",
    price: [1285.0, 1090.0, 842.5],
    onHand: 3,
    reorderPoint: 1,
    reorderQty: 2,
    core: 350,
    xrefs: [
      ["OEM", "4043600", "Holset"],
      ["ALTERNATE", "2837188"],
      ["SUPERSEDED", "4034020"],
    ],
  },
  {
    sku: "INJ-DD15-RM",
    description: "Fuel Injector DD15 Remanufactured - Each",
    category: "ENGINE",
    brand: "DETROIT",
    bin: "E-06",
    price: [486.0, 412.0, 318.9],
    onHand: 8,
    reorderPoint: 4,
    reorderQty: 6,
    core: 125,
    xrefs: [
      ["OEM", "A4720700587", "Detroit Diesel"],
      ["ALTERNATE", "RA4720700587"],
    ],
  },
  {
    sku: "ELE-ALT-160A",
    description: "Alternator 160 Amp 12V Brushless - Remanufactured",
    category: "ELECTRICAL",
    brand: "DELCO",
    bin: "F-02",
    price: [324.5, 268.0, 196.4],
    onHand: 7,
    reorderPoint: 3,
    core: 75,
    xrefs: [
      ["OEM", "8600350", "Delco Remy"],
      ["INTERCHANGE", "19020900"],
      ["ALTERNATE", "DRA-160"],
    ],
  },
  {
    sku: "ELE-STR-39MT",
    description: "Starter 39MT 12V Remanufactured",
    category: "ELECTRICAL",
    brand: "DELCO",
    bin: "F-05",
    price: [412.0, 348.0, 262.8],
    onHand: 5,
    reorderPoint: 2,
    core: 150,
    xrefs: [
      ["OEM", "8200308", "Delco Remy"],
      ["INTERCHANGE", "19011511"],
    ],
  },
  {
    sku: "ELE-BAT-31-950",
    description: "Group 31 AGM Battery 950 CCA",
    category: "ELECTRICAL",
    brand: "INTERSTATE",
    bin: "F-10",
    barcode: "0074100319500",
    price: [268.0, 229.0, 174.5],
    onHand: 26,
    reorderPoint: 10,
    reorderQty: 16,
    core: 22,
    xrefs: [["OEM", "31P-AGM7", "Interstate"]],
  },
  {
    sku: "DRV-U-JOINT-1710",
    description: "Universal Joint 1710 Series - Full Round",
    category: "DRIVELINE",
    brand: "SPICER",
    bin: "G-04",
    price: [112.6, 92.0, 66.3],
    onHand: 17,
    reorderPoint: 6,
    xrefs: [
      ["OEM", "5-280X", "Spicer"],
      ["INTERCHANGE", "CP1710X"],
    ],
  },
  {
    sku: "CLG-WP-C15",
    description: "Water Pump C15 / 3406E - New",
    category: "COOLING",
    brand: "CATERPILLAR",
    bin: "H-02",
    price: [468.0, 396.0, 302.4],
    onHand: 4,
    reorderPoint: 2,
    xrefs: [
      ["OEM", "3522093", "Caterpillar"],
      ["ALTERNATE", "2W8001"],
    ],
  },
  {
    sku: "CLG-HOSE-SIL",
    description: 'Silicone Radiator Hose 3" ID - Per Foot',
    category: "COOLING",
    brand: "GATES",
    uom: "FT",
    bin: "H-08",
    price: [18.4, 14.5, 9.85],
    onHand: 120,
    reorderPoint: 40,
  },
  {
    sku: "LGT-LED-STT",
    description: "LED Stop/Turn/Tail Light 4in Round - Sealed",
    category: "LIGHTING",
    brand: "TRUCK-LITE",
    bin: "I-01",
    barcode: "0075100440000",
    price: [42.95, 34.0, 22.6],
    onHand: 58,
    reorderPoint: 20,
    reorderQty: 36,
    xrefs: [
      ["OEM", "44302R", "Truck-Lite"],
      ["INTERCHANGE", "M44302R"],
    ],
  },
  {
    sku: "TIR-11R22.5-H",
    description: "Tire 11R22.5 Load Range H - Drive Position",
    category: "TIRES",
    brand: "BRIDGESTONE",
    bin: "YARD",
    price: [612.0, 528.0, 428.75],
    onHand: 12,
    reorderPoint: 4,
    reorderQty: 8,
    xrefs: [["OEM", "M726-EL", "Bridgestone"]],
  },
  {
    sku: "FAS-UBOLT-58",
    description: 'U-Bolt 5/8" x 3-1/4" x 9" Round - Grade 8',
    category: "HARDWARE",
    brand: "GTP",
    bin: "J-14",
    price: [14.2, 10.5, 6.12],
    onHand: 86,
    reorderPoint: 30,
  },
  {
    sku: "FLD-DEF-25",
    description: "Diesel Exhaust Fluid - 2.5 Gallon Jug",
    category: "FLUIDS",
    brand: "BLUEDEF",
    bin: "K-01",
    barcode: "0074804000250",
    price: [21.5, 17.0, 11.8],
    onHand: 64,
    reorderPoint: 24,
    reorderQty: 48,
  },
  {
    sku: "FLD-OIL-15W40",
    description: "Engine Oil 15W-40 CK-4 - Per Gallon",
    category: "FLUIDS",
    brand: "SHELL",
    uom: "GAL",
    bin: "K-04",
    price: [23.8, 19.25, 13.6],
    onHand: 220,
    reorderPoint: 80,
    reorderQty: 165,
  },

  /* ── Non-stock and service items. These never touch inventory. ──────── */
  {
    sku: "LABOR-SHOP",
    description: "Shop Labor - Per Hour",
    category: "LABOR",
    brand: "GTP",
    uom: "HR",
    type: "SERVICE",
    taxable: false,
    price: [145.0, 110.0, 0],
    onHand: 0,
  },
  {
    sku: "LABOR-DIAG",
    description: "Diagnostic Labor - Per Hour",
    category: "LABOR",
    brand: "GTP",
    uom: "HR",
    type: "SERVICE",
    taxable: false,
    price: [165.0, 125.0, 0],
    onHand: 0,
  },
  {
    sku: "LABOR-MOBILE",
    description: "Mobile Service Call - Per Hour Plus Mileage",
    category: "LABOR",
    brand: "GTP",
    uom: "HR",
    type: "SERVICE",
    taxable: false,
    price: [185.0, 150.0, 0],
    onHand: 0,
  },
  {
    sku: "FEE-SHOP-SUP",
    description: "Shop Supplies & Environmental Fee",
    category: "FEES",
    brand: "GTP",
    type: "OTHER_CHARGE",
    price: [18.5, 0, 0],
    onHand: 0,
  },
  {
    sku: "FEE-FREIGHT",
    description: "Freight / Delivery Charge",
    category: "FEES",
    brand: "GTP",
    type: "OTHER_CHARGE",
    taxable: false,
    price: [0, 0, 0],
    onHand: 0,
  },
  {
    sku: "FEE-HAZMAT",
    description: "Hazardous Material Disposal Fee",
    category: "FEES",
    brand: "GTP",
    type: "OTHER_CHARGE",
    price: [12.0, 0, 0],
    onHand: 0,
  },
];

const CATEGORIES: [code: string, name: string][] = [
  ["BRAKES", "Brakes & Friction"],
  ["AIR", "Air System"],
  ["SUSPENSION", "Suspension & Steering"],
  ["FILTERS", "Filtration"],
  ["ENGINE", "Engine & Fuel"],
  ["ELECTRICAL", "Electrical & Starting"],
  ["DRIVELINE", "Driveline & Axle"],
  ["COOLING", "Cooling System"],
  ["LIGHTING", "Lighting & Harness"],
  ["TIRES", "Tires & Wheels"],
  ["HARDWARE", "Hardware & Fasteners"],
  ["FLUIDS", "Fluids & Chemicals"],
  ["LABOR", "Shop Labor"],
  ["FEES", "Fees & Charges"],
];

const BRANDS: [code: string, name: string][] = [
  ["GUNITE", "Gunite"],
  ["MERITOR", "Meritor"],
  ["HALDEX", "Haldex"],
  ["BENDIX", "Bendix"],
  ["FIRESTONE", "Firestone Airide"],
  ["FLEETGUARD", "Fleetguard"],
  ["HOLSET", "Holset"],
  ["DETROIT", "Detroit Diesel"],
  ["DELCO", "Delco Remy"],
  ["INTERSTATE", "Interstate Batteries"],
  ["SPICER", "Dana Spicer"],
  ["CATERPILLAR", "Caterpillar"],
  ["GATES", "Gates"],
  ["TRUCK-LITE", "Truck-Lite"],
  ["BRIDGESTONE", "Bridgestone"],
  ["SHELL", "Shell Rotella"],
  ["BLUEDEF", "BlueDEF"],
  ["GTP", "Gill Truck Parts"],
];

async function main() {
  console.log("Seeding Gill Truck Parts...");

  /* ─────────────────────────────────── permissions, roles, grants ───── */

  for (const [key, meta] of Object.entries(PERMISSION_CATALOG)) {
    await prisma.permission.upsert({
      where: { key },
      update: { description: meta.description, category: meta.category },
      create: { key, description: meta.description, category: meta.category },
    });
  }
  console.log("  permissions: " + Object.keys(PERMISSION_CATALOG).length);

  const roleIds = new Map<RoleCodeName, string>();
  for (const code of Object.keys(ROLE_PERMISSIONS) as RoleCodeName[]) {
    const role = await prisma.role.upsert({
      where: { code },
      update: {
        name: ROLE_LABELS[code],
        maxDiscountPct: ROLE_MAX_DISCOUNT[code],
      },
      create: {
        code,
        name: ROLE_LABELS[code],
        description: ROLE_LABELS[code] + " role",
        maxDiscountPct: ROLE_MAX_DISCOUNT[code],
      },
    });
    roleIds.set(code, role.id);

    // Re-sync grants from the code-level matrix so the DB and
    // src/lib/permissions.ts never drift.
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    const perms = await prisma.permission.findMany({
      where: { key: { in: ROLE_PERMISSIONS[code] as string[] } },
      select: { id: true },
    });
    await prisma.rolePermission.createMany({
      data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })),
      skipDuplicates: true,
    });
    console.log("  role " + code + ": " + perms.length + " permissions");
  }

  /* ──────────────────────────────────────────────────────── users ───── */

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, BCRYPT_ROUNDS);

  const USERS: {
    employeeCode: string;
    email: string;
    fullName: string;
    role: RoleCodeName;
    overrideCode?: string;
  }[] = [
    {
      employeeCode: "ADMIN",
      email: "admin",
      fullName: "System Administrator",
      role: "ADMIN",
      overrideCode: "9999",
    },
    {
      employeeCode: "MG",
      email: "mgr",
      fullName: "Manpreet Gill",
      role: "MANAGER",
      // The code a manager types at a counter terminal to clear a
      // below-minimum price. Stored bcrypt-hashed.
      overrideCode: "4821",
    },
    {
      employeeCode: "RK",
      email: "counter",
      fullName: "Ravi Kumar",
      role: "COUNTER_SALES",
    },
    {
      employeeCode: "SB",
      email: "acct",
      fullName: "Sandra Boyle",
      role: "ACCOUNTANT",
    },
    {
      employeeCode: "JP",
      email: "purch",
      fullName: "Jaspreet Pannu",
      role: "PURCHASING",
    },
  ];

  for (const u of USERS) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: {
        fullName: u.fullName,
        roleId: roleIds.get(u.role)!,
        employeeCode: u.employeeCode,
        ...(u.overrideCode
          ? { overrideCodeHash: await bcrypt.hash(u.overrideCode, BCRYPT_ROUNDS) }
          : {}),
      },
      create: {
        employeeCode: u.employeeCode,
        email: u.email,
        fullName: u.fullName,
        passwordHash,
        roleId: roleIds.get(u.role)!,
        overrideCodeHash: u.overrideCode
          ? await bcrypt.hash(u.overrideCode, BCRYPT_ROUNDS)
          : null,
      },
    });
  }
  console.log("  users: " + USERS.length + " (password: " + DEMO_PASSWORD + ")");

  /* ──────────────────────────────────────── chart of accounts ───── */

  for (const a of ACCOUNTS) {
    await prisma.account.upsert({
      where: { number: a.number },
      update: { name: a.name, type: a.type, subType: a.subType, isSystem: !!a.isSystem },
      create: {
        number: a.number,
        name: a.name,
        type: a.type,
        subType: a.subType,
        isSystem: !!a.isSystem,
      },
    });
  }
  console.log("  accounts: " + ACCOUNTS.length);

  /* ───────────────────────────────────────── terms & tax codes ───── */

  const TERMS: { name: string; netDays: number; discountDays?: number; discountPct?: number }[] = [
    { name: "Due on receipt", netDays: 0 },
    { name: "Net 15", netDays: 15 },
    { name: "Net 30", netDays: 30 },
    { name: "2% 10 Net 30", netDays: 30, discountDays: 10, discountPct: 0.02 },
    { name: "Net 45", netDays: 45 },
    { name: "COD", netDays: 0 },
  ];
  const termsIds = new Map<string, string>();
  for (const t of TERMS) {
    const row = await prisma.terms.upsert({
      where: { name: t.name },
      update: {},
      create: {
        name: t.name,
        netDays: t.netDays,
        discountDays: t.discountDays ?? 0,
        discountPct: t.discountPct ?? 0,
      },
    });
    termsIds.set(t.name, row.id);
  }

  const TAX_CODES: { code: string; name: string; rate: number; agency: string }[] = [
    { code: "CA-FRESNO", name: "Fresno County, CA", rate: 0.0825, agency: "CDTFA" },
    { code: "CA-KERN", name: "Kern County, CA", rate: 0.0725, agency: "CDTFA" },
    { code: "NON", name: "Non-Taxable / Resale", rate: 0, agency: "CDTFA" },
  ];
  const taxIds = new Map<string, string>();
  for (const t of TAX_CODES) {
    const row = await prisma.taxCode.upsert({
      where: { code: t.code },
      update: { rate: t.rate, name: t.name },
      create: t,
    });
    taxIds.set(t.code, row.id);
  }
  console.log("  terms: " + TERMS.length + ", tax codes: " + TAX_CODES.length);

  /* ──────────────────────────────────── categories & brands ───── */

  const categoryIds = new Map<string, string>();
  for (const [code, name] of CATEGORIES) {
    const row = await prisma.category.upsert({
      where: { code },
      update: { name },
      create: { code, name },
    });
    categoryIds.set(code, row.id);
  }

  const brandIds = new Map<string, string>();
  for (const [code, name] of BRANDS) {
    const row = await prisma.brand.upsert({
      where: { code },
      update: { name },
      create: { code, name },
    });
    brandIds.set(code, row.id);
  }

  /* ──────────────────────────────────────────────────── vendors ───── */

  const VENDORS: {
    vendorNo: string;
    companyName: string;
    contactName: string;
    phone: string;
    city: string;
    state: string;
    terms: string;
  }[] = [
    { vendorNo: "V0101", companyName: "FleetPride Distribution", contactName: "Dale Whitmore", phone: "(559) 442-7100", city: "Fresno", state: "CA", terms: "Net 30" },
    { vendorNo: "V0102", companyName: "Bendix Commercial Vehicle Systems", contactName: "Angela Reyes", phone: "(800) 247-2725", city: "Elyria", state: "OH", terms: "2% 10 Net 30" },
    { vendorNo: "V0103", companyName: "Cummins Pacific LLC", contactName: "Marcus Hale", phone: "(559) 275-7400", city: "Fresno", state: "CA", terms: "Net 30" },
    { vendorNo: "V0104", companyName: "Meritor Aftermarket", contactName: "Priya Nair", phone: "(866) 668-7221", city: "Florence", state: "KY", terms: "Net 45" },
    { vendorNo: "V0105", companyName: "Interstate Batteries West", contactName: "Tom Ferreira", phone: "(559) 251-9900", city: "Fresno", state: "CA", terms: "Net 15" },
    { vendorNo: "V0106", companyName: "Valley Tire Wholesale", contactName: "Hector Diaz", phone: "(661) 327-4455", city: "Bakersfield", state: "CA", terms: "Net 30" },
  ];
  const vendorIds = new Map<string, string>();
  for (const v of VENDORS) {
    const row = await prisma.vendor.upsert({
      where: { vendorNo: v.vendorNo },
      update: {},
      create: {
        vendorNo: v.vendorNo,
        companyName: v.companyName,
        contactName: v.contactName,
        phone: v.phone,
        city: v.city,
        state: v.state,
        termsId: termsIds.get(v.terms) ?? null,
      },
    });
    vendorIds.set(v.companyName, row.id);
  }
  console.log("  vendors: " + VENDORS.length);

  /* ─────────────────────────────────────── customers & vehicles ───── */

  const CUSTOMERS: {
    customerNo: string;
    companyName: string;
    contactName: string;
    phone: string;
    address: string;
    city: string;
    state: string;
    zip: string;
    terms: string;
    priceLevel: "RETAIL" | "FLEET" | "WHOLESALE" | "DEALER";
    discountPct?: number;
    creditLimit: number;
    taxExempt?: boolean;
    taxCode: string;
    vehicles: {
      plate: string;
      unit?: string;
      year?: number;
      make?: string;
      model?: string;
      vin?: string;
      odometer?: number;
    }[];
  }[] = [
    {
      customerNo: "C1001",
      companyName: "Valley Freight Lines, Inc.",
      contactName: "Dan Oliveira",
      phone: "(559) 233-8800",
      address: "4120 S Golden State Blvd",
      city: "Fresno",
      state: "CA",
      zip: "93725",
      terms: "Net 30",
      priceLevel: "FLEET",
      discountPct: 0.1,
      creditLimit: 50000,
      taxCode: "CA-FRESNO",
      vehicles: [
        { plate: "7ABC123", unit: "104", year: 2019, make: "Freightliner", model: "Cascadia", vin: "3AKJHHDR9KSKL1234", odometer: 612450 },
        { plate: "8XYZ991", unit: "107", year: 2021, make: "Kenworth", model: "T680", vin: "1XKYDP9X1MJ412345", odometer: 288300 },
        { plate: "9JKL442", unit: "112", year: 2017, make: "Peterbilt", model: "579", odometer: 884100 },
      ],
    },
    {
      customerNo: "C1002",
      companyName: "Sierra Ag Transport",
      contactName: "Luis Mendoza",
      phone: "(559) 875-2211",
      address: "891 Ave 400",
      city: "Kingsburg",
      state: "CA",
      zip: "93631",
      terms: "Net 15",
      priceLevel: "FLEET",
      discountPct: 0.07,
      creditLimit: 25000,
      taxCode: "CA-FRESNO",
      vehicles: [
        { plate: "4GHT887", unit: "22", year: 2015, make: "International", model: "ProStar", odometer: 1024000 },
        { plate: "5RTY310", unit: "26", year: 2020, make: "Volvo", model: "VNL760" },
      ],
    },
    {
      customerNo: "C1003",
      companyName: "Bakersfield Heavy Repair",
      contactName: "Chuck Tanner",
      phone: "(661) 834-5500",
      address: "2200 Pacheco Rd",
      city: "Bakersfield",
      state: "CA",
      zip: "93307",
      terms: "2% 10 Net 30",
      priceLevel: "WHOLESALE",
      discountPct: 0.15,
      creditLimit: 40000,
      taxExempt: true,
      taxCode: "NON",
      vehicles: [{ plate: "SHOP-01", unit: "SVC1", year: 2018, make: "Ram", model: "5500" }],
    },
    {
      customerNo: "C1004",
      companyName: "Gill Brothers Hauling",
      contactName: "Sukhdev Gill",
      phone: "(559) 490-1177",
      address: "17455 E Manning Ave",
      city: "Selma",
      state: "CA",
      zip: "93662",
      terms: "Net 30",
      priceLevel: "FLEET",
      discountPct: 0.12,
      creditLimit: 75000,
      taxCode: "CA-FRESNO",
      vehicles: [
        { plate: "1GBH500", unit: "A1", year: 2022, make: "Freightliner", model: "Cascadia 126" },
        { plate: "1GBH501", unit: "A2", year: 2022, make: "Freightliner", model: "Cascadia 126" },
        { plate: "1GBH502", unit: "A3", year: 2023, make: "Western Star", model: "49X" },
      ],
    },
    {
      customerNo: "C1005",
      companyName: "Cash Sale - Walk In",
      contactName: "",
      phone: "",
      address: "",
      city: "Fresno",
      state: "CA",
      zip: "93725",
      terms: "Due on receipt",
      priceLevel: "RETAIL",
      creditLimit: 0,
      taxCode: "CA-FRESNO",
      vehicles: [],
    },
    {
      customerNo: "C1006",
      companyName: "Pacific Produce Carriers",
      contactName: "Nina Alvarado",
      phone: "(661) 721-3030",
      address: "750 Zerker Rd",
      city: "Shafter",
      state: "CA",
      zip: "93263",
      terms: "Net 45",
      priceLevel: "DEALER",
      discountPct: 0.2,
      creditLimit: 120000,
      taxCode: "CA-KERN",
      vehicles: [
        { plate: "2PPC770", unit: "R-12", year: 2021, make: "Kenworth", model: "T880" },
        { plate: "2PPC771", unit: "R-14", year: 2019, make: "Mack", model: "Anthem" },
      ],
    },
  ];

  for (const c of CUSTOMERS) {
    const customer = await prisma.customer.upsert({
      where: { customerNo: c.customerNo },
      update: {},
      create: {
        customerNo: c.customerNo,
        companyName: c.companyName,
        contactName: c.contactName || null,
        phone: c.phone || null,
        billingAddress1: c.address || null,
        city: c.city,
        state: c.state,
        postalCode: c.zip,
        termsId: termsIds.get(c.terms) ?? null,
        priceLevel: c.priceLevel,
        discountPct: c.discountPct ?? 0,
        creditLimit: c.creditLimit,
        taxExempt: !!c.taxExempt,
        resaleCertNo: c.taxExempt ? "SR-KH-" + c.customerNo : null,
        taxCodeId: taxIds.get(c.taxCode) ?? null,
      },
    });

    for (const v of c.vehicles) {
      const existing = await prisma.customerVehicle.findFirst({
        where: { customerId: customer.id, licensePlate: v.plate },
      });
      if (!existing) {
        await prisma.customerVehicle.create({
          data: {
            customerId: customer.id,
            licensePlate: v.plate,
            unitNumber: v.unit ?? null,
            year: v.year ?? null,
            make: v.make ?? null,
            model: v.model ?? null,
            vin: v.vin ?? null,
            odometer: v.odometer ?? null,
          },
        });
      }
    }
  }
  console.log(
    "  customers: " +
      CUSTOMERS.length +
      ", vehicles: " +
      CUSTOMERS.reduce((n, c) => n + c.vehicles.length, 0),
  );

  /* ──────────────────────────────────────────────────── products ───── */

  const incomeParts = await prisma.account.findUnique({ where: { number: "4000" } });
  const incomeService = await prisma.account.findUnique({ where: { number: "4100" } });
  const cogsAccount = await prisma.account.findUnique({ where: { number: "5000" } });
  const inventoryAccount = await prisma.account.findUnique({ where: { number: "1300" } });

  for (const p of PRODUCTS) {
    const [standardPrice, minimumPrice, averageCost] = p.price;
    const type = p.type ?? "INVENTORY";
    const isService = type === "SERVICE" || type === "OTHER_CHARGE";

    const product = await prisma.product.upsert({
      where: { sku: p.sku },
      update: {
        description: p.description,
        standardPrice,
        minimumPrice,
        averageCost,
        lastCost: averageCost,
        standardCost: averageCost,
      },
      create: {
        sku: p.sku,
        type,
        description: p.description,
        categoryId: categoryIds.get(p.category) ?? null,
        brandId: brandIds.get(p.brand) ?? null,
        unitOfMeasure: p.uom ?? "EA",
        barcode: p.barcode ?? null,
        binLocation: p.bin ?? null,
        standardPrice,
        minimumPrice,
        averageCost,
        lastCost: averageCost,
        standardCost: averageCost,
        quantityOnHand: type === "INVENTORY" ? p.onHand : 0,
        reorderPoint: p.reorderPoint ?? 0,
        reorderQuantity: p.reorderQty ?? 0,
        coreCharge: p.core ?? 0,
        isTaxable: p.taxable ?? true,
        incomeAccountId: (isService ? incomeService?.id : incomeParts?.id) ?? null,
        cogsAccountId: type === "INVENTORY" ? (cogsAccount?.id ?? null) : null,
        inventoryAccountId: type === "INVENTORY" ? (inventoryAccount?.id ?? null) : null,
      },
    });

    // Cross-references: our SKU is itself searchable as an ALTERNATE so a
    // normalized match on "brk4707" finds it.
    const xrefs: ProductSeed["xrefs"] = [
      ...(p.xrefs ?? []),
      ["ALTERNATE", p.sku, "Gill Truck Parts"],
    ];

    for (const [type_, number, mfr] of xrefs) {
      await prisma.productCrossReference.upsert({
        where: {
          productId_type_number: { productId: product.id, type: type_, number },
        },
        update: { normalized: normalizePartNumber(number) },
        create: {
          productId: product.id,
          type: type_,
          number,
          normalized: normalizePartNumber(number),
          manufacturer: mfr ?? null,
        },
      });
    }

    // Opening inventory movement, so the stock ledger reconciles to
    // quantityOnHand from day one.
    if (type === "INVENTORY" && p.onHand > 0) {
      const existing = await prisma.inventoryMovement.findFirst({
        where: { productId: product.id, referenceType: "OPENING" },
      });
      if (!existing) {
        await prisma.inventoryMovement.create({
          data: {
            productId: product.id,
            type: "COUNT",
            quantity: p.onHand,
            unitCost: averageCost,
            balanceAfter: p.onHand,
            referenceType: "OPENING",
            memo: "Opening balance from physical count",
          },
        });
      }
    }
  }
  console.log("  products: " + PRODUCTS.length);

  /* ───────────────────────── opening inventory on the balance sheet ───
   *
   * Posted as a REAL journal entry (DR Inventory Asset / CR Owner's
   * Capital), not by writing Account.balance directly.
   *
   * Writing the balance column straight was the original approach and it
   * was wrong: the trial balance sums journal lines on purpose — a trial
   * balance built from the same cached figure it is meant to validate
   * proves nothing — so a balance with no postings behind it showed up as
   * drift, and the inventory valuation report disagreed with the ledger.
   * Both reports were right; the seed was lying.
   */

  const inventoryValue =
    Math.round(
      PRODUCTS.filter((p) => (p.type ?? "INVENTORY") === "INVENTORY").reduce(
        (sum, p) => sum + p.onHand * p.price[2],
        0,
      ) * 100,
    ) / 100;

  const openingExists = await prisma.journalEntry.findUnique({
    where: { entryNo: "JE-OPENING" },
  });

  if (!openingExists && inventoryValue > 0) {
    const inventoryAccount = await prisma.account.findUniqueOrThrow({
      where: { number: "1300" },
    });
    const equityAccount = await prisma.account.findUniqueOrThrow({
      where: { number: "3000" },
    });
    const adminUser = await prisma.user.findUniqueOrThrow({ where: { email: "admin" } });

    await prisma.journalEntry.create({
      data: {
        entryNo: "JE-OPENING",
        entryDate: new Date(),
        source: "MANUAL",
        memo: "Opening inventory balance from physical count",
        referenceType: "OPENING",
        totalDebit: inventoryValue,
        totalCredit: inventoryValue,
        createdById: adminUser.id,
        lines: {
          create: [
            {
              lineNo: 1,
              accountId: inventoryAccount.id,
              debit: inventoryValue,
              credit: 0,
              memo: "Opening inventory",
            },
            {
              lineNo: 2,
              accountId: equityAccount.id,
              debit: 0,
              credit: inventoryValue,
              memo: "Opening owner's capital",
            },
          ],
        },
      },
    });

    // Move the cached balances the same way postJournalEntry would.
    await prisma.account.update({
      where: { id: inventoryAccount.id },
      data: { balance: { increment: inventoryValue } },
    });
    await prisma.account.update({
      where: { id: equityAccount.id },
      data: { balance: { increment: inventoryValue } },
    });

    console.log("  opening entry JE-OPENING: " + inventoryValue.toFixed(2));
  }

  /* ────────────────────── preferred vendors on a few fast movers ────── */

  const vendorLinks: [sku: string, vendor: string][] = [
    ["BRK-4707", "FleetPride Distribution"],
    ["BRK-SHOE-4515", "Meritor Aftermarket"],
    ["AIR-DRYER-AD9", "Bendix Commercial Vehicle Systems"],
    ["AIR-GOV-D2", "Bendix Commercial Vehicle Systems"],
    ["TRB-HE351CW", "Cummins Pacific LLC"],
    ["FLT-LF9080", "Cummins Pacific LLC"],
    ["ELE-BAT-31-950", "Interstate Batteries West"],
    ["TIR-11R22.5-H", "Valley Tire Wholesale"],
  ];
  for (const [sku, vendorName] of vendorLinks) {
    const vendorId = vendorIds.get(vendorName);
    if (!vendorId) continue;
    await prisma.product
      .update({ where: { sku }, data: { preferredVendorId: vendorId } })
      .catch(() => undefined);
  }

  /* ─────────────────────── negotiated customer-specific pricing ────── */

  const fleet = await prisma.customer.findUnique({ where: { customerNo: "C1001" } });
  const drum = await prisma.product.findUnique({ where: { sku: "BRK-4707" } });
  if (fleet && drum) {
    await prisma.customerPrice.upsert({
      where: { customerId_productId: { customerId: fleet.id, productId: drum.id } },
      update: { price: 192.0 },
      create: { customerId: fleet.id, productId: drum.id, price: 192.0 },
    });
  }

  /* ──────────────────────────────── sequences & company settings ───── */

  for (const [key, def] of Object.entries(SEQUENCE_DEFAULTS)) {
    await prisma.documentSequence.upsert({
      where: { key },
      update: {},
      create: {
        key,
        prefix: def.prefix,
        padding: def.padding,
        nextValue: def.start,
      },
    });
  }

  await prisma.companySettings.upsert({
    where: { id: "default" },
    update: { defaultTaxCodeId: taxIds.get("CA-FRESNO") ?? null },
    create: {
      id: "default",
      legalName: "Gill Truck Parts",
      address1: "3815 S Elm Ave",
      city: "Fresno",
      state: "CA",
      postalCode: "93706",
      phone: "(559) 268-4455",
      email: "counter@gilltruckparts.com",
      taxId: "77-0194552",
      fiscalYearStartMonth: 1,
      allowPriceOverride: true,
      defaultTaxCodeId: taxIds.get("CA-FRESNO") ?? null,
    },
  });

  console.log("\nSeed complete.");
  console.log("Sign in at /login with any of:");
  console.log("  admin   / " + DEMO_PASSWORD + "  (full access, override code 9999)");
  console.log("  mgr     / " + DEMO_PASSWORD + "  (sees cost, override code 4821)");
  console.log("  counter / " + DEMO_PASSWORD + "  (NO cost, needs approval below min)");
  console.log("  acct    / " + DEMO_PASSWORD + "  (accounting + GL)");
  console.log("  purch   / " + DEMO_PASSWORD + "  (purchasing + receiving)");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
