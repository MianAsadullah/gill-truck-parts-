import "server-only";

import type { Tx } from "@/lib/db";
import {
  SEQUENCE_DEFAULTS,
  formatDocumentNumber,
  type SequenceKey,
} from "@/lib/sequence-config";

/**
 * Gap-free document numbering.
 *
 * Two counter terminals writing invoices in the same second must not both
 * get INV-01042. The `update` below takes a row lock on the sequence for the
 * remainder of the caller's transaction, so the second terminal blocks until
 * the first commits and then reads 01043.
 *
 * This is why `nextDocumentNumber` REQUIRES a transaction client: called
 * outside one, the lock would release immediately and the guarantee would be
 * gone.
 */

export type { SequenceKey };
export { SEQUENCE_DEFAULTS };

/**
 * Reserve and format the next number for `key`.
 *
 * @param tx a Prisma transaction client — not the bare `prisma` instance
 */
export async function nextDocumentNumber(tx: Tx, key: SequenceKey): Promise<string> {
  const existing = await tx.documentSequence.findUnique({ where: { key } });

  if (!existing) {
    // First use of this sequence (a fresh database that skipped the seed).
    const defaults = SEQUENCE_DEFAULTS[key];
    const created = await tx.documentSequence.create({
      data: {
        key,
        prefix: defaults.prefix,
        padding: defaults.padding,
        nextValue: defaults.start + 1,
      },
    });
    return formatDocumentNumber(created.prefix, defaults.start, created.padding);
  }

  const updated = await tx.documentSequence.update({
    where: { key },
    data: { nextValue: { increment: 1 } },
  });

  // `updated.nextValue` is the post-increment value, so the number we just
  // reserved is one less.
  return formatDocumentNumber(
    updated.prefix,
    updated.nextValue - 1,
    updated.padding,
  );
}

/**
 * Peek at the next number without consuming it — for showing "INV-01042" in
 * a blank form before the user saves. Advisory only: the number actually
 * assigned is reserved at save time, inside the transaction.
 */
export async function peekDocumentNumber(
  client: { documentSequence: Tx["documentSequence"] },
  key: SequenceKey,
): Promise<string> {
  const row = await client.documentSequence.findUnique({ where: { key } });
  if (!row) {
    const d = SEQUENCE_DEFAULTS[key];
    return formatDocumentNumber(d.prefix, d.start, d.padding);
  }
  return formatDocumentNumber(row.prefix, row.nextValue, row.padding);
}
