import clsx, { type ClassValue } from "clsx";

/**
 * Class-name joiner. Deliberately not tailwind-merge: the QB component
 * classes (.qb-input, .qb-btn) are real CSS classes in globals.css, not
 * utility strings, so there is nothing to de-duplicate — and the Tailwind
 * utilities we add on top are meant to override them via source order.
 */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}
