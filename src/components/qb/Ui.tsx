import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * QuickBooks Desktop UI primitives.
 *
 * These are presentational and hook-free so they can render in Server
 * Components. Anything that needs state (menus, modals, the line grid) lives
 * in its own "use client" file.
 */

/* ────────────────────────────────────────────────────────── Document window */

export function QbWindow({
  title,
  subtitle,
  toolbar,
  children,
  className,
  bodyClassName,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Buttons rendered at the right end of the title bar. */
  toolbar?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <div className={cn("qb-window flex flex-col min-h-0", className)}>
      <div className="qb-window-title qb-no-print">
        <span className="flex items-center gap-2 truncate">
          <span className="truncate">{title}</span>
          {subtitle ? (
            <span className="font-normal text-white/75 text-qb truncate">
              {subtitle}
            </span>
          ) : null}
        </span>
        {toolbar ? <span className="flex items-center gap-1">{toolbar}</span> : null}
      </div>
      <div className={cn("flex-1 min-h-0 overflow-auto", bodyClassName)}>
        {children}
      </div>
    </div>
  );
}

/* ───────────────────────────────────────────────────── Transaction ribbon */

export function QbRibbon({ children }: { children: React.ReactNode }) {
  return <div className="qb-ribbon qb-no-print">{children}</div>;
}

export function QbRibbonTab({
  active,
  children,
}: {
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("qb-ribbon-tab", active && "qb-ribbon-tab-active")}>
      {children}
    </div>
  );
}

/** A labelled cluster of commands, as on QB's Main ribbon. */
export function QbRibbonGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="qb-ribbon-group">
      <div className="flex items-center gap-1 pb-[2px]">{children}</div>
      <div className="qb-ribbon-group-label">{label}</div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────── Buttons */

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "primary";
  size?: "default" | "sm";
};

export const QbButton = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function QbButton(
    { variant = "default", size = "default", className, type = "button", ...rest },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(
          "qb-btn",
          variant === "primary" && "qb-btn-primary",
          size === "sm" && "qb-btn-sm",
          className,
        )}
        {...rest}
      />
    );
  },
);

/** The small square arrow/ellipsis button welded to a lookup field. */
export const QbIconButton = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement>
>(function QbIconButton({ className, type = "button", ...rest }, ref) {
  return (
    <button ref={ref} type={type} className={cn("qb-btn-icon", className)} {...rest} />
  );
});

/* ───────────────────────────────────────────────────────────────── Fields */

/**
 * Label + control + error, laid out as a horizontal pair like QB's form
 * headers. `width` sets the label column so a stack of fields aligns.
 */
export function QbField({
  label,
  htmlFor,
  error,
  hint,
  required,
  labelWidth = 72,
  children,
  className,
}: {
  label?: React.ReactNode;
  htmlFor?: string;
  error?: string | null;
  hint?: React.ReactNode;
  required?: boolean;
  labelWidth?: number;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start gap-2", className)}>
      {label !== undefined ? (
        <label
          htmlFor={htmlFor}
          className="qb-label shrink-0 pt-[3px] text-right"
          style={{ width: labelWidth }}
        >
          {label}
          {required ? <span className="text-qb-red">&nbsp;*</span> : null}
        </label>
      ) : null}
      <div className="flex-1 min-w-0">
        {children}
        {error ? (
          <div className="qb-field-err" role="alert">
            {error}
          </div>
        ) : hint ? (
          <div className="text-qb-xs text-qb-inkMuted pt-[1px]">{hint}</div>
        ) : null}
      </div>
    </div>
  );
}

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  invalid?: boolean;
  numeric?: boolean;
};

export const QbInput = React.forwardRef<HTMLInputElement, InputProps>(
  function QbInput({ className, invalid, numeric, ...rest }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          "qb-input",
          numeric && "qb-input-num",
          invalid && "qb-input-err",
          className,
        )}
        aria-invalid={invalid || undefined}
        {...rest}
      />
    );
  },
);

type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & {
  invalid?: boolean;
};

