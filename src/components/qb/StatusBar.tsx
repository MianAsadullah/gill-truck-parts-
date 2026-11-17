"use client";

import * as React from "react";

/**
 * The status bar along the bottom of the window.
 *
 * QuickBooks keeps the company file, the logged-in user and the current date
 * here. We add a live clock and the record count, which is what counter
 * staff glance at to confirm the terminal is still connected.
 */
export function QbStatusBar({
  companyName,
  userLabel,
  roleLabel,
  message,
  recordCount,
}: {
  companyName: string;
  userLabel: string;
  roleLabel: string;
  message?: string;
  recordCount?: number;
}) {
  const [now, setNow] = React.useState<Date | null>(null);

  // Starts null and fills in after mount: rendering a clock on the server
  // guarantees a hydration mismatch.
  React.useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="qb-statusbar qb-no-print shrink-0">
      <div className="qb-statusbar-cell min-w-0 flex-1">
        <span className="truncate">{message ?? "Ready"}</span>
      </div>
      {recordCount !== undefined ? (
        <div className="qb-statusbar-cell">
          {recordCount.toLocaleString("en-US")}{" "}
          {recordCount === 1 ? "record" : "records"}
        </div>
      ) : null}
      <div className="qb-statusbar-cell">{companyName}</div>
      <div className="qb-statusbar-cell">
        {userLabel}
        <span className="text-qb-inkDisabled">&nbsp;&middot;&nbsp;{roleLabel}</span>
      </div>
      <div className="qb-statusbar-cell border-r-0 min-w-[150px] justify-end">
        {now
          ? now.toLocaleString("en-US", {
              month: "2-digit",
              day: "2-digit",
              year: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })
          : " "}
      </div>
    </div>
  );
}
