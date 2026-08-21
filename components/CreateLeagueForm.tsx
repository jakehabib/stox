'use client';

import { useState } from 'react';
import { TeamLogo } from './TeamLogo';
import { TeamPickerBoard } from './TeamPickerBoard';
import { previewAccent, previewCrestSeed, type FranchiseSeed } from './ds/FranchiseWall';

/**
 * League setup: pick a franchise from the board, set the rules, start.
 *
 * The franchise choice used to be one `<select>` of 32 abbreviations among
 * four dropdowns. It is now the whole left-hand side of the screen — see
 * TeamPickerBoard — and everything else on this form tints to whichever club
 * is currently selected, so the page belongs to that franchise before the
 * league exists.
 *
 * ORDERING: identity first, generation second. The alternative (generate the
 * league, then choose from the real 32 with their real ratings) buys a true
 * strength number at selection, and it was seriously considered — but league
 * generation is ~5,300 rows over 236 sequential round trips and is documented
 * as the single most likely thing to time out in production
 * (docs/deployment.md). Putting it BEFORE the choice means a failure costs the
 * player the whole visit, and an abandoned board leaves a half-owned league
 * burning one of their eight save slots. So the wait stays where it is, at the
 * moment they have already committed, and the real rating is shown one beat
 * later on the start screen — where it is real.
 */