export const QbSelect = React.forwardRef<HTMLSelectElement, SelectProps>(
  function QbSelect({ className, invalid, children, ...rest }, ref) {
    return (
      <select
        ref={ref}
        className={cn("qb-select", invalid && "qb-input-err", className)}
        aria-invalid={invalid || undefined}
        {...rest}
      >
        {children}
      </select>
    );
  },
);

export const QbCheckbox = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(function QbCheckbox({ className, ...rest }, ref) {
  return (
    <input
      ref={ref}
      type="checkbox"
      className={cn("qb-checkbox", className)}
      {...rest}
    />
  );
});

/** A text field with a lookup button fused to its right edge. */
export function QbCombo({
  children,
  onOpen,
  openLabel = "Open lookup",
  className,
}: {
  children: React.ReactNode;
  onOpen?: () => void;
  openLabel?: string;
  className?: string;
}) {
  return (
    <div className={cn("qb-combo", className)}>
      {children}
      <QbIconButton onClick={onOpen} aria-label={openLabel} title={openLabel}>
        <svg width="8" height="5" viewBox="0 0 8 5" aria-hidden="true">
          <path fill="currentColor" d="M0 0h8L4 5z" />
        </svg>
      </QbIconButton>
    </div>
  );
}

/* ──────────────────────────────────────────────────────── Grouping / status */

export function QbFieldset({
  legend,
  children,
  className,
}: {
  legend?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("qb-fieldset", className)}>
      {legend ? <div className="qb-fieldset-legend pb-[2px]">{legend}</div> : null}
      {children}
    </div>
  );
}

export function QbBanner({
  variant = "warn",
  title,
  children,
  onDismiss,
  className,
}: {
  variant?: "warn" | "err" | "ok";
  title?: React.ReactNode;
  children?: React.ReactNode;
  onDismiss?: () => void;
  className?: string;
}) {
  const icon =
    variant === "err" ? "⚠" : variant === "ok" ? "✓" : "⚠";
  return (
    <div
      className={cn(
        "qb-banner",
        variant === "warn" && "qb-banner-warn",
        variant === "err" && "qb-banner-err",
        variant === "ok" && "qb-banner-ok",
        className,
      )}
      role={variant === "err" ? "alert" : "status"}
    >
      <span aria-hidden="true" className="pt-[1px] shrink-0">
        {icon}
      </span>
      <div className="flex-1 min-w-0">
        {title ? <div className="font-bold">{title}</div> : null}
        {children}
      </div>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 px-1 text-qb-inkMuted hover:text-qb-ink"
          aria-label="Dismiss"
        >
          &times;
        </button>
      ) : null}
    </div>
  );
}

const PILL_STYLES: Record<string, string> = {
  DRAFT: "bg-qb-chromeDark border-qb-border text-qb-inkMuted",
  OPEN: "bg-white border-qb-blue text-qb-blue",
  PARTIALLY_PAID: "bg-qb-warnBg border-qb-warnBorder text-qb-amber",
  PAID: "bg-qb-okBg border-qb-green text-qb-greenDark",
  VOID: "bg-qb-errBg border-qb-errBorder text-qb-red",
  PARTIALLY_RECEIVED: "bg-qb-warnBg border-qb-warnBorder text-qb-amber",
  RECEIVED: "bg-qb-okBg border-qb-green text-qb-greenDark",
  CLOSED: "bg-qb-chromeDark border-qb-border text-qb-inkMuted",
  CANCELLED: "bg-qb-errBg border-qb-errBorder text-qb-red",
};

export function QbPill({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "qb-pill",
        PILL_STYLES[status] ?? "bg-qb-chromeDark border-qb-border text-qb-inkMuted",
      )}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

/** Horizontal hairline used to separate ribbon/toolbar regions. */
export function QbSeparator({ vertical }: { vertical?: boolean }) {
  return vertical ? (
    <span className="w-px self-stretch bg-qb-line mx-1" aria-hidden="true" />
  ) : (
    <hr className="border-0 border-t border-qb-line my-1" />
  );
}

/** The empty-state row QuickBooks shows inside an otherwise empty list. */
export function QbEmpty({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 py-6 text-center text-qb text-qb-inkMuted">{children}</div>
  );
}
