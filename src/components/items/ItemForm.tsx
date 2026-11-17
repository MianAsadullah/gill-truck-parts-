"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { saveProduct } from "@/server/actions/items";
import { productFormSchema, type ProductFormValues } from "@/lib/validation/items";
import { formatMoney, formatPercent, marginPct } from "@/lib/money";
import { CROSS_REF_LABELS } from "@/lib/part-number";
import {
  QbButton,
  QbField,
  QbInput,
  QbSelect,
  QbCheckbox,
  QbBanner,
  QbFieldset,
  QbRibbon,
  QbRibbonTab,
} from "@/components/qb/Ui";

/**
 * New / Edit Item (INV).
 *
 * The cost block is rendered only when the signed-in role may see cost. Note
 * that average cost is shown read-only even to privileged users: it is
 * derived from receipts, and letting someone type over it would silently
 * break the relationship between inventory value and what was actually paid.
 * Standard cost — the budgeted figure — is editable, because it is an input
 * rather than a result.
 */

const XREF_TYPES = ["OEM", "ALTERNATE", "INTERCHANGE", "SUPERSEDED", "VENDOR_PART"] as const;

const asNumber = (raw: unknown): number => {
  if (raw === "" || raw === null || raw === undefined) return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
};

export interface ItemFormOption {
  id: string;
  name: string;
}

