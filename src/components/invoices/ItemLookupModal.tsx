"use client";

import * as React from "react";
import { QbModal } from "@/components/qb/Modal";
import { QbButton, QbInput, QbEmpty } from "@/components/qb/Ui";
import { formatMoney, formatQty, formatPercent } from "@/lib/money";
import { CROSS_REF_LABELS } from "@/lib/part-number";
import { cn } from "@/lib/cn";
import type { ProductSearchItem } from "@/types/dto";

/**
 * The item lookup window (QuickBooks' "Select Item" dialog).
 *
 * How a counter clerk actually uses this:
 *   - types a few characters, results narrow as they go
 *   - arrows up/down through the grid without touching the mouse
 *   - Enter selects, Esc backs out
 *   - the row shows On Hand so they know whether to walk to the shelf
 *
 * `canViewCost` controls whether the Cost and Margin columns exist. It is
 * passed down from the server, and the data backing those columns is absent
 * from the API response for unprivileged roles — so a tampered-with
 * `canViewCost={true}` on a counter session would render empty cells, not
 * leaked numbers.
 */
export function ItemLookupModal({
  open,
  onClose,
  onSelect,
  canViewCost,
  initialQuery = "",
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (item: ProductSearchItem) => void;
  canViewCost: boolean;
  initialQuery?: string;
}) {
  const [query, setQuery] = React.useState(initialQuery);
  const [items, setItems] = React.useState<ProductSearchItem[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [cursor, setCursor] = React.useState(0);
  const searchRef = React.useRef<HTMLInputElement>(null);
  const bodyRef = React.useRef<HTMLDivElement>(null);

  // Reset to the caller's query each time the window opens, so typing "RE50"
  // in the grid cell and pressing the lookup button pre-searches it.
  React.useEffect(() => {
    if (open) {
      setQuery(initialQuery);
      setCursor(0);
    }
  }, [open, initialQuery]);

  // Debounced search. 180ms is short enough to feel immediate while still
  // collapsing a burst of keystrokes into one request.
  React.useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          "/api/items/search?q=" + encodeURIComponent(query),
          { signal: controller.signal },
        );
        if (!res.ok) throw new Error("Search failed (" + res.status + ")");
        const json = (await res.json()) as { items: ProductSearchItem[] };
        setItems(json.items ?? []);
        setCursor(0);
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setError((err as Error).message || "Could not search items.");
          setItems([]);
        }
      } finally {
        setLoading(false);
      }
    }, 180);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, open]);

  const choose = React.useCallback(
    (item: ProductSearchItem) => {
      onSelect(item);
      onClose();
    },
    [onSelect, onClose],
  );

  // Keep the highlighted row inside the scroll viewport as the user arrows.
  React.useEffect(() => {
    const row = bodyRef.current?.querySelector<HTMLElement>(
      '[data-cursor="true"]',
    );
    row?.scrollIntoView({ block: "nearest" });
  }, [cursor, items]);

  function onKeyDown(event: React.KeyboardEvent) {
    if (items.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setCursor((c) => Math.min(c + 1, items.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const item = items[cursor];
      if (item) choose(item);
    } else if (event.key === "PageDown") {
      event.preventDefault();
      setCursor((c) => Math.min(c + 10, items.length - 1));
    } else if (event.key === "PageUp") {
      event.preventDefault();
      setCursor((c) => Math.max(c - 10, 0));
    }
  }

  const selected = items[cursor];

  return (
    <QbModal
      open={open}
      title="Select Item"
      onClose={onClose}
      width={canViewCost ? 980 : 860}
      initialFocusRef={searchRef}
      footer={
        <>
          <span className="mr-auto text-qb-xs text-qb-inkMuted">
            {loading
              ? "Searching..."
              : items.length + (items.length === 1 ? " item" : " items")}
            {items.length > 0 ? " · ↑↓ to move, Enter to select" : ""}
          </span>
          <QbButton
            variant="primary"
            disabled={!selected}
            onClick={() => selected && choose(selected)}
          >
            Use Item
          </QbButton>
          <QbButton onClick={onClose}>Cancel</QbButton>
        </>
      }
    >
      <div className="flex flex-col" onKeyDown={onKeyDown}>
        <div className="p-2 border-b border-qb-line bg-qb-chrome flex items-center gap-2">
          <label htmlFor="item-search" className="qb-label shrink-0">
            Find
          </label>
          <QbInput
            id="item-search"
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="SKU, OEM number, barcode, or description"
            className="max-w-[360px]"
            autoComplete="off"
          />
          {query ? (
            <QbButton size="sm" onClick={() => setQuery("")}>
              Clear
            </QbButton>
          ) : null}
          <span className="text-qb-xs text-qb-inkMuted ml-auto">
            Searches our SKU, OEM &amp; interchange numbers, barcode and
            description
          </span>
        </div>

        <div ref={bodyRef} className="bg-white max-h-[46vh] overflow-auto">
          {error ? (
            <QbEmpty>
              <span className="text-qb-red">{error}</span>
            </QbEmpty>
          ) : items.length === 0 && !loading ? (
            <QbEmpty>
              {query
                ? 'No items match "' + query + '".'
                : "No items in the catalog yet."}
            </QbEmpty>
          ) : (
            <table className="qb-grid">
              <thead>
                <tr>
                  <th style={{ width: 104 }}>Item / SKU</th>
                  <th>Description</th>
                  <th style={{ width: 128 }}>OEM / Interchange</th>
                  <th style={{ width: 52 }}>Bin</th>
                  <th style={{ width: 56 }} className="text-right">
                    On Hand
                  </th>
                  <th style={{ width: 62 }} className="text-right">
                    Price
                  </th>
                  <th style={{ width: 58 }} className="text-right">
                    Min
                  </th>
                  {canViewCost ? (
                    <>
                      <th style={{ width: 58 }} className="text-right">
                        Cost
                      </th>
                      <th style={{ width: 50 }} className="text-right">
                        GP%
                      </th>
                    </>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {items.map((item, index) => {
                  const xrefs = item.crossReferences ?? [];
                  const low =
                    item.type === "INVENTORY" &&
                    item.reorderPoint > 0 &&
                    item.quantityOnHand <= item.reorderPoint;
                  return (
                    <tr
                      key={item.id}
                      data-cursor={index === cursor ? "true" : undefined}
                      className={cn(
                        "cursor-pointer",
                        index === cursor && "qb-row-selected",
                      )}
                      onMouseDown={() => setCursor(index)}
                      onDoubleClick={() => choose(item)}
                    >
                      <td className="font-qbMono" title={item.sku}>
                        {item.sku}
                      </td>
                      <td title={item.longDescription ?? item.description}>
                        {item.description}
                        {item.type !== "INVENTORY" ? (
                          <span className="text-qb-inkMuted">
                            {" · "}
                            {item.type === "SERVICE" ? "service" : "non-stock"}
                          </span>
                        ) : null}
                      </td>
                      <td
                        className="font-qbMono text-qb-xs"
                        title={xrefs
                          .map(
                            (x) =>
                              (CROSS_REF_LABELS[x.type] ?? x.type) + " " + x.number,
                          )
                          .join("\n")}
                      >
                        {xrefs.slice(0, 2).map((x) => x.number).join(", ")}
                        {xrefs.length > 2 ? " +" + (xrefs.length - 2) : ""}
                      </td>
                      <td className="text-qb-xs">{item.binLocation ?? ""}</td>
                      <td
                        className={cn(
                          "qb-grid-num",
                          item.quantityOnHand <= 0 && "text-qb-red font-bold",
                          low && item.quantityOnHand > 0 && "text-qb-amber",
                        )}
                        title={low ? "At or below reorder point" : undefined}
                      >
                        {item.type === "INVENTORY"
                          ? formatQty(item.quantityOnHand)
                          : "—"}
                      </td>
                      <td className="qb-grid-num">
                        {formatMoney(item.standardPrice)}
                      </td>
                      <td className="qb-grid-num text-qb-inkMuted">
                        {formatMoney(item.minimumPrice)}
                      </td>
                      {canViewCost ? (
                        <>
                          <td className="qb-grid-num">
                            {item.averageCost === undefined
                              ? ""
                              : formatMoney(item.averageCost)}
                          </td>
                          <td className="qb-grid-num">
                            {item.marginPct === undefined || item.marginPct === null
                              ? ""
                              : formatPercent(item.marginPct, 1)}
                          </td>
                        </>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Detail strip for the highlighted row, like QB's preview pane. */}
        {selected ? (
          <div className="border-t border-qb-line bg-qb-chromeAlt px-2 py-1 text-qb">
            <div className="flex flex-wrap gap-x-4 gap-y-[2px]">
              <span>
                <strong>{selected.sku}</strong> &mdash; {selected.description}
              </span>
              {selected.brandName ? <span>Brand: {selected.brandName}</span> : null}
              {selected.categoryName ? (
                <span>Category: {selected.categoryName}</span>
              ) : null}
              <span>U/M: {selected.unitOfMeasure}</span>
              {selected.coreCharge > 0 ? (
                <span className="text-qb-amber">
                  Core charge: {formatMoney(selected.coreCharge)}
                </span>
              ) : null}
              {selected.type === "INVENTORY" ? (
                <span>
                  Available: {formatQty(selected.quantityAvailable)}
                  {selected.quantityOnOrder > 0
                    ? " (" + formatQty(selected.quantityOnOrder) + " on order)"
                    : ""}
                </span>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </QbModal>
  );
}
