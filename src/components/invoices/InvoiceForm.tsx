"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm, useFieldArray, useWatch, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import {
  invoiceFormSchema,
  type InvoiceFormValues,
  type InvoiceLineValues,
  type PriceOverrideRequest,
} from "@/lib/validation/invoice";
import { createInvoice } from "@/server/actions/invoices";
import { checkLinePrice, resolvePrice, type PricingProduct } from "@/lib/pricing";
import { extend, formatMoney, formatPercent, formatQty, round2, sumMoney } from "@/lib/money";
import { cn } from "@/lib/cn";

import {
  QbButton,
  QbField,
  QbInput,
  QbSelect,
  QbCheckbox,
  QbBanner,
  QbRibbon,
  QbRibbonTab,
  QbRibbonGroup,
} from "@/components/qb/Ui";
import { ItemLookupModal } from "./ItemLookupModal";
import { CustomerLookupModal } from "./CustomerLookupModal";
import { PriceOverrideModal, type OverrideContext } from "./PriceOverrideModal";

import type {
  CustomerSearchItem,
  ProductSearchItem,
  RepOption,
  TaxCodeOption,
  TermsOption,
  ItemTypeName,
} from "@/types/dto";

/**
 * Create Invoices (SAL / INV-14).
 *
 * Modelled on QuickBooks' Create Invoices window: a ribbon of commands, a
 * header block with the customer on the left and date/number/terms on the
 * right, a dense line grid in the middle, and the totals stack bottom-right.
 *
 * Two line kinds share one grid, which is the requirement that shapes most
 * of this component:
 *
 *   INVENTORY PART  chosen from the item list. Deducts stock, carries a cost
 *                   snapshot, and is bound by the part's minimum price.
 *   MANUAL LINE     labor, diagnostics, shop supplies, freight. Typed
 *                   free-form. Touches no inventory and has no price floor,
 *                   because the service writer sets the rate.
 *
 * Cost and margin columns are rendered only when `canViewCost` is true, and
 * the numbers behind them are absent from the API payload otherwise — see
 * src/lib/product-dto.ts.
 */

/* ──────────────────────────────────────────────────────── line metadata */

/**
 * Per-line data needed for display and live validation but NOT submitted:
 * the server re-reads all of it from the database. Keyed by the line's
 * stable `key` so it survives reordering and deletion.
 */
interface LineMeta {
  product: ProductSearchItem | null;
}

const MANUAL_TYPES: ItemTypeName[] = ["SERVICE", "NON_INVENTORY", "OTHER_CHARGE"];

const MANUAL_TYPE_LABELS: Record<string, string> = {
  SERVICE: "Labor / Service",
  NON_INVENTORY: "Non-Inventory",
  OTHER_CHARGE: "Other Charge",
};

