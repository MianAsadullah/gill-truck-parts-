"use client";

import * as React from "react";
import { QbModal } from "@/components/qb/Modal";
import { QbButton, QbInput, QbEmpty } from "@/components/qb/Ui";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/cn";
import type { CustomerSearchItem } from "@/types/dto";

/**
 * Customer lookup. Searches company name, customer number, phone AND the
 * plate/unit/VIN of any vehicle on file — because at the counter the thing
 * everyone knows is the truck sitting in the bay.
 */
export function CustomerLookupModal({
  open,
  onClose,
  onSelect,
  initialQuery = "",
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (customer: CustomerSearchItem) => void;
  initialQuery?: string;
}) {
  const [query, setQuery] = React.useState(initialQuery);
  const [customers, setCustomers] = React.useState<CustomerSearchItem[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [cursor, setCursor] = React.useState(0);
  const searchRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (open) {
      setQuery(initialQuery);
      setCursor(0);
    }
  }, [open, initialQuery]);

  React.useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(
          "/api/customers/search?q=" + encodeURIComponent(query),
          { signal: controller.signal },
        );
        const json = (await res.json()) as { customers: CustomerSearchItem[] };
        setCustomers(json.customers ?? []);
        setCursor(0);
      } catch (err) {
        if ((err as Error).name !== "AbortError") setCustomers([]);
      } finally {
        setLoading(false);
      }
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, open]);

  const choose = (customer: CustomerSearchItem) => {
    onSelect(customer);
    onClose();
  };

  const selected = customers[cursor];

  return (
    <QbModal
      open={open}
      title="Select Customer"
      onClose={onClose}
      width={820}
      initialFocusRef={searchRef}
      footer={
        <>
          <span className="mr-auto text-qb-xs text-qb-inkMuted">
            {loading ? "Searching..." : customers.length + " customers"}
          </span>
          <QbButton
            variant="primary"
            disabled={!selected}
            onClick={() => selected && choose(selected)}
          >
            Use Customer
          </QbButton>
          <QbButton onClick={onClose}>Cancel</QbButton>
        </>
      }
    >
      <div
        onKeyDown={(event) => {
          if (customers.length === 0) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setCursor((c) => Math.min(c + 1, customers.length - 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setCursor((c) => Math.max(c - 1, 0));
          } else if (event.key === "Enter") {
            event.preventDefault();
            if (selected) choose(selected);
          }
        }}
      >
        <div className="p-2 border-b border-qb-line bg-qb-chrome flex items-center gap-2">
          <label htmlFor="cust-search" className="qb-label shrink-0">
            Find
          </label>
          <QbInput
            id="cust-search"
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Company, customer no., phone, or license plate"
            className="max-w-[340px]"
            autoComplete="off"
          />
          <span className="text-qb-xs text-qb-inkMuted ml-auto">
            Plate and unit numbers are searched too
          </span>
        </div>

        <div className="bg-white max-h-[52vh] overflow-auto">
          {customers.length === 0 && !loading ? (
            <QbEmpty>No customers match that search.</QbEmpty>
          ) : (
            <table className="qb-grid">
              <thead>
                <tr>
                  <th style={{ width: 64 }}>No.</th>
                  <th>Company</th>
                  <th style={{ width: 120 }}>Contact</th>
                  <th style={{ width: 96 }}>Phone</th>
                  <th style={{ width: 76 }}>Terms</th>
                  <th style={{ width: 74 }}>Level</th>
                  <th style={{ width: 78 }} className="text-right">
                    Balance
                  </th>
                </tr>
              </thead>
              <tbody>
                {customers.map((customer, index) => (
                  <tr
                    key={customer.id}
                    className={cn(
                      "cursor-pointer",
                      index === cursor && "qb-row-selected",
                    )}
                    onMouseDown={() => setCursor(index)}
                    onDoubleClick={() => choose(customer)}
                  >
                    <td className="font-qbMono">{customer.customerNo}</td>
                    <td className="truncate" title={customer.companyName}>
                      {customer.companyName}
                      {customer.taxExempt ? (
                        <span className="text-qb-xs text-qb-amber"> (tax exempt)</span>
                      ) : null}
                    </td>
                    <td className="truncate">{customer.contactName ?? ""}</td>
                    <td className="font-qbMono text-qb-xs">{customer.phone ?? ""}</td>
                    <td className="text-qb-xs">{customer.terms?.name ?? ""}</td>
                    <td className="text-qb-xs">{customer.priceLevel}</td>
                    <td
                      className={cn(
                        "qb-grid-num",
                        customer.creditLimit > 0 &&
                          customer.balance > customer.creditLimit &&
                          "text-qb-red font-bold",
                      )}
                      title={
                        customer.creditLimit > 0
                          ? "Credit limit " + formatMoney(customer.creditLimit)
                          : undefined
                      }
                    >
                      {formatMoney(customer.balance)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {selected ? (
          <div className="border-t border-qb-line bg-qb-chromeAlt px-2 py-1 text-qb">
            <div className="flex flex-wrap gap-x-4">
              <span>
                {selected.billingAddress1 ?? ""}
                {selected.city ? ", " + selected.city : ""}
                {selected.state ? " " + selected.state : ""}{" "}
                {selected.postalCode ?? ""}
              </span>
              {selected.vehicles.length > 0 ? (
                <span>
                  Vehicles:{" "}
                  {selected.vehicles
                    .slice(0, 4)
                    .map((v) => v.licensePlate)
                    .join(", ")}
                  {selected.vehicles.length > 4
                    ? " +" + (selected.vehicles.length - 4)
                    : ""}
                </span>
              ) : null}
              {selected.creditLimit > 0 ? (
                <span>Credit limit: {formatMoney(selected.creditLimit)}</span>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </QbModal>
  );
}
