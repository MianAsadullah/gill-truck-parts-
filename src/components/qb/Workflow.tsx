import Link from "next/link";
import { cn } from "@/lib/cn";
import type { IconName } from "@/components/qb/IconBar";

/**
 * The QuickBooks Home Page workflow diagram.
 *
 * QB draws each business process as a left-to-right chain of icon tiles with
 * arrows between them, grouped into a captioned panel. Clicking a tile opens
 * that transaction. It is the single most recognisable screen in the product
 * and it is genuinely useful: a new counter hire can see the order of
 * operations without being told.
 */

const TILE_ICONS: Record<string, React.ReactNode> = {
  invoice: <path d="M4 2h10l4 4v14H4zm2 2v14h10V7h-4V4zm2 5h6v1.5H8zm0 3h6v1.5H8zm0 3h4v1.5H8z" />,
  customer: <path d="M12 4a3.2 3.2 0 1 1 0 6.4A3.2 3.2 0 0 1 12 4m0 7.6c3.5 0 6.4 1.8 6.4 3.9V20H5.6v-4.5c0-2.1 2.9-3.9 6.4-3.9" />,
  payment: <path d="M2 6h20v12H2zm2 3v2h16V9zm0 4v3h7v-3z" />,
  deposit: <path d="M12 3v9l4-4 1.5 1.5L12 15 6.5 9.5 8 8l4 4V3zM4 17h16v3H4z" />,
  po: <path d="M4 2h14v20H4zm3 4h8v1.5H7zm0 3.5h8V11H7zm0 3.5h5v1.5H7z" />,
  receive: <path d="M12 2 3 6.5v11L12 22l9-4.5v-11zm0 2.6 5.5 2.4L12 9.4 6.5 7zM5 9l6 2.7v7.6L5 16.6zm14 0v7.6l-6 2.7v-7.6z" />,
  bill: <path d="M3 3h18v18H3zm3 3v2h12V6zm0 5v2h12v-2zm0 5v2h8v-2z" />,
  checks: <path d="M2 5h20v8H2zm3 10h14v2H5zm2 3h10v2H7z" />,
  item: <path d="M12 2 2 7v10l10 5 10-5V7zm0 2.4 6.3 3.1L12 10.6 5.7 7.5zM4 9.2l7 3.4v6.9l-7-3.5zm16 0v6.8l-7 3.5v-6.9z" />,
  adjust: <path d="M4 4h16v2H4zm2 5h12v2H6zm-2 5h16v2H4zm4 5h8v2H8z" />,
  report: <path d="M3 20h4V9H3zm7 0h4V3h-4zm7 0h4v-8h-4z" />,
  ledger: <path d="M4 2h16v20H4zm2 3v2h12V5zm0 4h5v9H6zm7 0h5v2h-5zm0 4h5v2h-5zm0 4h5v2h-5z" />,
  vendor: <path d="M2 8h20v11H2zm3-5h14v3H5zm4 9h6v2H9z" />,
  audit: <path d="M10 2a8 8 0 1 0 4.9 14.3l4.8 4.8 1.7-1.7-4.8-4.8A8 8 0 0 0 10 2m0 3a5 5 0 1 1 0 10 5 5 0 0 1 0-10" />,
};

export function QbWorkflowTile({
  label,
  href,
  icon,
  disabled,
  accent = "blue",
  badge,
}: {
  label: string;
  href: string;
  icon: keyof typeof TILE_ICONS | IconName;
  disabled?: boolean;
  accent?: "blue" | "green" | "slate";
  badge?: string | number;
}) {
  const glyph = TILE_ICONS[icon] ?? TILE_ICONS.invoice;

  const body = (
    <>
      <span className="relative">
        <svg
          width="26"
          height="26"
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
          className={cn(
            disabled
              ? "text-qb-inkDisabled"
              : accent === "green"
                ? "text-qb-green"
                : accent === "slate"
                  ? "text-qb-inkMuted"
                  : "text-qb-blue",
          )}
        >
          {glyph}
        </svg>
        {badge ? (
          <span
            className="absolute -top-1 -right-2 bg-qb-red text-white text-qb-xs
                       leading-none px-1 py-[1px] rounded-sm min-w-[15px]
                       text-center"
          >
            {badge}
          </span>
        ) : null}
      </span>
      <span className="text-center leading-tight">{label}</span>
    </>
  );

  const base =
    "w-[86px] h-[74px] shrink-0 flex flex-col items-center justify-center gap-1 " +
    "px-1 text-qb bg-white border border-qb-line rounded-qb";

  if (disabled) {
    return (
      <div
        className={cn(base, "text-qb-inkDisabled bg-qb-chromeDark cursor-not-allowed")}
        title="Your role does not have access to this task"
        aria-disabled="true"
      >
        {body}
      </div>
    );
  }

  return (
    <Link
      href={href}
      className={cn(
        base,
        "text-qb-ink hover:bg-qb-menuHover hover:border-qb-field",
        "focus-visible:border-qb-blue focus-visible:ring-1 focus-visible:ring-qb-blue",
      )}
    >
      {body}
    </Link>
  );
}

/** The small chevron QuickBooks draws between two steps in a flow. */
export function QbFlowArrow() {
  return (
    <svg
      width="18"
      height="12"
      viewBox="0 0 18 12"
      aria-hidden="true"
      className="shrink-0 text-qb-border self-center"
    >
      <path d="M0 5h12V3l6 3-6 3V7H0z" fill="currentColor" />
    </svg>
  );
}

/** A captioned panel holding one flow. */
export function QbWorkflowPanel({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "border border-qb-border bg-qb-chromeAlt rounded-qb min-w-0",
        className,
      )}
    >
      <h2
        className="bg-qb-grid-header border-b border-qb-line px-2 h-[20px]
                   flex items-center text-qb font-bold uppercase tracking-wide
                   text-qb-inkMuted"
      >
        {title}
      </h2>
      <div className="p-2 flex items-start gap-1 flex-wrap">{children}</div>
    </section>
  );
}
