"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";

/**
 * The classic QuickBooks menu bar: File / Edit / View / Lists / Customers /
 * Vendors / Reports / Window / Help.
 *
 * Desktop-menu behaviours that matter for speed:
 *   - click a top-level item to open it
 *   - once a menu is open, hovering a sibling switches to it without clicking
 *   - Esc closes; clicking anywhere else closes
 *   - items show their keyboard shortcut right-aligned
 */

export interface MenuItem {
  label: string;
  href?: string;
  shortcut?: string;
  disabled?: boolean;
  separator?: false;
}
interface Separator {
  separator: true;
}
export type MenuEntry = MenuItem | Separator;

export interface Menu {
  label: string;
  items: MenuEntry[];
}

export const APP_MENUS: Menu[] = [
  {
    label: "File",
    items: [
      { label: "New Invoice", href: "/dashboard/invoices/new", shortcut: "Ctrl+I" },
      { label: "New Purchase Order", href: "/dashboard/purchase-orders/new" },
      { separator: true },
      { label: "Print Forms...", href: "/dashboard/invoices", shortcut: "Ctrl+P" },
      { separator: true },
      { label: "Sign Out", href: "/logout" },
    ],
  },
  {
    label: "Edit",
    items: [
      { label: "Find Transactions...", href: "/dashboard/invoices", shortcut: "Ctrl+F" },
      { label: "Preferences...", href: "/dashboard/settings" },
    ],
  },
  {
    label: "View",
    items: [
      { label: "Home Page", href: "/dashboard" },
      { label: "Open Windows List", disabled: true },
    ],
  },
  {
    label: "Lists",
    items: [
      { label: "Item List", href: "/dashboard/items", shortcut: "Ctrl+L" },
      { label: "Chart of Accounts", href: "/dashboard/accounting/accounts", shortcut: "Ctrl+A" },
      { label: "Customer Center", href: "/dashboard/customers" },
      { label: "Vendor Center", href: "/dashboard/vendors" },
      { separator: true },
      { label: "Terms List", href: "/dashboard/settings/terms" },
      { label: "Sales Tax Codes", href: "/dashboard/settings/tax-codes" },
    ],
  },
  {
    label: "Customers",
    items: [
      { label: "Create Invoices", href: "/dashboard/invoices/new", shortcut: "Ctrl+I" },
      { label: "Receive Payments", href: "/dashboard/payments/new" },
      { label: "Customer Center", href: "/dashboard/customers" },
      { separator: true },
      { label: "A/R Aging Summary", href: "/dashboard/accounting/ar-aging" },
    ],
  },
  {
    label: "Vendors",
    items: [
      { label: "Create Purchase Orders", href: "/dashboard/purchase-orders/new" },
      { label: "Receive Inventory", href: "/dashboard/purchase-orders?filter=receivable" },
      { label: "Enter Bills", href: "/dashboard/bills/new" },
      { label: "Pay Bills", href: "/dashboard/bills?filter=unpaid" },
      { separator: true },
      { label: "A/P Aging Summary", href: "/dashboard/accounting/ap-aging" },
    ],
  },
  {
    label: "Reports",
    items: [
      { label: "Sales by Item Summary", href: "/dashboard/reports/sales-summary" },
      { label: "Inventory Valuation", href: "/dashboard/reports/inventory-valuation" },
      { label: "Sales Tax Liability", href: "/dashboard/reports/sales-tax" },
      { separator: true },
      { label: "Trial Balance", href: "/dashboard/accounting/trial-balance" },
      { label: "General Ledger", href: "/dashboard/accounting/general-ledger" },
      { separator: true },
      { label: "Audit Trail", href: "/dashboard/audit" },
    ],
  },
  {
    label: "Window",
    items: [{ label: "Close All", disabled: true }],
  },
  {
    label: "Help",
    items: [{ label: "About Gill Truck Parts", href: "/dashboard/about" }],
  },
];

export function QbMenuBar({ menus = APP_MENUS }: { menus?: Menu[] }) {
  const [openIndex, setOpenIndex] = React.useState<number | null>(null);
  const barRef = React.useRef<HTMLDivElement>(null);
  const router = useRouter();

  React.useEffect(() => {
    if (openIndex === null) return;
    function onDocMouseDown(event: MouseEvent) {
      if (!barRef.current?.contains(event.target as Node)) setOpenIndex(null);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpenIndex(null);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [openIndex]);

  // Global accelerators, the way the desktop app does them.
  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!event.ctrlKey || event.altKey || event.shiftKey) return;
      const target = event.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      // Ctrl+I inside a text field would otherwise steal the browser's
      // italic shortcut from a memo field.
      if (typing && event.key.toLowerCase() !== "i") return;

      const map: Record<string, string> = {
        i: "/dashboard/invoices/new",
        l: "/dashboard/items",
        a: "/dashboard/accounting/accounts",
      };
      const href = map[event.key.toLowerCase()];
      if (href) {
        event.preventDefault();
        router.push(href);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [router]);

  return (
    <div ref={barRef} className="qb-menubar qb-chrome-nosel relative qb-no-print">
      {menus.map((menu, index) => (
        <div key={menu.label} className="relative">
          <div
            className={cn(
              "qb-menubar-item h-full",
              openIndex === index && "qb-menubar-item-open",
            )}
            onMouseDown={(e) => {
              e.preventDefault();
              setOpenIndex(openIndex === index ? null : index);
            }}
            // Hover-to-switch once a menu is already open.
            onMouseEnter={() => openIndex !== null && setOpenIndex(index)}
            role="button"
            tabIndex={0}
            aria-haspopup="menu"
            aria-expanded={openIndex === index}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setOpenIndex(openIndex === index ? null : index);
              }
            }}
          >
            {menu.label}
          </div>

          {openIndex === index ? (
            <div className="qb-dropdown left-0 top-full" role="menu">
              {menu.items.map((entry, i) =>
                "separator" in entry && entry.separator ? (
                  <div key={"sep-" + i} className="qb-dropdown-sep" role="separator" />
                ) : (
                  (() => {
                    const item = entry as MenuItem;
                    const content = (
                      <>
                        <span>{item.label}</span>
                        {item.shortcut ? (
                          <span className="text-qb-xs opacity-70">{item.shortcut}</span>
                        ) : null}
                      </>
                    );
                    if (item.disabled || !item.href) {
                      return (
                        <div
                          key={item.label}
                          className="qb-dropdown-item qb-dropdown-item-disabled"
                          role="menuitem"
                          aria-disabled="true"
                        >
                          {content}
                        </div>
                      );
                    }
                    return (
                      <Link
                        key={item.label}
                        href={item.href}
                        className="qb-dropdown-item"
                        role="menuitem"
                        onClick={() => setOpenIndex(null)}
                      >
                        {content}
                      </Link>
                    );
                  })()
                ),
              )}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