function newKey(): string {
  // crypto.randomUUID is unavailable on insecure origins in some browsers.
  try {
    return crypto.randomUUID();
  } catch {
    return "ln-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}

function blankLine(lineNo: number): InvoiceLineValues {
  return {
    key: newKey(),
    lineNo,
    productId: null,
    isManual: false,
    itemType: "INVENTORY",
    sku: null,
    description: "",
    quantity: 1,
    unitOfMeasure: "EA",
    rate: 0,
    isTaxable: true,
    override: null,
  };
}

function manualLine(lineNo: number): InvoiceLineValues {
  return {
    ...blankLine(lineNo),
    isManual: true,
    itemType: "SERVICE",
    unitOfMeasure: "HR",
    // Labor is a service, and services are not taxable in most
    // jurisdictions. The clerk can tick the Tax box when they are.
    isTaxable: false,
  };
}

function todayISO(): string {
  const d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return d.getFullYear() + "-" + month + "-" + day;
}

/** A line the user has not started filling in yet. */
function isBlankLine(line: InvoiceLineValues): boolean {
  return !line.productId && !line.description.trim();
}

/** Numeric grid inputs: "" or garbage becomes 0 rather than NaN. */
const asNumber = (raw: unknown): number => {
  if (raw === "" || raw === null || raw === undefined) return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
};

/* ─────────────────────────────────────────────────────────── component */

export interface InvoiceFormProps {
  nextInvoiceNo: string;
  terms: TermsOption[];
  taxCodes: TaxCodeOption[];
  reps: RepOption[];
  defaultTaxCodeId: string | null;
  currentUser: {
    id: string;
    employeeCode: string;
    fullName: string;
    roleName: string;
  };
  /** Role holds inventory.view_cost. */
  canViewCost: boolean;
  /** Role may price below minimum without a second signature. */
  canSellBelowMin: boolean;
  /** Role may itself approve an override (shown as a hint in the dialog). */
  canApproveOverride: boolean;
  /** CompanySettings.allowPriceOverride. */
  overridesEnabled: boolean;
}

export function InvoiceForm({
  nextInvoiceNo,
  terms,
  taxCodes,
  reps,
  defaultTaxCodeId,
  currentUser,
  canViewCost,
  canSellBelowMin,
  canApproveOverride,
  overridesEnabled,
}: InvoiceFormProps) {
  const router = useRouter();

  const emptyForm = React.useCallback(
    (): InvoiceFormValues => ({
      id: null,
      customerId: "",
      vehicleId: null,
      licensePlate: "",
      invoiceDate: todayISO(),
      serviceDate: todayISO(),
      dueDate: null,
      termsId: null,
      repId: currentUser.id,
      taxCodeId: defaultTaxCodeId,
      poNumber: "",
      memo: "",
      customerMessage: "",
      postToLedger: true,
      lines: [blankLine(1), blankLine(2), blankLine(3)],
    }),
    [currentUser.id, defaultTaxCodeId],
  );

  const [customer, setCustomer] = React.useState<CustomerSearchItem | null>(null);
  const [lineMeta, setLineMeta] = React.useState<Record<string, LineMeta>>({});
  const [customerOpen, setCustomerOpen] = React.useState(false);
  const [itemLookup, setItemLookup] = React.useState<{ index: number } | null>(null);
  const [overrideCtx, setOverrideCtx] = React.useState<OverrideContext | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState<{ id: string; invoiceNo: string } | null>(
    null,
  );
  const [submitting, setSubmitting] = React.useState(false);
  const [statusMessage, setStatusMessage] = React.useState("");

  const {
    control,
    register,
    setValue,
    getValues,
    setError,
    reset,
    formState: { errors },
  } = useForm<InvoiceFormValues>({
    resolver: zodResolver(invoiceFormSchema),
    mode: "onSubmit",
    defaultValues: emptyForm(),
  });

  const { fields, append, remove, update } = useFieldArray({
    control,
    name: "lines",
  });

  /**
   * `useWatch` rather than `watch`.
   *
   * `watch("lines")` does not reliably re-render this component when a
   * nested field inside the array changes (RHF 7.92), which silently broke
   * every derived number on the screen: the Amount column, the totals panel
   * and the below-minimum price check all kept their stale values while the
   * input itself showed what the clerk had typed. `useWatch` subscribes
   * through the control and re-renders on any change beneath `lines`.
   *
   * This is load-bearing for correctness, not just for live feedback: the
   * price-floor check reads these values. (The server re-checks regardless,
   * which is why the stale state produced a blocked save rather than an
   * underpriced invoice — but the clerk saw no warning until they hit Save.)
   */
  const lines = useWatch({ control, name: "lines" }) ?? [];
  const taxCodeId = useWatch({ control, name: "taxCodeId" });

  /* ─────────────────────────────────────── derived money, recomputed live */

  const taxRate = React.useMemo(() => {
    if (customer?.taxExempt) return 0;
    const code = taxCodes.find((t) => t.id === taxCodeId);
    return code ? code.rate : 0;
  }, [taxCodeId, taxCodes, customer?.taxExempt]);

  /**
   * One pass over the lines producing everything the UI needs: extended
   * amounts, the price check per line, and the totals. Doing it in a single
   * memo keeps the grid and the totals panel from ever disagreeing.
   */
  const calc = React.useMemo(() => {
    const rows = lines.map((line, index) => {
      const key = line.key;
      const product = lineMeta[key]?.product ?? null;
      const quantity = asNumber(line.quantity);
      const rate = asNumber(line.rate);
      const amount = extend(quantity, rate);

      const pricingProduct: PricingProduct | null = product
        ? {
            id: product.id,
            sku: product.sku,
            standardPrice: product.standardPrice,
            minimumPrice: product.minimumPrice,
          }
        : null;

      const check = checkLinePrice(pricingProduct, rate, quantity);
      const blank = isBlankLine(line);

      // A below-minimum line is "resolved" when either an override has been
      // attached or the signed-in role may go below unaided.
      const needsApproval =
        !blank &&
        check.status === "below_minimum" &&
        !line.override &&
        !canSellBelowMin;

      const unitCost = canViewCost ? (product?.averageCost ?? null) : null;
      const costAmount = unitCost !== null ? extend(quantity, unitCost) : null;

      return {
        index,
        key,
        line,
        product,
        quantity,
        rate,
        amount,
        check,
        blank,
        needsApproval,
        unitCost,
        costAmount,
        /** Stock short on this line (inventory parts only). */
        short: product?.type === "INVENTORY" && quantity > product.quantityAvailable,
      };
    });

    const live = rows.filter((r) => !r.blank);
    const subtotal = sumMoney(live.map((r) => r.amount));
    const taxableBase = sumMoney(
      live.filter((r) => r.line.isTaxable).map((r) => r.amount),
    );
    const taxTotal = round2(taxableBase * taxRate);
    const total = round2(subtotal + taxTotal);
    const costTotal = canViewCost ? sumMoney(live.map((r) => r.costAmount ?? 0)) : null;

    return {
      rows,
      liveCount: live.length,
      manualCount: live.filter((r) => r.line.isManual).length,
      stockedCount: live.filter(
        (r) => !r.line.isManual && r.product?.type === "INVENTORY",
      ).length,
      subtotal,
      taxableBase,
      taxTotal,
      total,
      costTotal,
      grossProfit: costTotal === null ? null : round2(subtotal - costTotal),
      blockers: rows.filter((r) => r.needsApproval),
      belowMinAllowed: rows.filter(
        (r) => !r.blank && r.check.status === "below_minimum" && !r.needsApproval,
      ),
      shortages: rows.filter((r) => r.short),
    };
  }, [lines, lineMeta, taxRate, canViewCost, canSellBelowMin]);

  /* ───────────────────────────────────────────────── line manipulation */

  /** Apply a chosen part to a line, pricing it for this customer. */
  const applyItem = React.useCallback(
    (index: number, item: ProductSearchItem) => {
      const current = getValues(`lines.${index}`);
      const key = current?.key ?? newKey();

      const priced = resolvePrice(
        {
          id: item.id,
          sku: item.sku,
          standardPrice: item.standardPrice,
          minimumPrice: item.minimumPrice,
        },
        customer
          ? { priceLevel: customer.priceLevel, discountPct: customer.discountPct }
          : null,
      );

      setLineMeta((prev) => ({ ...prev, [key]: { product: item } }));

      update(index, {
        key,
        lineNo: current?.lineNo ?? index + 1,
        productId: item.id,
        isManual: false,
        itemType: item.type,
        sku: item.sku,
        description: item.description,
        quantity: asNumber(current?.quantity) || 1,
        unitOfMeasure: item.unitOfMeasure,
        rate: priced.price,
        isTaxable: item.isTaxable,
        // A new part invalidates any override attached to the old one.
        override: null,
      });

      setStatusMessage(
        item.sku +
          " added" +
          (item.type === "INVENTORY"
            ? " · " + formatQty(item.quantityAvailable) + " available"
            : ""),
      );

      // Keep a blank row at the bottom, the way QB always leaves one open.
      if (index === getValues("lines").length - 1) {
        append(blankLine(getValues("lines").length + 1));
      }
    },
    [append, customer, getValues, update],
  );

  /** Clear a line back to blank without removing the row. */
  const clearLine = React.useCallback(
    (index: number) => {
      const current = getValues(`lines.${index}`);
      const key = current?.key ?? newKey();
      setLineMeta((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      update(index, { ...blankLine(current?.lineNo ?? index + 1), key });
    },
    [getValues, update],
  );

  const removeLine = React.useCallback(
    (index: number) => {
      const current = getValues(`lines.${index}`);
      if (current?.key) {
        const key = current.key;
        setLineMeta((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }
      // Never leave the grid with no rows at all.
      if (fields.length === 1) {
        clearLine(0);
        return;
      }
      remove(index);
    },
    [clearLine, fields.length, getValues, remove],
  );

  const onCustomerChosen = React.useCallback(
    (chosen: CustomerSearchItem) => {
      setCustomer(chosen);
      setValue("customerId", chosen.id, { shouldValidate: true });
      setValue("termsId", chosen.terms?.id ?? null);
      if (chosen.taxCode) setValue("taxCodeId", chosen.taxCode.id);
      // One vehicle on file: assume it is the one in the bay.
      if (chosen.vehicles.length === 1) {
        setValue("vehicleId", chosen.vehicles[0].id);
        setValue("licensePlate", chosen.vehicles[0].licensePlate);
      } else {
        setValue("vehicleId", null);
      }
      setStatusMessage("Customer set to " + chosen.companyName);
    },
    [setValue],
  );

  const attachOverride = React.useCallback(
    (lineIndex: number, grant: PriceOverrideRequest) => {
      setValue(`lines.${lineIndex}.override`, grant);
      setStatusMessage(
        "Override recorded for line " + (lineIndex + 1) + " · pending save",
      );
    },
    [setValue],
  );

  const openOverrideFor = React.useCallback(
    (index: number) => {
      const row = calc.rows[index];
      if (!row?.product) return;
      setOverrideCtx({
        lineIndex: index,
        lineNo: row.line.lineNo,
        sku: row.product.sku,
        description: row.line.description || row.product.description,
        quantity: row.quantity,
        attemptedRate: row.rate,
        minimumPrice: row.product.minimumPrice,
        standardPrice: row.product.standardPrice,
      });
    },
    [calc.rows],
  );

  const resetAll = React.useCallback(() => {
    reset(emptyForm());
    setCustomer(null);
    setLineMeta({});
    setFormError(null);
    setSaved(null);
  }, [emptyForm, reset]);

  /* ──────────────────────────────────────────────────────────── submit */

  const submit = React.useCallback(
    async (postToLedger: boolean, thenNew: boolean) => {
      setFormError(null);
      setSaved(null);

      // Below-minimum lines nobody has authorized: stop here and open the
      // approval dialog rather than letting the server reject the save.
      if (calc.blockers.length > 0) {
        const first = calc.blockers[0];
        if (!overridesEnabled) {
          setFormError(
            "Below-minimum pricing is disabled company-wide. Raise the rate on line " +
              (first.index + 1) +
              " to continue.",
          );
          return;
        }
        openOverrideFor(first.index);
        setFormError(
          "Line " +
            (first.index + 1) +
            " is priced below the minimum and needs manager approval.",
        );
        return;
      }

      const values = getValues();

      // Drop untouched rows and renumber 1..n so the server's line numbers
      // and our error paths line up.
      const kept: { formIndex: number; line: InvoiceLineValues }[] = [];
      values.lines.forEach((line, formIndex) => {
        if (isBlankLine(line)) return;
        kept.push({
          formIndex,
          line: {
            ...line,
            lineNo: kept.length + 1,
            quantity: asNumber(line.quantity),
            rate: asNumber(line.rate),
          },
        });
      });

      if (kept.length === 0) {
        setFormError("Add at least one item or labor line before saving.");
        return;
      }
      if (!values.customerId) {
        setError("customerId", { message: "Select a customer" });
        setFormError("Select a customer for this invoice.");
        return;
      }

      setSubmitting(true);
      setStatusMessage("Saving invoice...");

      try {
        const result = await createInvoice({
          ...values,
          postToLedger,
          lines: kept.map((k) => k.line),
        });

        if (!result.ok) {
          setFormError(result.error);

          // Map the server's payload-relative paths back to form indexes.
          if (result.fieldErrors) {
            for (const [path, message] of Object.entries(result.fieldErrors)) {
              const match = /^lines\.(\d+)\.(.+)$/.exec(path);
              if (match) {
                const payloadIndex = Number(match[1]);
                const formIndex = kept[payloadIndex]?.formIndex ?? payloadIndex;
                const field = match[2];

                // The server refused the manager's code. Detach the override
                // so the line goes back to showing the red "needs approval"
                // marker. Leaving it attached would show a tick against a
                // line that nobody actually authorized — the clerk would
                // believe the price was approved and keep retrying a save
                // that can never succeed.
                if (field.startsWith("override")) {
                  setValue(`lines.${formIndex}.override`, null);
                }

                setError(`lines.${formIndex}.rate`, { message });
              } else if (path === "customerId") {
                setError("customerId", { message });
              }
            }
          }

          // The server found a floor breach the client had not caught (for
          // instance the part's minimum changed since lookup). Open the
          // dialog on the offending line.
          if (result.pricingViolation?.requiresApproval) {
            const formIndex = kept[result.pricingViolation.lineNo - 1]?.formIndex;
            if (formIndex !== undefined) openOverrideFor(formIndex);
          }

          setStatusMessage("Save failed");
          return;
        }

        setSaved({ id: result.data.id, invoiceNo: result.data.invoiceNo });
        setStatusMessage(
          "Invoice " +
            result.data.invoiceNo +
            " saved · " +
            formatMoney(result.data.total),
        );

        if (thenNew) {
          reset(emptyForm());
          setCustomer(null);
          setLineMeta({});
        } else {
          router.push("/dashboard/invoices/" + result.data.id);
        }
      } catch (err) {
        setFormError(
          err instanceof Error
            ? err.message
            : "The invoice could not be saved. Please try again.",
        );
        setStatusMessage("Save failed");
      } finally {
        setSubmitting(false);
      }
    },
    [
      calc.blockers,
      emptyForm,
      getValues,
      openOverrideFor,
      overridesEnabled,
      reset,
      router,
      setError,
      setValue,
    ],
  );

  /* ───────────────────────────────────────────────────────────── render */

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit(true, false);
      }}
      className="qb-window flex flex-col"
      // Enter inside the grid should not submit the whole invoice — in QB it
      // moves to the next field. The explicit buttons do the saving.
      onKeyDown={(event) => {
        if (
          event.key === "Enter" &&
          (event.target as HTMLElement).tagName === "INPUT"
        ) {
          event.preventDefault();
        }
      }}
    >
      {/* ─────────────────────────────────────────────── title + ribbon */}
      <div className="qb-window-title qb-no-print">
        <span>Create Invoices</span>
        <span className="font-normal text-white/80 text-qb">
          {customer ? customer.companyName : "No customer selected"}
        </span>
      </div>

      <QbRibbon>
        <QbRibbonTab active>Main</QbRibbonTab>
        <QbRibbonTab>Formatting</QbRibbonTab>
        <QbRibbonTab>Send/Ship</QbRibbonTab>
        <QbRibbonTab>Reports</QbRibbonTab>
      </QbRibbon>

      <div
        className="bg-qb-ribbon border-b border-qb-ribbonLine px-1 py-1
                   flex items-stretch flex-wrap qb-no-print"
      >
        <QbRibbonGroup label="New">
          <QbButton
            size="sm"
            onClick={() => {
              resetAll();
              setStatusMessage("New blank invoice");
            }}
          >
            Blank Invoice
          </QbButton>
        </QbRibbonGroup>

        <QbRibbonGroup label="Save">
          <QbButton
            size="sm"
            variant="primary"
            disabled={submitting}
            onClick={() => void submit(true, false)}
          >
            {submitting ? "Saving..." : "Save & Close"}
          </QbButton>
          <QbButton
            size="sm"
            disabled={submitting}
            onClick={() => void submit(true, true)}
          >
            Save &amp; New
          </QbButton>
          <QbButton
            size="sm"
            disabled={submitting}
            onClick={() => void submit(false, false)}
            title="Save without posting to the general ledger"
          >
            Save as Draft
          </QbButton>
        </QbRibbonGroup>

        <QbRibbonGroup label="Lines">
          <QbButton size="sm" onClick={() => append(blankLine(fields.length + 1))}>
            + Item Line
          </QbButton>
          <QbButton
            size="sm"
            onClick={() => {
              append(manualLine(fields.length + 1));
              setStatusMessage("Manual labor/service line added");
            }}
            title="A labor, service or misc. charge line that does not affect parts inventory"
          >
            + Labor / Service
          </QbButton>
        </QbRibbonGroup>

        <QbRibbonGroup label="Print">
          <QbButton
            size="sm"
            disabled={!saved}
            onClick={() =>
              saved &&
              window.open("/dashboard/invoices/" + saved.id + "/print", "_blank")
            }
            title={saved ? "Open the printable invoice" : "Save the invoice first"}
          >
            Print / PDF
          </QbButton>
        </QbRibbonGroup>

        <div className="ml-auto flex flex-col items-end justify-center px-2">
          <span className="text-qb-xs text-qb-inkMuted">Signed in as</span>
          <span className="text-qb font-bold">
            {currentUser.fullName} ({currentUser.employeeCode})
          </span>
          <span className="text-qb-xs text-qb-inkMuted">
            {currentUser.roleName}
            {!canViewCost ? " · cost hidden" : ""}
          </span>
        </div>
      </div>

      {/* ───────────────────────────────────────────────── notifications */}
      <div className="px-2 pt-2 space-y-1 empty:hidden">
        {saved ? (
          <QbBanner variant="ok" title={"Invoice " + saved.invoiceNo + " saved"}>
            <a
              className="text-qb-blue hover:underline"
              href={"/dashboard/invoices/" + saved.id}
            >
              Open invoice
            </a>
            {" · "}
            <a
              className="text-qb-blue hover:underline"
              href={"/dashboard/invoices/" + saved.id + "/print"}
              target="_blank"
              rel="noreferrer"
            >
              Print / PDF
            </a>
          </QbBanner>
        ) : null}

        {formError ? (
          <QbBanner variant="err" onDismiss={() => setFormError(null)}>
            {formError}
          </QbBanner>
        ) : null}

        {calc.blockers.length > 0 ? (
          <QbBanner
            variant="err"
            title={
              calc.blockers.length +
              " line" +
              (calc.blockers.length === 1 ? "" : "s") +
              " priced below minimum"
            }
          >
            Manager approval is required before this invoice can be saved.{" "}
            <button
              type="button"
              className="text-qb-blue underline"
              onClick={() => openOverrideFor(calc.blockers[0].index)}
            >
              Enter override for line {calc.blockers[0].index + 1}
            </button>
          </QbBanner>
        ) : null}

        {calc.belowMinAllowed.length > 0 ? (
          <QbBanner variant="warn">
            {calc.belowMinAllowed.length} line
            {calc.belowMinAllowed.length === 1 ? " is" : "s are"} below minimum
            price and will be written to the audit trail on save.
          </QbBanner>
        ) : null}

        {calc.shortages.length > 0 ? (
          <QbBanner variant="warn">
            Not enough stock on{" "}
            {calc.shortages
              .map((r) => r.product?.sku)
              .filter(Boolean)
              .join(", ")}
            . The sale is allowed; quantity on hand will go negative.
          </QbBanner>
        ) : null}

        {customer &&
        customer.creditLimit > 0 &&
        customer.balance + calc.total > customer.creditLimit ? (
          <QbBanner variant="warn" title="Over credit limit">
            {customer.companyName} owes {formatMoney(customer.balance)} against a
            limit of {formatMoney(customer.creditLimit)}. This invoice would
            bring the balance to {formatMoney(customer.balance + calc.total)}.
          </QbBanner>
        ) : null}
      </div>

      {/* ───────────────────────────────────────────────── header block */}
      <div className="p-2">
        <div className="border border-qb-line bg-white">
          <div
            className="flex flex-wrap items-start gap-x-6 gap-y-1 px-2 py-2
                       border-b border-qb-line bg-qb-chromeAlt"
          >
            <div className="flex-1 min-w-[300px]">
              <QbField
                label="Customer:Job"
                htmlFor="customer-field"
                labelWidth={78}
                required
                error={errors.customerId?.message}
              >
                <div className="flex items-stretch gap-1">
                  <QbInput
                    id="customer-field"
                    readOnly
                    value={
                      customer
                        ? customer.companyName + " (" + customer.customerNo + ")"
                        : ""
                    }
                    placeholder="Press Find to choose a customer"
                    invalid={!!errors.customerId}
                    className="max-w-[340px] cursor-pointer"
                    onMouseDown={() => setCustomerOpen(true)}
                  />
                  <QbButton size="sm" onClick={() => setCustomerOpen(true)}>
                    Find...
                  </QbButton>
                  {customer ? (
                    <QbButton
                      size="sm"
                      onClick={() => {
                        setCustomer(null);
                        setValue("customerId", "");
                        setValue("vehicleId", null);
                        setValue("licensePlate", "");
                      }}
                    >
                      Clear
                    </QbButton>
                  ) : null}
                </div>
              </QbField>

              {customer ? (
                <div className="pt-2 flex gap-6 flex-wrap">
                  <div className="text-qb leading-[15px]">
                    <div className="qb-fieldset-legend">Bill To</div>
                    <div className="font-bold">{customer.companyName}</div>
                    {customer.contactName ? <div>{customer.contactName}</div> : null}
                    {customer.billingAddress1 ? (
                      <div>{customer.billingAddress1}</div>
                    ) : null}
                    <div>
                      {customer.city ? customer.city + ", " : ""}
                      {customer.state ?? ""} {customer.postalCode ?? ""}
                    </div>
                    {customer.phone ? (
                      <div className="font-qbMono">{customer.phone}</div>
                    ) : null}
                  </div>
                  <div className="text-qb leading-[15px]">
                    <div className="qb-fieldset-legend">Account</div>
                    <div>
                      Price level: <strong>{customer.priceLevel}</strong>
                      {customer.discountPct > 0
                        ? " (" + formatPercent(customer.discountPct, 0) + " off)"
                        : ""}
                    </div>
                    <div>Balance: {formatMoney(customer.balance)}</div>
                    {customer.creditLimit > 0 ? (
                      <div>Credit limit: {formatMoney(customer.creditLimit)}</div>
                    ) : null}
                    {customer.taxExempt ? (
                      <div className="text-qb-amber font-bold">Tax exempt</div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>

            {/* Right-hand date / number block */}
            <div className="w-[292px] shrink-0 space-y-1">
              <QbField
                label="Date"
                htmlFor="invoiceDate"
                labelWidth={80}
                error={errors.invoiceDate?.message}
              >
                <QbInput
                  id="invoiceDate"
                  type="date"
                  {...register("invoiceDate")}
                  className="max-w-[130px]"
                />
              </QbField>

              <QbField label="Invoice #" labelWidth={80}>
                <QbInput
                  readOnly
                  value={nextInvoiceNo}
                  className="max-w-[110px] font-qbMono"
                  title="Assigned when the invoice is saved"
                />
              </QbField>

              <QbField
                label="Service Date"
                htmlFor="serviceDate"
                labelWidth={80}
                error={errors.serviceDate?.message}
              >
                <QbInput
                  id="serviceDate"
                  type="date"
                  {...register("serviceDate")}
                  className="max-w-[130px]"
                />
              </QbField>

              <QbField label="License Plate" htmlFor="licensePlate" labelWidth={80}>
                {customer && customer.vehicles.length > 1 ? (
                  <Controller
                    control={control}
                    name="vehicleId"
                    render={({ field }) => (
                      <QbSelect
                        value={field.value ?? ""}
                        onChange={(e) => {
                          const id = e.target.value || null;
                          field.onChange(id);
                          const vehicle = customer.vehicles.find((v) => v.id === id);
                          setValue("licensePlate", vehicle?.licensePlate ?? "");
                        }}
                        className="max-w-[180px]"
                      >
                        <option value="">-- select vehicle --</option>
                        {customer.vehicles.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.licensePlate}
                            {v.unitNumber ? " (Unit " + v.unitNumber + ")" : ""}
                            {v.year || v.make
                              ? " · " +
                                [v.year, v.make, v.model].filter(Boolean).join(" ")
                              : ""}
                          </option>
                        ))}
                      </QbSelect>
                    )}
                  />
                ) : (
                  <QbInput
                    id="licensePlate"
                    {...register("licensePlate")}
                    className="max-w-[130px] font-qbMono uppercase"
                    placeholder="7ABC123"
                    maxLength={20}
                  />
                )}
              </QbField>

              <QbField label="Terms" htmlFor="termsId" labelWidth={80}>
                <QbSelect id="termsId" {...register("termsId")} className="max-w-[160px]">
                  <option value="">-- none --</option>
                  {terms.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </QbSelect>
              </QbField>

              <QbField label="Rep" htmlFor="repId" labelWidth={80}>
                <QbSelect id="repId" {...register("repId")} className="max-w-[160px]">
                  {reps.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.employeeCode} &mdash; {r.fullName}
                    </option>
                  ))}
                </QbSelect>
              </QbField>

              <QbField label="P.O. No." htmlFor="poNumber" labelWidth={80}>
                <QbInput
                  id="poNumber"
                  {...register("poNumber")}
                  className="max-w-[130px] font-qbMono"
                  placeholder="customer PO"
                />
              </QbField>

              <QbField label="Tax" htmlFor="taxCodeId" labelWidth={80}>
                <QbSelect
                  id="taxCodeId"
                  {...register("taxCodeId")}
                  className="max-w-[180px]"
                  disabled={customer?.taxExempt}
                >
                  <option value="">-- non-taxable --</option>
                  {taxCodes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.code} ({formatPercent(t.rate, 3)})
                    </option>
                  ))}
                </QbSelect>
              </QbField>
            </div>
          </div>

          {/* ─────────────────────────────────────────── the line grid */}
          <div className="overflow-x-auto">
            <table className="qb-grid min-w-[980px]">
              <thead>
                <tr>
                  <th style={{ width: 26 }} title="Line number">
                    #
                  </th>
                  <th style={{ width: 128 }}>Item</th>
                  <th>Description</th>
                  <th style={{ width: 58 }} className="text-right">
                    Qty
                  </th>
                  <th style={{ width: 44 }}>U/M</th>
                  <th style={{ width: 76 }} className="text-right">
                    Rate
                  </th>
                  <th style={{ width: 84 }} className="text-right">
                    Amount
                  </th>
                  {canViewCost ? (
                    <>
                      <th style={{ width: 66 }} className="text-right">
                        Cost
                      </th>
                      <th style={{ width: 52 }} className="text-right">
                        GP%
                      </th>
                    </>
                  ) : null}
                  <th style={{ width: 30 }} title="Taxable">
                    Tax
                  </th>
                  <th style={{ width: 54 }}>&nbsp;</th>
                </tr>
              </thead>
              <tbody>
                {fields.map((field, index) => {
                  const row = calc.rows[index];
                  if (!row) return null;
                  const err = errors.lines?.[index];
                  const isManual = row.line.isManual;
                  const belowMin = row.check.status === "below_minimum";
                  const hasOverride = Boolean(row.line.override);

                  return (
                    <tr
                      key={field.id}
                      className={cn(
                        row.needsApproval && "bg-qb-errBg",
                        hasOverride && "bg-qb-warnBg",
                        isManual && !belowMin && "bg-[#F4F8FB]",
                      )}
                    >
                      <td className="text-center text-qb-inkMuted font-qbMono">
                        {index + 1}
                      </td>

                      {/* Item cell: lookup for parts, type picker for manual */}
                      <td className="p-0">
                        {isManual ? (
                          <select
                            className="qb-cell-input bg-transparent"
                            {...register(`lines.${index}.itemType`)}
                            aria-label={"Line " + (index + 1) + " type"}
                          >
                            {MANUAL_TYPES.map((t) => (
                              <option key={t} value={t}>
                                {MANUAL_TYPE_LABELS[t]}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <div className="flex items-center">
                            <input
                              className={cn(
                                "qb-cell-input font-qbMono cursor-pointer",
                                err?.productId && "qb-cell-input-err",
                              )}
                              value={row.line.sku ?? ""}
                              placeholder="select..."
                              readOnly
                              onMouseDown={() => setItemLookup({ index })}
                              aria-label={"Line " + (index + 1) + " item"}
                            />
                            <button
                              type="button"
                              className="qb-btn-icon shrink-0 h-[18px] w-[16px]"
                              onClick={() => setItemLookup({ index })}
                              aria-label={"Look up item for line " + (index + 1)}
                              title="Item lookup (SKU, OEM number, barcode)"
                            >
                              <svg
                                width="8"
                                height="5"
                                viewBox="0 0 8 5"
                                aria-hidden="true"
                              >
                                <path fill="currentColor" d="M0 0h8L4 5z" />
                              </svg>
                            </button>
                          </div>
                        )}
                      </td>

                      <td className="p-0">
                        <input
                          className={cn(
                            "qb-cell-input",
                            err?.description && "qb-cell-input-err",
                          )}
                          placeholder={
                            isManual
                              ? "e.g. Brake system diagnosis — 2.0 hr"
                              : "Description"
                          }
                          {...register(`lines.${index}.description`)}
                          aria-label={"Line " + (index + 1) + " description"}
                        />
                      </td>

                      <td className="p-0">
                        <input
                          className={cn(
                            "qb-cell-input qb-cell-input-num",
                            err?.quantity && "qb-cell-input-err",
                          )}
                          type="number"
                          step="0.01"
                          {...register(`lines.${index}.quantity`, {
                            setValueAs: asNumber,
                          })}
                          aria-label={"Line " + (index + 1) + " quantity"}
                        />
                      </td>

                      <td className="p-0">
                        <input
                          className="qb-cell-input text-center uppercase"
                          maxLength={12}
                          {...register(`lines.${index}.unitOfMeasure`)}
                          aria-label={"Line " + (index + 1) + " unit of measure"}
                        />
                      </td>

                      <td className="p-0">
                        <div className="flex items-center">
                          <input
                            className={cn(
                              "qb-cell-input qb-cell-input-num",
                              (err?.rate || row.needsApproval) && "qb-cell-input-err",
                            )}
                            type="number"
                            step="0.01"
                            min="0"
                            {...register(`lines.${index}.rate`, {
                              setValueAs: asNumber,
                            })}
                            aria-label={"Line " + (index + 1) + " rate"}
                            title={
                              row.product
                                ? "List " +
                                  formatMoney(row.product.standardPrice) +
                                  " · minimum " +
                                  formatMoney(row.product.minimumPrice)
                                : undefined
                            }
                          />
                          {belowMin ? (
                            <button
                              type="button"
                              onClick={() => openOverrideFor(index)}
                              className={cn(
                                "shrink-0 px-[2px] text-qb-xs leading-none",
                                hasOverride ? "text-qb-amber" : "text-qb-red font-bold",
                              )}
                              title={
                                hasOverride
                                  ? "Override attached — click to change"
                                  : (row.check.message ?? "Below minimum price")
                              }
                              aria-label={
                                "Line " +
                                (index + 1) +
                                (hasOverride
                                  ? " override attached"
                                  : " needs manager approval")
                              }
                            >
                              {hasOverride ? "✓" : "⚠"}
                            </button>
                          ) : null}
                        </div>
                      </td>

                      <td className="qb-grid-num">
                        {row.blank ? "" : formatMoney(row.amount)}
                      </td>

                      {canViewCost ? (
                        <>
                          <td className="qb-grid-num text-qb-inkMuted">
                            {row.costAmount === null || row.blank
                              ? ""
                              : formatMoney(row.costAmount)}
                          </td>
                          <td
                            className={cn(
                              "qb-grid-num",
                              row.amount > 0 &&
                                row.costAmount !== null &&
                                row.amount - row.costAmount < 0 &&
                                "text-qb-red font-bold",
                            )}
                          >
                            {row.blank || row.costAmount === null || row.amount === 0
                              ? ""
                              : formatPercent(
                                  (row.amount - row.costAmount) / row.amount,
                                  1,
                                )}
                          </td>
                        </>
                      ) : null}

                      <td className="text-center">
                        <QbCheckbox
                          {...register(`lines.${index}.isTaxable`)}
                          aria-label={"Line " + (index + 1) + " taxable"}
                        />
                      </td>

                      <td className="text-center whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => clearLine(index)}
                          className="text-qb-xs text-qb-blue hover:underline px-[2px]"
                          title="Clear this line"
                        >
                          clr
                        </button>
                        <button
                          type="button"
                          onClick={() => removeLine(index)}
                          className="text-qb-xs text-qb-red hover:underline px-[2px]"
                          title="Delete this line"
                          aria-label={"Delete line " + (index + 1)}
                        >
                          del
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Per-line messages below the grid, where there is room to read */}
          {calc.rows.some((r) => !r.blank && (r.check.message || r.line.override)) ? (
            <div className="border-t border-qb-line bg-qb-chromeAlt px-2 py-1 space-y-[2px]">
              {calc.rows.map((r) => {
                if (r.blank) return null;
                const override = r.line.override;
                if (override) {
                  return (
                    <div key={r.key} className="text-qb-xs text-qb-amber">
                      <strong>Line {r.index + 1}:</strong> override pending for{" "}
                      {r.product?.sku} at {formatMoney(r.rate)} (min{" "}
                      {formatMoney(r.check.minimumPrice)}) &mdash; approver{" "}
                      {override.approverCode}, reason &ldquo;{override.reason}
                      &rdquo;. Verified on save.
                    </div>
                  );
                }
                if (r.check.status === "below_minimum") {
                  return (
                    <div key={r.key} className="text-qb-xs text-qb-red">
                      <strong>Line {r.index + 1}:</strong> {r.check.message}{" "}
                      Concession {formatMoney(r.check.concessionAmount)}.
                    </div>
                  );
                }
                return null;
              })}
            </div>
          ) : null}

          {/* ───────────────────────────────── footer: memo + totals */}
          <div
            className="border-t border-qb-line bg-qb-chromeAlt p-2
                       flex flex-wrap gap-4 justify-between items-start"
          >
            <div className="flex-1 min-w-[260px] space-y-1">
              <QbField label="Customer Message" labelWidth={100}>
                <QbInput
                  {...register("customerMessage")}
                  placeholder="Thank you for your business."
                  maxLength={500}
                />
              </QbField>
              <QbField label="Memo (internal)" labelWidth={100}>
                <QbInput
                  {...register("memo")}
                  placeholder="Not printed on the customer copy"
                  maxLength={500}
                />
              </QbField>
              <div className="text-qb-xs text-qb-inkMuted pt-1">
                {calc.liveCount} line{calc.liveCount === 1 ? "" : "s"}
                {" · "}
                {calc.manualCount} manual (no inventory effect)
                {" · "}
                {calc.stockedCount} stocked part
                {calc.stockedCount === 1 ? "" : "s"} will deduct inventory
              </div>
            </div>

            <table className="qb-grid w-[266px] shrink-0" aria-label="Invoice totals">
              <tbody>
                <tr>
                  <td className="font-bold">Subtotal</td>
                  <td className="qb-grid-num w-[96px]">{formatMoney(calc.subtotal)}</td>
                </tr>
                <tr>
                  <td>
                    Sales Tax
                    <span className="text-qb-inkMuted">
                      {" ("}
                      {formatPercent(taxRate, 3)}
                      {")"}
                    </span>
                  </td>
                  <td className="qb-grid-num">{formatMoney(calc.taxTotal)}</td>
                </tr>
                <tr className="bg-qb-gridSelect">
                  <td className="font-bold text-qb-md">Total</td>
                  <td className="qb-grid-num font-bold text-qb-md">
                    {formatMoney(calc.total)}
                  </td>
                </tr>
                <tr>
                  <td className="text-qb-inkMuted">Payments Applied</td>
                  <td className="qb-grid-num text-qb-inkMuted">0.00</td>
                </tr>
                <tr>
                  <td className="font-bold">Balance Due</td>
                  <td className="qb-grid-num font-bold">{formatMoney(calc.total)}</td>
                </tr>

                {/*
                  Margin block. Rendered only for roles with
                  inventory.view_cost; calc.costTotal is null otherwise, so
                  there is nothing to render even if this branch were forced.
                */}
                {canViewCost && calc.costTotal !== null ? (
                  <>
                    <tr>
                      <td colSpan={2} className="bg-qb-chromeDark h-[4px] p-0" />
                    </tr>
                    <tr>
                      <td className="text-qb-inkMuted">Total Cost</td>
                      <td className="qb-grid-num text-qb-inkMuted">
                        {formatMoney(calc.costTotal)}
                      </td>
                    </tr>
                    <tr>
                      <td className="font-bold">Gross Profit</td>
                      <td
                        className={cn(
                          "qb-grid-num font-bold",
                          (calc.grossProfit ?? 0) < 0 && "text-qb-red",
                        )}
                      >
                        {formatMoney(calc.grossProfit ?? 0)}
                      </td>
                    </tr>
                    <tr>
                      <td>Margin</td>
                      <td className="qb-grid-num">
                        {calc.subtotal > 0
                          ? formatPercent((calc.grossProfit ?? 0) / calc.subtotal, 1)
                          : "—"}
                      </td>
                    </tr>
                  </>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ───────────────────────────────────────────── bottom button row */}
      <div
        className="border-t border-qb-border bg-qb-chrome px-2 py-[6px]
                   flex items-center gap-1 flex-wrap qb-no-print"
      >
        <QbButton
          variant="primary"
          disabled={submitting}
          onClick={() => void submit(true, false)}
        >
          {submitting ? "Saving..." : "Save & Close"}
        </QbButton>
        <QbButton disabled={submitting} onClick={() => void submit(true, true)}>
          Save &amp; New
        </QbButton>
        <QbButton disabled={submitting} onClick={() => void submit(false, false)}>
          Save as Draft
        </QbButton>
        <QbButton onClick={resetAll}>Clear</QbButton>
        <QbButton onClick={() => router.push("/dashboard/invoices")}>Cancel</QbButton>

        <span className="ml-auto text-qb-xs text-qb-inkMuted" role="status">
          {statusMessage}
        </span>
      </div>

      {/* ─────────────────────────────────────────────────────── modals */}
      <CustomerLookupModal
        open={customerOpen}
        onClose={() => setCustomerOpen(false)}
        onSelect={onCustomerChosen}
      />

      <ItemLookupModal
        open={itemLookup !== null}
        onClose={() => setItemLookup(null)}
        canViewCost={canViewCost}
        onSelect={(item) => {
          if (itemLookup) applyItem(itemLookup.index, item);
        }}
      />

      <PriceOverrideModal
        open={overrideCtx !== null}
        context={overrideCtx}
        onClose={() => setOverrideCtx(null)}
        onApprove={attachOverride}
        selfApproveLabel={
          canApproveOverride
            ? currentUser.fullName + " (" + currentUser.employeeCode + ")"
            : null
        }
      />
    </form>
  );
}
