"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

/**
 * The left icon bar (QuickBooks 2018+ "My Shortcuts").
 *
 * Collapsible, because on an 1024x768 counter terminal every pixel of grid
 * width matters. The collapsed state persists in localStorage so a clerk's
 * preference survives a reload.
 */

export interface ShortcutItem {
  label: string;
  href: string;
  icon: IconName;
  /** Hidden when the signed-in user lacks this permission. */
  permission?: string;
  badge?: number;
}

export interface ShortcutSection {
  title: string;
  items: ShortcutItem[];
}

export type IconName =
  | "home"
  | "invoice"
  | "customer"
  | "vendor"
  | "po"
  | "receive"
  | "bill"
  | "item"
  | "report"
  | "ledger"
  | "audit"
  | "settings"
  | "payment";

/**
 * Inline 14px glyphs. Deliberately not an icon library: the whole set is
 * ~2KB of SVG paths, and a dependency that ships 1,500 icons to render 13 of
 * them is a poor trade on a terminal over a shop's DSL line.
 */
const ICONS: Record<IconName, React.ReactNode> = {
  home: <path d="M7 1 1 6v7h4V9h4v4h4V6z" />,
  invoice: (
    <path d="M2 1h7l3 3v9H2zm1 1v10h8V5H8V2zm1 4h5v1H4zm0 2h5v1H4zm0 2h3v1H4z" />
  ),
  customer: (
    <path d="M7 2a2.2 2.2 0 1 1 0 4.4A2.2 2.2 0 0 1 7 2m0 5.4c2.4 0 4.4 1.2 4.4 2.6V13H2.6v-3c0-1.4 2-2.6 4.4-2.6" />
  ),
  vendor: <path d="M1 5h12v7H1zm2-3h8v2H3zm2 5h4v1H5z" />,
  po: <path d="M2 1h10v12H2zm2 3h6v1H4zm0 2h6v1H4zm0 2h4v1H4z" />,
  receive: <path d="M7 1v7l3-3 1 1-4 4-4-4 1-1 3 3V1zM2 11h10v2H2z" />,
  bill: <path d="M2 2h10v10H2zm2 2v1h6V4zm0 3v1h6V7zm0 3v1h4v-1z" />,
  item: <path d="M7 1 1 4v6l6 3 6-3V4zm0 2 3.5 1.5L7 6 3.5 4.5z" />,
  report: <path d="M2 12h2V6H2zm4 0h2V2H6zm4 0h2V8h-2z" />,
  ledger: <path d="M2 1h10v12H2zm1 2v1h8V3zm0 3h3v5H3zm5 0h3v1H8zm0 2h3v1H8z" />,
  audit: (
    <path d="M6 1a5 5 0 1 0 2.9 9.1l3 3 1.1-1.1-3-3A5 5 0 0 0 6 1m0 2a3 3 0 1 1 0 6 3 3 0 0 1 0-6" />
  ),
  settings: (
    <path d="M7 4.5A2.5 2.5 0 1 1 7 9.5a2.5 2.5 0 0 1 0-5m-1-3.5h2l.3 1.6 1.4.6 1.4-.8 1.4 1.4-.8 1.4.6 1.4 1.6.3v2l-1.6.3-.6 1.4.8 1.4-1.4 1.4-1.4-.8-1.4.6L8 13H6l-.3-1.6-1.4-.6-1.4.8-1.4-1.4.8-1.4-.6-1.4L0 7.4v-2l1.6-.3.6-1.4-.8-1.4L2.8 1l1.4.8 1.4-.6z" />
  ),
  payment: <path d="M1 3h12v8H1zm1 2v1h10V5zm0 3v2h4V8z" />,
};

function Icon({ name }: { name: IconName }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="currentColor"
      aria-hidden="true"
      className="shrink-0"
    >
      {ICONS[name]}
    </svg>
  );
}

const STORAGE_KEY = "gtp.iconbar.collapsed";

export function QbIconBar({
  sections,
  userLabel,
  roleLabel,
}: {
  sections: ShortcutSection[];
  userLabel: string;
  roleLabel: string;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = React.useState(false);
  // Avoid a hydration mismatch: render expanded on the server, then adopt
  // the stored preference after mount.
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
    try {
      setCollapsed(window.localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      /* private browsing — stay expanded */
    }
  }, []);

  const toggle = React.useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const isCollapsed = mounted && collapsed;

  return (
    <nav
      className={cn(
        "qb-iconbar qb-chrome-nosel shrink-0 overflow-y-auto overflow-x-hidden qb-no-print",
        isCollapsed ? "w-[42px]" : "w-[168px]",
      )}
      aria-label="Shortcuts"
    >
      <div
        className="flex items-center justify-between h-[26px] px-2
                   border-b border-black/30 shrink-0"
      >
        {!isCollapsed ? (
          <span className="text-qb-xs font-bold uppercase tracking-wide text-white/80">
            Shortcuts
          </span>
        ) : null}
        <button
          type="button"
          onClick={toggle}
          title={isCollapsed ? "Expand shortcuts" : "Collapse shortcuts"}
          aria-label={isCollapsed ? "Expand shortcuts" : "Collapse shortcuts"}
          aria-expanded={!isCollapsed}
          className="text-white/70 hover:text-white px-1 text-qb-md leading-none"
        >
          {isCollapsed ? "»" : "«"}
        </button>
      </div>

      <div className="flex-1 py-1">
        {sections.map((section) => (
          <div key={section.title}>
            {!isCollapsed ? (
              <div className="qb-iconbar-section">{section.title}</div>
            ) : (
              <div className="h-px bg-white/10 mx-2 my-2" aria-hidden="true" />
            )}
            {section.items.map((item) => {
              // Exact match for /dashboard so it is not active everywhere;
              // prefix match for the rest so /invoices/new lights /invoices.
              const active =
                item.href === "/dashboard"
                  ? pathname === "/dashboard"
                  : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href + item.label}
                  href={item.href}
                  title={isCollapsed ? item.label : undefined}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "qb-iconbar-item",
                    active && "qb-iconbar-item-active",
                    isCollapsed && "justify-center px-0",
                  )}
                >
                  <Icon name={item.icon} />
                  {!isCollapsed ? (
                    <span className="truncate flex-1">{item.label}</span>
                  ) : null}
                  {!isCollapsed && item.badge ? (
                    <span
                      className="bg-qb-red text-white text-qb-xs px-1 rounded-sm
                                 min-w-[16px] text-center"
                    >
                      {item.badge}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </div>
        ))}
      </div>

      {!isCollapsed ? (
        <div className="border-t border-black/30 px-3 py-2 shrink-0">
          <div className="text-qb text-white truncate">{userLabel}</div>
          <div className="text-qb-xs text-white/55 truncate">{roleLabel}</div>
        </div>
      ) : null}
    </nav>
  );
}
