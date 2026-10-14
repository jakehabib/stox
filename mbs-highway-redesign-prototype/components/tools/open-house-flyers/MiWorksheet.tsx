'use client';

import clsx from 'clsx';
import { Button, Field, Modal, Select } from '@/components/ui';
import { MI_FICO_BANDS, MI_LTV_BANDS, MI_RATES, miLtvBandIndex, type MiFicoBand } from '@/lib/calculations/flyer';
import { pct, usd } from '@/lib/format';

export interface MiRow {
  label: string;
  ltv: number;
  loan: number;
  /** Monthly MI already computed by the calc layer. */
  mi: number;
  ratePct: number;
  note?: string;
}

/** MI Worksheet: borrower-paid monthly MI by LTV × FICO, with the current scenarios highlighted. Shared by Open House Flyers + Seller Contribution. */
export function MiWorksheet({ open, onClose, fico, onFico, rows }: { open: boolean; onClose: () => void; fico: MiFicoBand; onFico: (f: MiFicoBand) => void; rows: MiRow[] }) {
  const active = new Set(rows.map((r) => miLtvBandIndex(r.ltv)));
  return (
    <Modal open={open} onClose={onClose} title="MI Worksheet" description="Annual mortgage insurance rate (% of loan) by LTV and credit score. Demo rate card." size="xl" footer={<Button onClick={onClose}>Done</Button>}>
      <div className="mb-4 flex flex-wrap items-end gap-4">
        <Field label="Credit score (FICO)" className="w-48">
          <Select value={fico} onChange={onFico} options={MI_FICO_BANDS} ariaLabel="FICO band" />
        </Field>
        <p className="pb-2 text-xs text-slate-500">No MI at 80% LTV or below. FHA uses its own MIP (shown in the scenario list).</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-max text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs text-slate-500">
              <th className="px-3 py-2 text-left font-semibold">FICO</th>
              {MI_LTV_BANDS.map((b, i) => (
                <th key={b.label} className={clsx('px-3 py-2 text-right font-semibold', active.has(i) && 'text-brand-700')}>
                  {b.label} LTV
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MI_FICO_BANDS.map((f) => (
              <tr key={f} className={clsx('border-b border-slate-100', f === fico && 'bg-brand-50/60')}>
                <td className={clsx('px-3 py-2 font-medium', f === fico ? 'text-brand-800' : 'text-slate-700')}>{f}</td>
                {MI_RATES[f].map((r, i) => (
                  <td key={i} className={clsx('px-3 py-2 text-right tabular-nums', f === fico && active.has(i) ? 'font-bold text-brand-700' : 'text-slate-700')}>
                    {pct(r, 2, { trim: false })}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 0 && (
        <div className="mt-5">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Your scenarios</div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-max text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-500">
                  <th className="px-3 py-2 text-left font-semibold">Scenario</th>
                  <th className="px-3 py-2 text-right font-semibold">Loan</th>
                  <th className="px-3 py-2 text-right font-semibold">LTV</th>
                  <th className="px-3 py-2 text-right font-semibold">MI rate</th>
                  <th className="px-3 py-2 text-right font-semibold">MI / month</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.label} className="border-b border-slate-100 last:border-0">
                    <td className="px-3 py-2 font-medium text-slate-800">
                      {r.label}
                      {r.note && <span className="ml-1 text-xs font-normal text-slate-500">{r.note}</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{usd(r.loan)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{pct(r.ltv, 2)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.ratePct > 0 ? pct(r.ratePct, 2, { trim: false }) : 'None'}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{usd(r.mi, { cents: true })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}
