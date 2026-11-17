"use client";

import * as React from "react";
import { QbModal } from "@/components/qb/Modal";
import { QbButton, QbField, QbInput, QbBanner, QbSelect } from "@/components/qb/Ui";
import { formatMoney, formatPercent } from "@/lib/money";
import type { PriceOverrideRequest } from "@/lib/validation/invoice";

/**
 * Manager price-override dialog (SEC).
 *
 * This window is what stands between a counter clerk and a below-minimum
 * sale. It is deliberately a hard stop:
 *   - it cannot be dismissed by clicking the backdrop
 *   - it states the exact dollars being given away, so the manager typing
 *     the code knows what they are signing
 *   - the reason field is mandatory
 *
 * What this dialog does NOT do is decide anything. It collects initials, a
 * code and a reason and hands them to the server with the invoice. The
 * server re-verifies the code against a bcrypt hash, confirms the approver's
 * role still carries pricing.approve_override, and checks the discount
 * against that role's ceiling. A clerk who edits this component in devtools
 * gains nothing.
 */

export interface OverrideContext {
  lineIndex: number;
  lineNo: number;
  sku: string;
  description: string;
  quantity: number;
  attemptedRate: number;
  minimumPrice: number;
  standardPrice: number;
}

const REASONS = [
  "Price match - competitor quote",
  "Fleet account concession",
  "Damaged / shelf-worn packaging",
  "Customer goodwill - previous issue",
  "Clearance / discontinued part",
  "Manager discretion",
];

export function PriceOverrideModal({
  open,
  context,
  onClose,
  onApprove,
  /** Shown read-only when the signed-in user can approve their own line. */
  selfApproveLabel,
}: {
  open: boolean;
  context: OverrideContext | null;
  onClose: () => void;
  onApprove: (lineIndex: number, grant: PriceOverrideRequest) => void;
  selfApproveLabel?: string | null;
}) {
  const [approverCode, setApproverCode] = React.useState("");
  const [overrideCode, setOverrideCode] = React.useState("");
  const [reason, setReason] = React.useState(REASONS[0]);
  const [customReason, setCustomReason] = React.useState("");
  const [localError, setLocalError] = React.useState<string | null>(null);
  const firstRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (open) {
      setApproverCode("");
      setOverrideCode("");
      setReason(REASONS[0]);
      setCustomReason("");
      setLocalError(null);
    }
  }, [open]);

  if (!context) return null;

  // Captured into a const so the nested `submit` closure keeps the narrowing
  // from the guard above — TypeScript will not narrow a destructured prop
  // across a function boundary.
  const ctx = context;

  const shortfall = Math.max(0, context.minimumPrice - context.attemptedRate);
  const concession = shortfall * Math.abs(context.quantity);
  const discountPct =
    context.minimumPrice > 0 ? shortfall / context.minimumPrice : 0;

  const effectiveReason = reason === "__other" ? customReason.trim() : reason;

  function submit() {
    setLocalError(null);

    if (!approverCode.trim()) {
      setLocalError("Enter the approving manager's initials.");
      return;
    }
    if (overrideCode.trim().length < 4) {
      setLocalError("The override code must be at least 4 characters.");
      return;
    }
    if (effectiveReason.length < 4) {
      setLocalError("Enter a reason for this override.");
      return;
    }

    onApprove(ctx.lineIndex, {
      approverCode: approverCode.trim().toUpperCase(),
      overrideCode: overrideCode.trim(),
      reason: effectiveReason,
    });
    onClose();
  }

  return (
    <QbModal
      open={open}
      title="Manager Approval Required — Price Below Minimum"
      onClose={onClose}
      width={620}
      closeOnBackdrop={false}
      initialFocusRef={firstRef}
      footer={
        <>
          <span className="mr-auto text-qb-xs text-qb-inkMuted">
            This approval is written to the permanent audit trail.
          </span>
          <QbButton variant="primary" onClick={submit}>
            Approve Price
          </QbButton>
          <QbButton onClick={onClose}>Cancel Line</QbButton>
        </>
      }
    >
      <div className="p-3 space-y-3">
        <QbBanner variant="err" title="This price is below the minimum.">
          Line {context.lineNo} cannot be sold at this price without a
          manager&rsquo;s override code.
        </QbBanner>

        {/* The numbers the manager is signing off on. */}
        <table className="qb-grid">
          <tbody>
            <tr>
              <td className="w-[150px] font-bold">Item</td>
              <td className="font-qbMono">{context.sku}</td>
            </tr>
            <tr>
              <td className="font-bold">Description</td>
              <td>{context.description}</td>
            </tr>
            <tr>
              <td className="font-bold">List price</td>
              <td className="font-qbMono">
                {formatMoney(context.standardPrice)}
              </td>
            </tr>
            <tr>
              <td className="font-bold">Minimum price</td>
              <td className="font-qbMono">{formatMoney(context.minimumPrice)}</td>
            </tr>
            <tr>
              <td className="font-bold">Requested price</td>
              <td className="font-qbMono text-qb-red font-bold">
                {formatMoney(context.attemptedRate)}
              </td>
            </tr>
            <tr>
              <td className="font-bold">Below minimum by</td>
              <td className="font-qbMono text-qb-red">
                {formatMoney(shortfall)} / unit &nbsp;&middot;&nbsp;
                {formatPercent(discountPct, 1)}
              </td>
            </tr>
            <tr className="bg-qb-warnBg">
              <td className="font-bold">
                Total concession ({context.quantity} &times;)
              </td>
              <td className="font-qbMono text-qb-red font-bold">
                {formatMoney(concession)}
              </td>
            </tr>
          </tbody>
        </table>

        {selfApproveLabel ? (
          <QbBanner variant="warn">
            You are signed in as <strong>{selfApproveLabel}</strong> and may
            authorize this yourself. Enter your own initials and override code
            to record the approval.
          </QbBanner>
        ) : null}

        {localError ? <QbBanner variant="err">{localError}</QbBanner> : null}

        <div className="qb-fieldset space-y-2">
          <div className="qb-fieldset-legend">Authorization</div>

          <QbField
            label="Manager"
            htmlFor="ovr-approver"
            labelWidth={92}
            hint="Employee initials, e.g. MG"
          >
            <QbInput
              id="ovr-approver"
              ref={firstRef}
              value={approverCode}
              onChange={(e) => setApproverCode(e.target.value.toUpperCase())}
              className="max-w-[90px] font-qbMono uppercase"
              maxLength={12}
              autoComplete="off"
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
          </QbField>

          <QbField
            label="Override Code"
            htmlFor="ovr-code"
            labelWidth={92}
            hint="Never shown or stored in plain text"
          >
            <QbInput
              id="ovr-code"
              type="password"
              value={overrideCode}
              onChange={(e) => setOverrideCode(e.target.value)}
              className="max-w-[160px] font-qbMono"
              autoComplete="one-time-code"
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
          </QbField>

          <QbField label="Reason" htmlFor="ovr-reason" labelWidth={92}>
            <QbSelect
              id="ovr-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            >
              {REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
              <option value="__other">Other (type below)...</option>
            </QbSelect>
          </QbField>

          {reason === "__other" ? (
            <QbField label="" labelWidth={92}>
              <QbInput
                value={customReason}
                onChange={(e) => setCustomReason(e.target.value)}
                placeholder="Describe the reason for this override"
                maxLength={280}
                onKeyDown={(e) => e.key === "Enter" && submit()}
              />
            </QbField>
          ) : null}
        </div>
      </div>
    </QbModal>
  );
}
