'use client';

import { Download } from 'lucide-react';
import { useMemo } from 'react';
import { Button, DataTable, Modal } from '@/components/ui';
import { amortizationByYear, loanAmountOf, type LoanOption } from '@/lib/calculations/loanCompare';
import { downloadCsv } from '@/lib/exportCsv';
import { pct, usd } from '@/lib/format';

/** Yearly amortization schedule for one loan option, with CSV export. */
export function AmortizationModal({ open, onClose, option, label, price, holdingYears }: { open: boolean; onClose: () => void; option: LoanOption | null; label: string; price: number; holdingYears?: number }) {
  const rows = useMemo(() => (option ? amortizationByYear(price, option) : []), [option, price]);
  if (!option) return null;
  const loan = loanAmountOf(price, option);
  const totals = rows.reduce((a, r) => ({ payment: a.payment + r.payment, principal: a.principal + r.principal, interest: a.interest + r.interest }), { payment: 0, principal: 0, interest: 0 });
  const exportCsv = () =>
    downloadCsv(`amortization-${label.toLowerCase().replace(/\s+/g, '-')}.csv`, [
      ['Year', 'Payments', 'Principal', 'Interest', 'Cumulative interest', 'Balance'],
      ...rows.map((r) => [r.year, r.payment, r.principal, r.interest, r.cumulativeInterest, r.balance]),
    ]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={`Amortization — ${label}`}
      description={`${usd(loan)} · ${option.termYears}-yr ${option.loanType} · ${pct(option.ratePct, 3)} · P&I ${usd(rows[0]?.monthly ?? 0, { cents: true })}/mo`}
      footer={
        <>
          <Button variant="secondary" icon={<Download className="h-4 w-4" />} onClick={exportCsv}>
            Export CSV
          </Button>
          <Button onClick={onClose}>Done</Button>
        </>
      }
    >
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">No loan amount — nothing to amortize.</p>
      ) : (
        <DataTable
          dense
          head={['Year', 'Payments', 'Principal', 'Interest', 'Cumulative interest', 'Balance']}
          rows={rows.map((r) => [
            <span key="y" className={holdingYears === r.year ? 'font-semibold text-brand-700' : undefined}>
              {r.year}
              {holdingYears === r.year && <span className="ml-1 text-[10px] font-semibold uppercase">hold</span>}
            </span>,
            usd(r.payment),
            usd(r.principal),
            usd(r.interest),
            usd(r.cumulativeInterest),
            usd(r.balance),
          ])}
          footer={['Total', usd(totals.payment), usd(totals.principal), usd(totals.interest), '', '']}
        />
      )}
    </Modal>
  );
}
