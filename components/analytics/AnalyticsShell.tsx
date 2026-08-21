'use client';

import { useState } from 'react';

export type EraScope = 'franchise' | 'tenure';
export type UnitScope = 'all' | 'OFF' | 'DEF';

/**
 * One filter row, above everything it scopes — not a control per card.
 *
 * All three switches are pure display state, so none of them refetches: the
 * server has already rendered both eras of the luck ledger and all nine units
 * of the flagship scatter, and these flip which of them is visible. That is
 * deliberate rather than lazy. A filter that greys the excluded units keeps
 * every unit its own colour (colour follows the entity, never the current
 * selection), and a table twin that is already in the DOM is a table twin that
 * a screen reader and a Ctrl-F both find whether or not the switch is on.
 */
export function AnalyticsShell({ showEra, children }: {
  /** Hidden when the club has no pre-history — one option is not a choice. */
  showEra: boolean;
  children: React.ReactNode;
}) {
  const [era, setEra] = useState<EraScope>('franchise');
  const [units, setUnits] = useState<UnitScope>('all');
  const [numbers, setNumbers] = useState(false);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2.5 mt-4">
        {showEra && (
          <Segmented
            label="Seasons on the ledger"
            value={era}
            onChange={(v) => setEra(v as EraScope)}
            options={[{ v: 'franchise', l: 'Franchise' }, { v: 'tenure', l: 'Your tenure' }]}
          />
        )}
        <Segmented
          label="Units in view"
          value={units}
          onChange={(v) => setUnits(v as UnitScope)}
          options={[{ v: 'all', l: 'All units' }, { v: 'OFF', l: 'Offense' }, { v: 'DEF', l: 'Defense' }]}
        />
        <label className="ml-auto inline-flex items-center gap-2 text-[12.5px] text-muted cursor-pointer select-none">
          <input
            type="checkbox"
            className="appearance-none w-[34px] h-[19px] rounded-full bg-raised border border-line relative cursor-pointer
                       after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:w-[13px] after:h-[13px]
                       after:rounded-full after:bg-muted after:transition-transform
                       checked:bg-accent/30 checked:after:translate-x-[15px] checked:after:bg-accent"
            checked={numbers}
            onChange={(e) => setNumbers(e.target.checked)}
          />
          Show the numbers behind every chart
        </label>
      </div>

      <div
        // items-start: a five-column card next to a tall seven-column one
        // ends where its content ends rather than stretching into a void.
        className="group/an grid grid-cols-12 items-start gap-4 mt-4"
        data-era={era}
        data-units={units}
        data-numbers={numbers ? 'on' : 'off'}
      >
        {children}
      </div>
    </>
  );
}

function Segmented({ label, value, onChange, options }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { v: string; l: string }[];
}) {
  return (
    <div className="inline-flex bg-raised border border-line rounded-lg p-0.5" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          aria-pressed={value === o.v}
          onClick={() => onChange(o.v)}
          className={`text-[12.5px] px-3 py-1 rounded-md transition-colors ${
            value === o.v ? 'bg-accent2/[0.18] text-accent2' : 'text-muted hover:text-chalk'
          }`}
        >
          {o.l}
        </button>
      ))}
    </div>
  );
}
