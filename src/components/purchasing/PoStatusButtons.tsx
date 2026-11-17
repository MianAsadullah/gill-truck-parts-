"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { setPurchaseOrderStatus } from "@/server/actions/purchase-orders";
import { QbButton, QbBanner } from "@/components/qb/Ui";

/**
 * Issue / close / cancel buttons on the purchase-order detail window.
 *
 * Closing and cancelling both ask for confirmation, because both release
 * outstanding quantity-on-order and are not undoable from the UI.
 */
export function PoStatusButtons({ poId, status }: { poId: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [confirming, setConfirming] = React.useState<"close" | "cancel" | null>(null);

  async function run(action: "issue" | "close" | "cancel") {
    setBusy(true);
    setError(null);
    try {
      const result = await setPurchaseOrderStatus(poId, action);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setConfirming(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const terminal = status === "RECEIVED" || status === "CLOSED" || status === "CANCELLED";

  return (
    <div className="space-y-1">
      {error ? (
        <QbBanner variant="err" onDismiss={() => setError(null)}>
          {error}
        </QbBanner>
      ) : null}

      {status === "DRAFT" ? (
        <QbButton size="sm" variant="primary" disabled={busy} onClick={() => void run("issue")}>
          Issue Purchase Order
        </QbButton>
      ) : null}

      {!terminal && status !== "DRAFT" ? (
        confirming ? (
          <div className="space-y-1">
            <div className="text-qb-xs text-qb-red">
              {confirming === "cancel"
                ? "Cancel this order? Outstanding quantity is released from on-order."
                : "Close this order short? The balance will never be received."}
            </div>
            <div className="flex gap-1">
              <QbButton size="sm" disabled={busy} onClick={() => void run(confirming)}>
                Yes, {confirming}
              </QbButton>
              <QbButton size="sm" onClick={() => setConfirming(null)}>
                No
              </QbButton>
            </div>
          </div>
        ) : (
          <div className="flex gap-1">
            <QbButton size="sm" disabled={busy} onClick={() => setConfirming("close")}>
              Close Short
            </QbButton>
            <QbButton size="sm" disabled={busy} onClick={() => setConfirming("cancel")}>
              Cancel PO
            </QbButton>
          </div>
        )
      ) : null}

      {terminal ? (
        <div className="text-qb-xs text-qb-inkMuted">
          This order is {status.toLowerCase()} and cannot be changed.
        </div>
      ) : null}
    </div>
  );
}
