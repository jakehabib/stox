'use client';

import { useState } from 'react';
import { TeamLogo } from './TeamLogo';
import { generateTeamLogoParams } from '@/lib/gen/teamLogo';

interface Seed { city: string; nickname: string; abbr: string; conference: string; division: string }

/**
 * League setup as a two-step choice rather than a stack of dropdowns.
 *
 * Picking your franchise is the single most consequential decision on this
 * screen — it's the identity you live with for a whole dynasty — so it gets a
 * real browsable list with crests and divisions instead of being buried as
 * one <select> among four. The settings beside it use segmented controls so
 * every option is visible and comparable without opening anything.
 *
 * Deliberately NOT shown: a projected team strength. Rosters don't exist
 * until the league is generated, so before that every franchise is
 * statistically identical — a strength number here would be invented.
 */
export function CreateLeagueForm({ seeds, action }: { seeds: Seed[]; action: (fd: FormData) => void }) {
  const [picked, setPicked] = useState(seeds[0]?.abbr ?? '');
  const [conf, setConf] = useState<'ALL' | 'AFC' | 'NFC'>('ALL');

  const visible = conf === 'ALL' ? seeds : seeds.filter((s) => s.conference === conf);
  const pickedSeed = seeds.find((s) => s.abbr === picked);

  return (
    <form action={action} className="grid lg:grid-cols-[1.3fr_1fr] gap-5 items-start">
      <input type="hidden" name="userTeamAbbr" value={picked} />

      {/* Step 1 — franchise */}
      <div className="panel overflow-hidden">
        <div className="px-5 py-4 border-b border-line/70 flex items-end justify-between gap-3 flex-wrap">
          <div>
            <div className="label-sm">Step 1 of 2</div>
            <h3 className="font-display font-extrabold text-2xl uppercase tracking-wide leading-none mt-1">
              Choose Your Franchise
            </h3>
          </div>
          <Segmented
            value={conf}
            onChange={(v) => setConf(v as typeof conf)}
            options={[['ALL', 'All'], ['AFC', 'AFC'], ['NFC', 'NFC']]}
          />
        </div>

        <div className="max-h-[26rem] overflow-y-auto divide-y divide-line/50">
          {visible.map((s) => {
            const active = s.abbr === picked;
            const accent = generateTeamLogoParams(`preview-${s.abbr}`).primary;
            return (
              <button
                key={s.abbr}
                type="button"
                onClick={() => setPicked(s.abbr)}
                aria-pressed={active}
                className={`w-full text-left flex items-center gap-3.5 px-5 py-3 border-l-2 transition-colors ${
                  active ? 'bg-raised/70' : 'border-l-transparent hover:bg-raised/40'
                }`}
                style={active ? { borderLeftColor: accent } : undefined}
              >
                <TeamLogo seed={`preview-${s.abbr}`} abbr={s.abbr} size={38} className="shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="label-sm truncate">{s.city}</div>
                  <div className="font-display font-bold text-lg uppercase tracking-wide leading-none mt-0.5 truncate">
                    {s.nickname}
                  </div>
                </div>
                <span className="label-sm shrink-0">{s.conference} {s.division}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Step 2 — rules */}
      <div className="panel p-5 space-y-5">
        <div>
          <div className="label-sm">Step 2 of 2</div>
          <h3 className="font-display font-extrabold text-2xl uppercase tracking-wide leading-none mt-1">League Setup</h3>
          {pickedSeed && (
            <p className="text-muted text-sm mt-2">
              Running the <span className="text-chalk font-medium">{pickedSeed.city} {pickedSeed.nickname}</span> in a
              32-team league generated from scratch — no real NFL data.
            </p>
          )}
        </div>

        <div>
          <label className="label-sm block mb-1.5">League name</label>
          <input name="name" className="input w-full" placeholder="My League" defaultValue="Founders League" required />
        </div>

        <Field label="Starting situation" name="leagueStart" options={[
          ['RANDOM_ROSTERS', 'Randomized rosters'],
          ['FANTASY_DRAFT', 'Fantasy draft'],
        ]} />
        <Field label="Salary cap" name="capMode" options={[
          ['OFF', 'Off'], ['SIMPLIFIED', 'Simplified'], ['REALISTIC', 'Realistic'],
        ]} defaultValue="REALISTIC" />
        <Field label="Difficulty" name="difficulty" options={[
          ['ROOKIE', 'Rookie'], ['PRO', 'Pro'], ['ALL_PRO', 'All-Pro'], ['LEGEND', 'Legend'],
        ]} defaultValue="PRO" />

        <button type="submit" className="btn-primary w-full">Start Dynasty ▸</button>
      </div>
    </form>
  );
}

/** Segmented control backed by a hidden input, so it still posts as form data. */
function Field({ label, name, options, defaultValue }: {
  label: string; name: string; options: [string, string][]; defaultValue?: string;
}) {
  const [value, setValue] = useState(defaultValue ?? options[0][0]);
  return (
    <div>
      <label className="label-sm block mb-1.5">{label}</label>
      <input type="hidden" name={name} value={value} />
      <Segmented value={value} onChange={setValue} options={options} full />
    </div>
  );
}

function Segmented({ value, onChange, options, full }: {
  value: string; onChange: (v: string) => void; options: [string, string][]; full?: boolean;
}) {
  return (
    <div className={`inline-flex rounded-md border border-line overflow-hidden ${full ? 'w-full' : ''}`}>
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          aria-pressed={v === value}
          className={`px-3 py-1.5 text-xs whitespace-nowrap border-r border-line last:border-r-0 transition-colors ${
            full ? 'flex-1' : ''
          } ${v === value ? 'bg-raised text-chalk font-semibold' : 'text-muted hover:text-chalk'}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
