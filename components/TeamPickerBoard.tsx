'use client';

import { TeamLogo } from './TeamLogo';
import { previewAccent, previewCrestSeed, type FranchiseSeed } from './ds/FranchiseWall';

const CONFERENCES = ['AFC', 'NFC'] as const;
const DIVISIONS = ['East', 'North', 'South', 'West'] as const;

/**
 * The franchise board: all 32 clubs, laid out as the league actually is.
 *
 * This replaces a 32-item `<select>` of three-letter abbreviations. Picking a
 * franchise is the one irreversible decision on this screen and the only one
 * a player has any feeling about, so it gets the crest, the city, the
 * nickname and the division — the whole identity — rather than "PHX".
 *
 * Grouped by conference and division rather than laid out as a flat grid of
 * 32, because "who am I going to have to beat twice a year" is the second
 * question anyone asks after "which crest do I like", and a flat grid cannot
 * answer it.
 *
 * Deliberately carries NO strength/rating figure. Rosters do not exist until
 * the league is generated, so every franchise here is genuinely identical and
 * any number would be invented — see the note in app/start/[id]/page.tsx,
 * which is where the real rating is shown, once it is real.
 */
export function TeamPickerBoard({
  seeds,
  value,
  onChange,
}: {
  seeds: FranchiseSeed[];
  value: string;
  onChange: (abbr: string) => void;
}) {
  return (
    <div className="grid md:grid-cols-2 gap-4">
      {CONFERENCES.map((conf) => (
        <div key={conf} className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="font-display font-extrabold uppercase tracking-widest text-sm text-chalk">{conf}</span>
            <span className="h-px flex-1 bg-line" />
          </div>

          {DIVISIONS.map((div) => {
            const clubs = seeds.filter((s) => s.conference === conf && s.division === div);
            if (clubs.length === 0) return null;
            return (
              <div key={div} className="panel overflow-hidden">
                <div className="px-3 py-1.5 border-b border-line/60 bg-ink/40">
                  <span className="label-sm">{conf} {div}</span>
                </div>
                <div className="divide-y divide-line/40">
                  {clubs.map((s) => (
                    <ClubRow
                      key={s.abbr}
                      seed={s}
                      selected={s.abbr === value}
                      onSelect={() => onChange(s.abbr)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function ClubRow({
  seed,
  selected,
  onSelect,
}: {
  seed: FranchiseSeed;
  selected: boolean;
  onSelect: () => void;
}) {
  const accent = previewAccent(seed.abbr);
  // Several curated team primaries are deliberately dark (oxblood, midnight,
  // pine) because they are designed as crest FILLS. Tinting a near-black row
  // with a near-black colour produces no visible selection at all, so the
  // highlight is built from a lightened mix — the same correction .text-team
  // makes in globals.css, for the same reason.
  const lit = `color-mix(in srgb, ${accent} 62%, white 38%)`;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      style={{
        ['--team-accent' as never]: accent,
        // Inline rather than an arbitrary Tailwind value: the tint is a
        // color-mix against a custom property set on this same element, which
        // is exactly the case Tailwind's class scanner cannot see through.
        borderLeftColor: selected ? lit : 'transparent',
        background: selected
          ? `linear-gradient(90deg, color-mix(in srgb, ${lit} 30%, transparent), color-mix(in srgb, ${lit} 5%, transparent))`
          : undefined,
        boxShadow: selected ? `inset 0 0 0 1px color-mix(in srgb, ${lit} 45%, transparent)` : undefined,
      }}
      className={`w-full text-left flex items-center gap-3 px-3 py-2.5 border-l-4 transition-colors ${
        selected ? '' : 'hover:bg-raised/50'
      }`}
    >
      <TeamLogo
        seed={previewCrestSeed(seed.abbr)}
        abbr={seed.abbr}
        nickname={seed.nickname}
        size={42}
        className="shrink-0"
      />
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] uppercase tracking-wider text-muted truncate leading-tight">{seed.city}</span>
        <span
          className={`block font-display font-bold uppercase tracking-wide text-base truncate leading-tight ${
            selected ? 'text-team' : 'text-chalk'
          }`}
        >
          {seed.nickname}
        </span>
      </span>
      {/* Colour is never the only channel — the chosen club carries a filled
          tag with a glyph and a word, so the selection survives a colourblind
          read, a screenshot and a very dark team primary. */}
      {selected ? (
        <span
          className="shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-ink"
          style={{ background: lit }}
        >
          <span aria-hidden>✓</span> Chosen
        </span>
      ) : (
        // No abbreviation column on unselected rows: the crest already carries
        // the three letters on its own nameplate, and the same value printed
        // twice on one row is noise (README design principle 5). Leaving the
        // slot empty also makes the chosen tag the only thing on that edge of
        // the board, which is what makes the selection findable at a glance.
        <span className="shrink-0 w-px" aria-hidden />
      )}
    </button>
  );
}
