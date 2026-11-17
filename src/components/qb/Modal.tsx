"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * QuickBooks-style modal dialog.
 *
 * Behaviours copied from the desktop app because counter staff rely on them:
 *   - Esc closes
 *   - the first focusable control is focused on open
 *   - Tab is trapped inside the dialog
 *   - the dialog is square-cornered with a blue title bar and a button row
 *     along the bottom right
 */
export function QbModal({
  open,
  title,
  onClose,
  children,
  footer,
  width = 720,
  /** Set false for a dialog that must be answered (e.g. price override). */
  closeOnBackdrop = true,
  initialFocusRef,
}: {
  open: boolean;
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: number;
  closeOnBackdrop?: boolean;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
}) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const previouslyFocused = React.useRef<HTMLElement | null>(null);

  // Remember what had focus so we can hand it back on close — otherwise the
  // clerk's keyboard position is lost every time a lookup window opens.
  React.useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const target =
      initialFocusRef?.current ??
      panelRef.current?.querySelector<HTMLElement>(
        'input:not([type="hidden"]):not([disabled]), select, textarea, button',
      );
    // rAF so the element exists and is laid out before we focus it.
    const raf = requestAnimationFrame(() => target?.focus());
    return () => {
      cancelAnimationFrame(raf);
      previouslyFocused.current?.focus?.();
    };
  }, [open, initialFocusRef]);

  React.useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[6vh] px-4 qb-no-print"
      role="presentation"
    >
      <div
        className="absolute inset-0 bg-black/25"
        onMouseDown={closeOnBackdrop ? onClose : undefined}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
        className={cn(
          "relative qb-window flex flex-col max-h-[86vh] w-full",
        )}
        style={{ maxWidth: width }}
      >
        <div className="qb-window-title">
          <span className="truncate">{title}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-[18px] h-[16px] leading-none bg-white/15 hover:bg-qb-red
                       border border-white/30 text-white text-qb-xs
                       flex items-center justify-center"
          >
            &times;
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-auto bg-qb-chrome">{children}</div>

        {footer ? (
          <div
            className="border-t border-qb-border bg-qb-chrome px-2 py-[6px]
                       flex items-center justify-end gap-1 shrink-0"
          >
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
