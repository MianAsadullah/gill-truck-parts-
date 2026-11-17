"use client";

import { useEffect } from "react";

/**
 * Wires up the print toolbar on the printable invoice.
 *
 * Kept as a tiny client island so the document itself stays a server
 * component (it reads the invoice straight from the database). Deliberately
 * does NOT auto-print on load: counter staff open this page to check the
 * ticket before committing paper, and an unprompted print dialog on every
 * view is the kind of thing that gets a system sworn at.
 */
export function PrintTrigger() {
  useEffect(() => {
    const button = document.querySelector<HTMLButtonElement>(
      '[data-print-button="true"]',
    );
    if (!button) return;
    const onClick = () => window.print();
    button.addEventListener("click", onClick);
    return () => button.removeEventListener("click", onClick);
  }, []);

  // Ctrl+P already works natively; this just makes the shortcut discoverable
  // from the button as well.
  return null;
}