export function CreateLeagueForm({
  seeds,
  action,
  initialAbbr,
}: {
  seeds: FranchiseSeed[];
  action: (fd: FormData) => Promise<void>;
  /** Preselected club, e.g. from a crest clicked on the landing page. */
  initialAbbr?: string;
}) {
  const [picked, setPicked] = useState(
    () => (initialAbbr && seeds.some((s) => s.abbr === initialAbbr) ? initialAbbr : seeds[0]?.abbr) ?? '',
  );
  const [pending, setPending] = useState(false);

  const club = seeds.find((s) => s.abbr === picked);
  const accent = picked ? previewAccent(picked) : undefined;

  /**
   * Raise the working state from the CLICK, not from inside the form action.
   *
   * This is not a style preference, it is the only thing that works here.
   * React as bundled by Next 14 runs a form action inside a transition, and a
   * `setState` made inside that transition is deprioritised — measured, not
   * assumed: with the flag set inside `submit()` the overlay never got a
   * commit at all, right through a 1.5-second generation, and the button sat
   * on its idle label until the page navigated away. A click is a discrete
   * event, so this update renders immediately.
   *
   * The button is deliberately NOT disabled while pending. Disabling it from
   * its own click handler can cancel the submission that click was supposed to
   * start; the full-screen overlay is what blocks a second attempt.
   */
  function markPending(e: React.MouseEvent<HTMLButtonElement>) {
    // Don't put up a "building the league" screen for a submit the browser is
    // about to refuse for an empty league name.
    if (e.currentTarget.form?.checkValidity() === false) return;
    setPending(true);
  }

  async function submit(fd: FormData) {
    setPending(true);
    try {
      await action(fd);
    } catch (err: unknown) {
      // A successful create ends in redirect(), which surfaces here as a
      // throw carrying a NEXT_REDIRECT digest. That is the happy path: keep
      // the overlay up so the screen stays covered right through the
      // navigation instead of flashing back to an idle form for a frame.
      const digest = (err as { digest?: unknown } | null)?.digest;
      if (typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT')) throw err;
      setPending(false);
      throw err;
    }
  }

  return (
    <form action={submit} style={accent ? ({ ['--team-accent' as never]: accent } as React.CSSProperties) : undefined}>
      <input type="hidden" name="userTeamAbbr" value={picked} />

      {/* The band tints live to whatever is selected — the screen belongs to
          the club before the league does. */}
      <div
        className="relative overflow-hidden rounded-lg border-2 mb-5"
        style={{
          borderColor: accent,
          background: accent
            ? `radial-gradient(ellipse 120% 160% at 0% 0%, color-mix(in srgb, ${accent} 22%, transparent), transparent 68%)`
            : undefined,
        }}
      >
        <div
          className="absolute inset-0 opacity-[0.06] pointer-events-none"
          style={{
            backgroundImage:
              'repeating-linear-gradient(115deg, currentColor 0px, currentColor 1px, transparent 1px, transparent 14px)',
            color: accent ?? '#f4f6fa',
          }}
        />
        <div className="relative flex flex-wrap items-center justify-between gap-4 px-6 py-5">
          <div className="min-w-0">
            <div className="label-sm">New Dynasty</div>
            <h1 className="font-display font-extrabold text-3xl sm:text-4xl uppercase tracking-wide leading-none mt-1 text-team">
              Choose Your Franchise
            </h1>
            <p className="text-muted text-sm mt-2 max-w-xl">
              Thirty-two clubs, none of them real. Pick the one you want to run for the next twenty years — the
              league builds itself around your answer.
            </p>
          </div>
          {club && (
            <div className="flex items-center gap-3 shrink-0">
              <TeamLogo
                seed={previewCrestSeed(club.abbr)}
                abbr={club.abbr}
                nickname={club.nickname}
                size={72}
                className="drop-shadow"
              />
              <div className="min-w-0">
                <div className="label-sm">Selected</div>
                <div className="font-display font-extrabold text-xl uppercase tracking-wide leading-none mt-1 text-team truncate">
                  {club.nickname}
                </div>
                <div className="text-xs text-muted mt-1">
                  {club.city} · {club.conference} {club.division}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr_21rem] gap-5 items-start">
        <TeamPickerBoard seeds={seeds} value={picked} onChange={setPicked} />

        <div className="lg:sticky lg:top-6 space-y-4">
          <div className="panel p-5 space-y-5">
            <div>
              <div className="label-sm">League rules</div>
              <h2 className="font-display font-extrabold text-2xl uppercase tracking-wide leading-none mt-1">Set It Up</h2>
            </div>

            <div>
              <label htmlFor="league-name" className="label-sm block mb-1.5">League name</label>
              <input
                id="league-name"
                name="name"
                className="input w-full"
                placeholder="My League"
                defaultValue="Founders League"
                maxLength={60}
                required
              />
            </div>

            <Field
              label="Starting situation"
              name="leagueStart"
              options={[
                ['RANDOM_ROSTERS', 'Randomized rosters'],
                ['FANTASY_DRAFT', 'Fantasy draft'],
              ]}
              hint={{
                RANDOM_ROSTERS: 'Every club starts with a full, ready-made roster.',
                FANTASY_DRAFT: 'All 32 rosters are emptied into one pool and drafted from scratch.',
              }}
            />
            <Field
              label="Salary cap"
              name="capMode"
              options={[['OFF', 'Off'], ['SIMPLIFIED', 'Simplified'], ['REALISTIC', 'Realistic']]}
              defaultValue="REALISTIC"
              hint={{
                OFF: 'Sign anyone. No cap accounting at all.',
                SIMPLIFIED: 'A cap ceiling, without dead money and proration.',
                REALISTIC: 'Full cap: bonuses prorate, cuts leave dead money.',
              }}
            />
            <Field
              label="Difficulty"
              name="difficulty"
              options={[['ROOKIE', 'Rookie'], ['PRO', 'Pro'], ['ALL_PRO', 'All-Pro'], ['LEGEND', 'Legend']]}
              defaultValue="PRO"
            />

            {/* Desktop only. On a phone the sticky bar at the foot of the form
                is the start button, and having a second one here does nothing
                except sit underneath that bar — which is not a theory, it is
                what a scripted walk-through hit: the click landed on the
                sticky bar instead and the form never submitted. */}
            <button
              type="submit"
              className="btn-primary w-full hidden lg:inline-flex"
              disabled={!picked}
              aria-busy={pending}
              onClick={markPending}
            >
              {pending && <span className="spinner-ring" aria-hidden />}
              <span>{pending ? 'Building the league…' : club ? `Take over the ${club.nickname} ▸` : 'Start Dynasty ▸'}</span>
            </button>
            <p className="text-[11px] text-muted text-center leading-relaxed">
              Generating a league writes 32 rosters, about 1,500 players, every contract and a full schedule. It takes
              a couple of seconds.
            </p>
          </div>

          {club && <DivisionPreview seeds={seeds} club={club} />}
        </div>
      </div>

      {/* Phone only. The board is taller than a phone screen, so without this
          the one thing a player came here to do — start — is a scroll to the
          bottom away from wherever they just tapped. Sticky rather than fixed
          so it takes real space at the end of the page instead of sitting on
          top of the last division block. */}
      {club && (
        <div className="lg:hidden sticky bottom-0 z-20 -mx-4 sm:-mx-6 mt-5 border-t border-line bg-surface/95 backdrop-blur px-4 py-3 flex items-center gap-3">
          <TeamLogo
            seed={previewCrestSeed(club.abbr)}
            abbr={club.abbr}
            nickname={club.nickname}
            size={40}
            className="shrink-0"
          />
          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-wider text-muted leading-tight truncate">{club.city}</div>
            <div className="font-display font-bold uppercase tracking-wide leading-tight truncate text-team">
              {club.nickname}
            </div>
          </div>
          <button
            type="submit"
            className="btn-primary shrink-0"
            disabled={!picked}
            aria-busy={pending}
            onClick={markPending}
          >
            {pending && <span className="spinner-ring" aria-hidden />}
            <span>{pending ? 'Building…' : 'Start ▸'}</span>
          </button>
        </div>
      )}

      {pending && club && <BuildingOverlay club={club} accent={accent} />}
    </form>
  );
}

/**
 * Who you will be playing twice a year, shown while you are still choosing.
 *
 * It fills the column beside a tall board, but that is not why it is here:
 * "who is in my division" is the second question anybody asks after "which
 * crest do I like", and it is the one piece of context the picker can give
 * honestly. It carries identity only — no strength figure, because rosters do
 * not exist yet — and says so, rather than leaving a reader to wonder whether
 * the number was left out or forgotten.
 */
function DivisionPreview({ seeds, club }: { seeds: FranchiseSeed[]; club: FranchiseSeed }) {
  const rivals = seeds.filter(
    (s) => s.conference === club.conference && s.division === club.division && s.abbr !== club.abbr,
  );
  return (
    <div className="panel p-4">
      <div className="label-sm">Twice a year, every year</div>
      <h3 className="font-display font-bold uppercase tracking-wide text-lg mt-0.5 leading-none">
        {club.conference} {club.division}
      </h3>
      <ul className="mt-3 space-y-2">
        {rivals.map((r) => (
          <li key={r.abbr} className="flex items-center gap-2.5">
            <TeamLogo seed={previewCrestSeed(r.abbr)} abbr={r.abbr} nickname={r.nickname} size={30} className="shrink-0" />
            <span className="min-w-0">
              <span className="block text-[10px] uppercase tracking-wider text-muted leading-tight truncate">{r.city}</span>
              <span className="block font-display font-bold uppercase tracking-wide text-sm leading-tight truncate">
                {r.nickname}
              </span>
            </span>
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-muted mt-3 leading-relaxed">
        No ratings here on purpose — no roster in this league exists until you press start. Every club&apos;s real
        overall is on the next screen.
      </p>
    </div>
  );
}

/**
 * The wait, dressed as the thing it actually is.
 *
 * Deliberately has NO progress bar and NO percentage. Nothing on the server
 * reports progress back, so a bar here would be an animation pretending to be
 * a measurement — the exact class of invented number this project has a
 * standing rule against. What it shows instead is a true list of the work,
 * and a spinner that means only "still going".
 */
function BuildingOverlay({ club, accent }: { club: FranchiseSeed; accent?: string }) {
  const steps = [
    'Founding 32 clubs',
    'Generating about 1,500 players',
    'Writing every contract against the cap',
    'Drawing up a full season schedule',
    'Opening your scouting book on the league',
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/85 backdrop-blur-sm px-6"
      role="status"
      aria-live="polite"
    >
      <div
        className="relative overflow-hidden rounded-lg border-2 max-w-md w-full px-8 py-10 text-center bg-card"
        style={{
          borderColor: accent,
          background: accent
            ? `radial-gradient(ellipse 120% 140% at 50% 0%, color-mix(in srgb, ${accent} 26%, transparent), transparent 70%), #18181b`
            : undefined,
        }}
      >
        <TeamLogo
          seed={previewCrestSeed(club.abbr)}
          abbr={club.abbr}
          nickname={club.nickname}
          size={96}
          className="mx-auto drop-shadow"
        />
        <div className="label-sm mt-5">Now entering</div>
        <div className="font-display font-extrabold text-3xl uppercase tracking-wide leading-none mt-1.5 text-team">
          {club.city}
        </div>
        <div className="font-display font-extrabold text-3xl uppercase tracking-wide leading-none text-chalk">
          {club.nickname}
        </div>

        <ul className="mt-6 space-y-1.5 text-left text-sm text-muted">
          {steps.map((s) => (
            <li key={s} className="flex items-start gap-2">
              <span className="text-team mt-0.5" aria-hidden>▸</span>
              <span>{s}</span>
            </li>
          ))}
        </ul>

        <div className="flex items-center justify-center gap-2 mt-6 text-sm text-chalk">
          <span className="spinner-ring" aria-hidden />
          <span>Building the league…</span>
        </div>
      </div>
    </div>
  );
}

/** Segmented control backed by a hidden input, so it still posts as form data. */
function Field({
  label,
  name,
  options,
  defaultValue,
  hint,
}: {
  label: string;
  name: string;
  options: [string, string][];
  defaultValue?: string;
  /** One line per option explaining what it actually changes. */
  hint?: Record<string, string>;
}) {
  const [value, setValue] = useState(defaultValue ?? options[0][0]);
  return (
    <div>
      <label className="label-sm block mb-1.5">{label}</label>
      <input type="hidden" name={name} value={value} />
      <Segmented value={value} onChange={setValue} options={options} full />
      {hint?.[value] && <p className="text-[11px] text-muted mt-1.5 leading-relaxed">{hint[value]}</p>}
    </div>
  );
}

function Segmented({
  value,
  onChange,
  options,
  full,
}: {
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
  full?: boolean;
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