export function ItemForm({
  initial,
  categories,
  brands,
  vendors,
  canViewCost,
  currentAverageCost,
  onHand,
}: {
  initial: ProductFormValues;
  categories: ItemFormOption[];
  brands: ItemFormOption[];
  vendors: ItemFormOption[];
  canViewCost: boolean;
  currentAverageCost: number | null;
  onHand: number;
}) {
  const router = useRouter();
  const [formError, setFormError] = React.useState<string | null>(null);
  const [savedMsg, setSavedMsg] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const {
    register,
    control,
    getValues,
    watch,
    setError,
    formState: { errors },
  } = useForm<ProductFormValues>({
    resolver: zodResolver(productFormSchema),
    mode: "onSubmit",
    defaultValues: initial,
  });

  const { fields, append, remove } = useFieldArray({ control, name: "crossReferences" });

  const standardPrice = watch("standardPrice");
  const minimumPrice = watch("minimumPrice");
  const type = watch("type");

  const floorAboveList =
    asNumber(minimumPrice) > asNumber(standardPrice) && asNumber(standardPrice) > 0;

  const previewMargin =
    canViewCost && currentAverageCost !== null
      ? marginPct(asNumber(standardPrice), currentAverageCost)
      : null;
  const floorMargin =
    canViewCost && currentAverageCost !== null
      ? marginPct(asNumber(minimumPrice), currentAverageCost)
      : null;

  async function submit() {
    setFormError(null);
    setSavedMsg(null);
    const values = getValues();

    setSubmitting(true);
    try {
      const result = await saveProduct({
        ...values,
        standardPrice: asNumber(values.standardPrice),
        minimumPrice: asNumber(values.minimumPrice),
        standardCost: values.standardCost === null ? null : asNumber(values.standardCost),
        averageCost: null,
        reorderPoint: asNumber(values.reorderPoint),
        reorderQuantity: asNumber(values.reorderQuantity),
        coreCharge: asNumber(values.coreCharge),
      });

      if (!result.ok) {
        setFormError(result.error);
        if (result.fieldErrors) {
          for (const [path, message] of Object.entries(result.fieldErrors)) {
            if (path === "sku" || path === "minimumPrice" || path === "standardPrice") {
              setError(path as "sku", { message });
            }
          }
        }
        return;
      }

      setSavedMsg(
        "Item " + result.data.sku + (result.data.created ? " created." : " updated."),
      );
      if (result.data.created) {
        router.push("/dashboard/items/" + result.data.id);
      } else {
        router.refresh();
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "The item could not be saved.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="qb-window flex flex-col"
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") e.preventDefault();
      }}
    >
      <div className="qb-window-title qb-no-print">
        <span>{initial.id ? "Edit Item" : "New Item"}</span>
        <span className="font-normal text-white/80 text-qb">{initial.sku || "—"}</span>
      </div>

      <QbRibbon>
        <QbRibbonTab active>Item</QbRibbonTab>
        <QbRibbonTab>Cross-References</QbRibbonTab>
      </QbRibbon>

      <div className="px-2 pt-2 space-y-1 empty:hidden">
        {savedMsg ? <QbBanner variant="ok">{savedMsg}</QbBanner> : null}
        {formError ? (
          <QbBanner variant="err" onDismiss={() => setFormError(null)}>
            {formError}
          </QbBanner>
        ) : null}
        {floorAboveList ? (
          <QbBanner variant="err" title="Minimum is above list">
            Every sale of this part would require a manager override. Lower the minimum or
            raise the list price.
          </QbBanner>
        ) : null}
      </div>

      <div className="p-2 grid grid-cols-1 lg:grid-cols-2 gap-2 items-start">
        <QbFieldset legend="Identification" className="space-y-1">
          <QbField label="Item / SKU" htmlFor="sku" labelWidth={92} required error={errors.sku?.message}>
            <QbInput
              id="sku"
              {...register("sku")}
              className="max-w-[200px] font-qbMono uppercase"
              invalid={!!errors.sku}
            />
          </QbField>
          <QbField label="Type" htmlFor="type" labelWidth={92} required>
            <QbSelect id="type" {...register("type")} className="max-w-[200px]">
              <option value="INVENTORY">Inventory Part</option>
              <option value="NON_INVENTORY">Non-Inventory Part</option>
              <option value="SERVICE">Service / Labor</option>
              <option value="OTHER_CHARGE">Other Charge</option>
            </QbSelect>
          </QbField>
          <QbField
            label="Description"
            htmlFor="description"
            labelWidth={92}
            required
            error={errors.description?.message}
          >
            <QbInput id="description" {...register("description")} maxLength={300} />
          </QbField>
          <QbField label="Long Text" htmlFor="longDescription" labelWidth={92}>
            <QbInput id="longDescription" {...register("longDescription")} maxLength={1000} />
          </QbField>
          <QbField label="Category" htmlFor="categoryId" labelWidth={92}>
            <QbSelect id="categoryId" {...register("categoryId")} className="max-w-[220px]">
              <option value="">-- none --</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </QbSelect>
          </QbField>
          <QbField label="Brand" htmlFor="brandId" labelWidth={92}>
            <QbSelect id="brandId" {...register("brandId")} className="max-w-[220px]">
              <option value="">-- none --</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </QbSelect>
          </QbField>
          <QbField label="U/M" htmlFor="unitOfMeasure" labelWidth={92}>
            <QbInput id="unitOfMeasure" {...register("unitOfMeasure")} className="max-w-[80px] uppercase" />
          </QbField>
          <QbField label="Barcode" htmlFor="barcode" labelWidth={92}>
            <QbInput id="barcode" {...register("barcode")} className="max-w-[200px] font-qbMono" />
          </QbField>
          <QbField label="Bin" htmlFor="binLocation" labelWidth={92}>
            <QbInput id="binLocation" {...register("binLocation")} className="max-w-[110px]" />
          </QbField>
          <label className="flex items-center gap-2 text-qb pl-[100px]">
            <QbCheckbox {...register("isActive")} /> Active
          </label>
          <label className="flex items-center gap-2 text-qb pl-[100px]">
            <QbCheckbox {...register("isTaxable")} /> Taxable
          </label>
        </QbFieldset>

        <div className="space-y-2">
          <QbFieldset legend="Pricing" className="space-y-1">
            <QbField
              label="List Price"
              htmlFor="standardPrice"
              labelWidth={92}
              error={errors.standardPrice?.message}
            >
              <QbInput
                id="standardPrice"
                type="number"
                step="0.01"
                numeric
                {...register("standardPrice", { setValueAs: asNumber })}
                className="max-w-[120px]"
              />
            </QbField>
            <QbField
              label="Minimum"
              htmlFor="minimumPrice"
              labelWidth={92}
              error={errors.minimumPrice?.message}
              hint="The floor. Selling below this needs a manager override."
            >
              <QbInput
                id="minimumPrice"
                type="number"
                step="0.01"
                numeric
                invalid={floorAboveList}
                {...register("minimumPrice", { setValueAs: asNumber })}
                className="max-w-[120px]"
              />
            </QbField>
            <QbField label="Core Charge" htmlFor="coreCharge" labelWidth={92}>
              <QbInput
                id="coreCharge"
                type="number"
                step="0.01"
                numeric
                {...register("coreCharge", { setValueAs: asNumber })}
                className="max-w-[120px]"
              />
            </QbField>

            {canViewCost && currentAverageCost !== null ? (
              <table className="qb-grid mt-1">
                <tbody>
                  <tr>
                    <td className="w-[150px]">Average cost</td>
                    <td className="qb-grid-num">{formatMoney(currentAverageCost)}</td>
                  </tr>
                  <tr>
                    <td>Margin at list</td>
                    <td className="qb-grid-num">
                      {previewMargin === null ? "—" : formatPercent(previewMargin, 1)}
                    </td>
                  </tr>
                  <tr className={floorMargin !== null && floorMargin < 0 ? "bg-qb-errBg" : ""}>
                    <td>Margin at minimum</td>
                    <td className="qb-grid-num">
                      {floorMargin === null ? "—" : formatPercent(floorMargin, 1)}
                      {floorMargin !== null && floorMargin < 0 ? (
                        <span className="text-qb-red font-bold"> below cost</span>
                      ) : null}
                    </td>
                  </tr>
                </tbody>
              </table>
            ) : null}
          </QbFieldset>

          {canViewCost ? (
            <QbFieldset legend="Cost & Purchasing" className="space-y-1">
              <QbField
                label="Standard Cost"
                htmlFor="standardCost"
                labelWidth={100}
                hint="Budgeted cost. Average cost is derived from receipts and is not editable."
              >
                <QbInput
                  id="standardCost"
                  type="number"
                  step="0.0001"
                  numeric
                  {...register("standardCost", { setValueAs: asNumber })}
                  className="max-w-[120px]"
                />
              </QbField>
              <QbField label="Preferred Vendor" htmlFor="preferredVendorId" labelWidth={100}>
                <QbSelect
                  id="preferredVendorId"
                  {...register("preferredVendorId")}
                  className="max-w-[220px]"
                >
                  <option value="">-- none --</option>
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </QbSelect>
              </QbField>
            </QbFieldset>
          ) : null}

          {type === "INVENTORY" ? (
            <QbFieldset legend="Stock" className="space-y-1">
              <div className="text-qb pb-1">
                On hand: <strong>{onHand}</strong>{" "}
                <span className="text-qb-inkMuted">
                  (changed by receiving and by quantity adjustments, not here)
                </span>
              </div>
              <QbField label="Reorder Point" htmlFor="reorderPoint" labelWidth={110}>
                <QbInput
                  id="reorderPoint"
                  type="number"
                  step="1"
                  numeric
                  {...register("reorderPoint", { setValueAs: asNumber })}
                  className="max-w-[90px]"
                />
              </QbField>
              <QbField label="Reorder Qty" htmlFor="reorderQuantity" labelWidth={110}>
                <QbInput
                  id="reorderQuantity"
                  type="number"
                  step="1"
                  numeric
                  {...register("reorderQuantity", { setValueAs: asNumber })}
                  className="max-w-[90px]"
                />
              </QbField>
            </QbFieldset>
          ) : null}
        </div>

        <div className="lg:col-span-2">
          <QbFieldset legend="OEM / Interchange Cross-References">
            <div className="text-qb-xs text-qb-inkMuted pb-1">
              These are what counter staff actually type. Punctuation and case are ignored
              on lookup, so &ldquo;RE-50749&rdquo; and &ldquo;re50749&rdquo; both find this part.
            </div>
            <table className="qb-grid bg-white">
              <thead>
                <tr>
                  <th style={{ width: 130 }}>Type</th>
                  <th style={{ width: 200 }}>Number</th>
                  <th>Manufacturer</th>
                  <th style={{ width: 40 }}>&nbsp;</th>
                </tr>
              </thead>
              <tbody>
                {fields.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="text-qb-inkMuted text-center">
                      No cross-references yet.
                    </td>
                  </tr>
                ) : null}
                {fields.map((field, index) => (
                  <tr key={field.id}>
                    <td className="p-0">
                      <select
                        className="qb-cell-input"
                        {...register(`crossReferences.${index}.type`)}
                        aria-label={"Cross reference " + (index + 1) + " type"}
                      >
                        {XREF_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {CROSS_REF_LABELS[t] ?? t}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="p-0">
                      <input
                        className="qb-cell-input font-qbMono"
                        {...register(`crossReferences.${index}.number`)}
                        aria-label={"Cross reference " + (index + 1) + " number"}
                      />
                    </td>
                    <td className="p-0">
                      <input
                        className="qb-cell-input"
                        {...register(`crossReferences.${index}.manufacturer`)}
                        aria-label={"Cross reference " + (index + 1) + " manufacturer"}
                      />
                    </td>
                    <td className="text-center">
                      <button
                        type="button"
                        onClick={() => remove(index)}
                        className="text-qb-xs text-qb-red hover:underline"
                      >
                        del
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <QbButton
              size="sm"
              className="mt-1"
              onClick={() => append({ type: "OEM", number: "", manufacturer: null })}
            >
              + Cross-Reference
            </QbButton>
          </QbFieldset>
        </div>
      </div>

      <div className="border-t border-qb-border bg-qb-chrome px-2 py-[6px] flex items-center gap-1 qb-no-print">
        <QbButton variant="primary" disabled={submitting} onClick={() => void submit()}>
          {submitting ? "Saving..." : "Save"}
        </QbButton>
        <QbButton onClick={() => router.push("/dashboard/items")}>Close</QbButton>
      </div>
    </form>
  );
}
