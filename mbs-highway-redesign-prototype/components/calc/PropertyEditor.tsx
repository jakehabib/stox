'use client';

import { Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button, Field, NumberInput, RadioGroup, Segmented, Switch } from '@/components/ui';
import { getLocation } from '@/data/mock/locations';
import { displayedRate, type AppreciationMode } from '@/lib/calculations/appreciation';
import { countyTaxAnnual, taxRatePct, type PropertyInput } from '@/lib/calculations/property';
import { pct, usd } from '@/lib/format';
import { LocationPicker } from './LocationPicker';

/**
 * Shared property editor (Loan Comparison, Purchase Analysis, Cost of Waiting, Buy vs Rent,
 * Appreciation, Equity Gained). Controlled: pass the PropertyInput and an onChange.
 */
export function PropertyEditor({
  value,
  onChange,
  showAppreciation = true,
  showAlternates = true,
  showHoa = true,
  compact = false,
}: {
  value: PropertyInput;
  onChange: (p: PropertyInput) => void;
  showAppreciation?: boolean;
  showAlternates?: boolean;
  showHoa?: boolean;
  compact?: boolean;
}) {
  const loc = getLocation(value.locationId);
  const [taxPeriod, setTaxPeriod] = useState<'monthly' | 'annual'>('annual');
  const [taxUnit, setTaxUnit] = useState<'fee' | 'percentage'>('fee');
  const set = (patch: Partial<PropertyInput>) => onChange({ ...value, ...patch });

  const countyTax = countyTaxAnnual(value.locationId, value.price);
  const taxIsDefault = Math.abs(value.taxAnnual - countyTax) < 1;
  const insIsDefault = value.insuranceMonthly === loc.insuranceMonthly;

  const taxDisplay = taxUnit === 'percentage' ? taxRatePct(value) : taxPeriod === 'monthly' ? value.taxAnnual / 12 : value.taxAnnual;
  const setTax = (v: number) => {
    let annual = v;
    if (taxUnit === 'percentage') annual = (value.price * v) / 100;
    else if (taxPeriod === 'monthly') annual = v * 12;
    set({ taxAnnual: Math.round(annual * 100) / 100 });
  };

  return (
    <div className="space-y-5">
      <div className={compact ? 'grid gap-4' : 'grid gap-4 md:grid-cols-2'}>
        <LocationPicker
          value={value.locationId}
          onChange={(id) => {
            const l = getLocation(id);
            set({ locationId: id, taxAnnual: countyTaxAnnual(id, value.price), insuranceMonthly: l.insuranceMonthly });
          }}
        />
        <Field label="Price">
          <NumberInput
            ariaLabel="Price"
            prefix="$"
            decimals={0}
            value={value.price}
            onChange={(price) =>
              set({
                price,
                appraisedValue: value.useAppraised ? value.appraisedValue : price,
                taxAnnual: taxIsDefault ? countyTaxAnnual(value.locationId, price) : value.taxAnnual,
              })
            }
          />
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <Switch checked={value.useAppraised} onChange={(useAppraised) => set({ useAppraised, appraisedValue: useAppraised ? value.appraisedValue || value.price : value.price })} label="Appraised value differs from price" />
        {value.useAppraised && (
          <div className="w-48">
            <NumberInput ariaLabel="Appraised Value" prefix="$" decimals={0} value={value.appraisedValue} onChange={(appraisedValue) => set({ appraisedValue })} />
          </div>
        )}
      </div>

      <div className={compact ? 'grid gap-4' : 'grid gap-4 md:grid-cols-3'}>
        <Field
          label="Property Tax"
          hint={taxIsDefault ? `County average ${pct(loc.taxRatePct, 2)} · ${loc.county}` : `${usd(value.taxAnnual)}/yr · ${pct(taxRatePct(value), 2)} of price`}
          right={
            !taxIsDefault && (
              <button type="button" onClick={() => set({ taxAnnual: countyTax })} className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">
                <RotateCcw className="h-3 w-3" /> Reset to county average
              </button>
            )
          }
        >
          <div className="flex flex-col gap-2">
            <NumberInput ariaLabel="Property Tax" prefix={taxUnit === 'fee' ? '$' : undefined} suffix={taxUnit === 'percentage' ? '%' : taxPeriod === 'monthly' ? '/mo' : '/yr'} decimals={taxUnit === 'percentage' ? 3 : 2} value={taxDisplay} onChange={setTax} />
            <div className="flex flex-wrap gap-2">
              <Segmented size="sm" ariaLabel="Tax period" value={taxPeriod} onChange={setTaxPeriod} options={[{ value: 'monthly', label: 'Monthly' }, { value: 'annual', label: 'Annual' }]} />
              <Segmented size="sm" ariaLabel="Tax unit" value={taxUnit} onChange={setTaxUnit} options={[{ value: 'fee', label: '$ Fee' }, { value: 'percentage', label: '% Percentage' }]} />
            </div>
          </div>
        </Field>
        <Field
          label="Monthly Home Insurance"
          hint={insIsDefault ? `Default for ${loc.city}` : undefined}
          right={
            !insIsDefault && (
              <button type="button" onClick={() => set({ insuranceMonthly: loc.insuranceMonthly })} className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">
                <RotateCcw className="h-3 w-3" /> Reset to default
              </button>
            )
          }
        >
          <NumberInput ariaLabel="Monthly Home Insurance" prefix="$" suffix="/mo" decimals={2} value={value.insuranceMonthly} onChange={(insuranceMonthly) => set({ insuranceMonthly })} />
        </Field>
        {showHoa && (
          <Field label="Monthly Association Fee">
            <NumberInput ariaLabel="Monthly Association Fee" prefix="$" suffix="/mo" decimals={2} value={value.hoaMonthly} onChange={(hoaMonthly) => set({ hoaMonthly })} />
          </Field>
        )}
      </div>

      {showAppreciation && (
        <Field label="Appreciation">
          <div className="flex flex-wrap items-center gap-3">
            <RadioGroup<AppreciationMode>
              value={value.appreciation.mode}
              onChange={(mode) => set({ appreciation: { ...value.appreciation, mode, customPct: value.appreciation.customPct ?? 4 } })}
              options={[
                { value: 'forecast', label: 'Forecast', hint: pct(loc.forecastDisplayPct, 3) },
                { value: 'historical', label: 'Historical', hint: pct(loc.historicalPct, 3) },
                { value: 'custom', label: 'Custom' },
              ]}
            />
            {value.appreciation.mode === 'custom' && (
              <div className="w-32">
                <NumberInput ariaLabel="Custom appreciation" suffix="%/yr" decimals={3} value={value.appreciation.customPct ?? 4} onChange={(customPct) => set({ appreciation: { mode: 'custom', customPct } })} />
              </div>
            )}
          </div>
          <p className="mt-1 text-xs text-slate-500">Using {pct(displayedRate(loc, value.appreciation), 3)} per year · Demo forecast data</p>
        </Field>
      )}

      {showAlternates && (
        <div className="space-y-3">
          {value.alternatePrices.map((p, i) => (
            <div key={i} className="flex items-end gap-2">
              <Field label={`Alternate price ${i + 1}`} className="w-56">
                <NumberInput ariaLabel={`Alternate price ${i + 1}`} prefix="$" decimals={0} value={p} onChange={(v) => set({ alternatePrices: value.alternatePrices.map((x, j) => (j === i ? v : x)) })} />
              </Field>
              <Button variant="ghost" size="sm" aria-label="Remove alternate price" onClick={() => set({ alternatePrices: value.alternatePrices.filter((_, j) => j !== i) })}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          {value.extraLocationIds.map((id, i) => (
            <div key={`l${i}`} className="flex items-end gap-2">
              <div className="w-72">
                <LocationPicker label={`Additional location ${i + 1}`} value={id} onChange={(nid) => set({ extraLocationIds: value.extraLocationIds.map((x, j) => (j === i ? nid : x)) })} />
              </div>
              <Button variant="ghost" size="sm" aria-label="Remove location" onClick={() => set({ extraLocationIds: value.extraLocationIds.filter((_, j) => j !== i) })}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button variant="subtle" size="sm" icon={<Plus className="h-4 w-4" />} disabled={value.alternatePrices.length >= 2} onClick={() => set({ alternatePrices: [...value.alternatePrices, Math.round(value.price * 0.95)] })}>
              Add alternate price
            </Button>
            <Button variant="subtle" size="sm" icon={<Plus className="h-4 w-4" />} disabled={value.extraLocationIds.length >= 2} onClick={() => set({ extraLocationIds: [...value.extraLocationIds, 'marlboro-nj-07746'] })}>
              Add new location
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
