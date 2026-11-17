/**
 * Document numbering configuration.
 *
 * Kept separate from `sequence.ts` (which is `server-only`, because handing
 * out numbers requires a transaction and a row lock) so that plain Node
 * scripts — the seed, a migration helper, a CLI import — can read the
 * defaults without pulling in the server guard.
 */

export type SequenceKey =
  | "INVOICE"
  | "SALES_ORDER"
  | "PO"
  | "RECEIPT"
  | "BILL"
  | "JOURNAL"
  | "CUSTOMER_PAYMENT"
  | "BILL_PAYMENT"
  | "CUSTOMER"
  | "VENDOR";

export interface SequenceDefault {
  prefix: string;
  padding: number;
  /** First number this sequence will ever hand out. */
  start: number;
}

export const SEQUENCE_DEFAULTS: Record<SequenceKey, SequenceDefault> = {
  INVOICE: { prefix: "INV-", padding: 5, start: 1001 },
  SALES_ORDER: { prefix: "SO-", padding: 5, start: 1 },
  PO: { prefix: "PO-", padding: 5, start: 5001 },
  RECEIPT: { prefix: "RCT-", padding: 5, start: 1 },
  BILL: { prefix: "BILL-", padding: 5, start: 1 },
  JOURNAL: { prefix: "JE-", padding: 6, start: 1 },
  CUSTOMER_PAYMENT: { prefix: "PMT-", padding: 5, start: 1 },
  BILL_PAYMENT: { prefix: "CHK-", padding: 5, start: 1 },
  CUSTOMER: { prefix: "C", padding: 4, start: 1001 },
  VENDOR: { prefix: "V", padding: 4, start: 101 },
};

/** "INV-" + 1042 padded to 5 -> "INV-01042" */
export function formatDocumentNumber(
  prefix: string,
  value: number,
  padding: number,
): string {
  return prefix + String(value).padStart(padding, "0");
}
