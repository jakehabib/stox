import { TeamLogo } from '../TeamLogo';
import { SectionHeading } from './SectionHeading';
import { positionBadgeClass } from './positionColor';
import { tip } from '@/lib/glossary';

/**
 * A pick the club actually holds. The two number fields are deliberately
 * separate and never merged into one "slot": `overall` is the selection this
 * pick IS, and only exists once that draft's order has been reseeded from
 * final standings; `projectedOverall` is where it would land if the season
 * ended right now, and is the only one a current-year pick has while the
 * season is still being played. A future year has neither, and inventing one
 * for it would be a number the system never used.
 */
export interface DraftCapitalPick {
  id: string;
  year: number;
  round: number;
  /** Real selection number. Present ONLY when the order for that year is settled. */
  overall?: number;
  /** "If the season ended today", from the ORIGINAL club's record. Never set for a future year. */
  projectedOverall?: number;
  /** The slot half of the projection, for the same wording the trade screen uses. */
  projectedSlot?: number;
  /** The size of the round the projected slot is one of — the "of 32" in the trade screen's phrase. */
  roundSize?: number;
  /** Set when the pick was acquired in a trade — the club it originally belonged to. */
  from?: { teamId: string; abbr: string };
  /** Live draft only: selections between now and this pick. 0 means on the clock. */
  picksAway?: number;
  /** Live draft only: who this pick was already spent on. */
  spentOn?: { name: string; position: string };
}

/** An original pick of this club's that somebody else now holds. */
export interface DraftCapitalForfeit {
  id: string;
  year: number;
  round: number;
  overall?: number;
  /** Same rule as a held pick: only ever the live projection, never a stand-in for a real slot. */
  projectedOverall?: number;
  to: { teamId: string; abbr: string };
  /** Set once the club holding it has used it. */
  spentOn?: { name: string; position: string };
}

export interface DraftCapitalYear {
  year: number;
  /** The order for this year is reseeded and final — show real numbers, no projection language. */
  settled: boolean;
  /** A live projection exists for this year (current draft, real standings behind it). */
  projected: boolean;
  /**
   * The next draft that will actually run. It is itemised pick by pick even
   * when it has no selection numbers yet, because it is the one a GM is
   * PLANNING against: "3 picks — R2, R6-R7" tells him he owns something in the
   * second round somewhere, which is not a thing anyone can trade up from.
   * Later drafts stay summarised — the app owner's own call, and the trade
   * hub treats them the same way.
   */
  upcoming?: boolean;
  /**
   * The season whose standings will set this order, when that season has not
   * been played out yet. Left unset once it has: at that point the order is
   * simply waiting for the draft to open, and naming a finished season as the
   * thing to wait for reads like the page has lost track of the calendar.
   */
  orderFromSeason?: number;
  picks: DraftCapitalPick[];
  forfeited: DraftCapitalForfeit[];
}

const roundLabel = (round: number) => `R${round}`;

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

/** "R1–R7", "R2, R4–R7" — the rounds you hold, collapsed into runs. */
function roundSummary(rounds: number[]): string {
  const sorted = [...new Set(rounds)].sort((a, b) => a - b);
  if (sorted.length === 0) return 'none';
  const parts: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (const r of sorted.slice(1)) {
    if (r === prev + 1) { prev = r; continue; }
    parts.push(start === prev ? roundLabel(start) : `${roundLabel(start)}–${roundLabel(prev)}`);
    start = r;
    prev = r;
  }
  parts.push(start === prev ? roundLabel(start) : `${roundLabel(start)}–${roundLabel(prev)}`);
  return parts.join(', ');
}

/** "R2 twice" — a round held more than once, which is the whole point of having stockpiled it. */
function doubledRounds(picks: DraftCapitalPick[]): string[] {
  const counts = new Map<number, number>();
  for (const p of picks) counts.set(p.round, (counts.get(p.round) ?? 0) + 1);
  return [...counts.entries()]
    .filter(([, n]) => n > 1)
    .sort((a, b) => a[0] - b[0])
    .map(([round, n]) => `${roundLabel(round)} ${n === 2 ? 'twice' : `×${n}`}`);
}

function statusLabel(y: DraftCapitalYear): string {
  if (y.settled) return 'order set';
  if (y.projected) return 'if the season ended today';
  return y.orderFromSeason ? `order set after ${y.orderFromSeason}` : 'order set when the draft opens';
}

/** A year has real selection numbers on every row, so every row is worth a row. */
// Which drafts get a row per pick. Numbers are not the qualifier — being the
// draft you are about to spend in is. See DraftCapitalYear.upcoming.
const isItemised = (y: DraftCapitalYear) => y.settled || y.projected || y.upcoming === true;

/**
 * WHAT YOU HOLD, WHAT YOU GAVE UP, AND WHEN YOU ARE NEXT UP.
 *
 * The draft page used to answer "how many picks do you own" with a single
 * count, which is not a number a GM can plan from. This is the same question
 * answered properly: every pick by round and selection number, grouped by
 * draft, with the club a traded-in pick came from, the rounds that are gone
 * shown in place rather than silently missing, and — during a live draft —
 * how many selections until the club is on the clock.
 *
 * A projected number is never rendered as a final one. `settled` and
 * `projected` come from the page, which knows whether that year's order has
 * actually been reseeded.
 *
 * THE NEXT DRAFT IS ALWAYS ITEMISED; LATER ONES ARE NOT. This started as a
 * numbers rule — a ladder only where real selection numbers existed — and the
 * app owner corrected it to a planning rule: *"it needs to show your current
 * picks for the draft year so you can plan instead of guessing 'oh i have a
 * pick somewhere in R2'."* A summary hides the two things you plan around:
 * that a round is doubled up and that a round is gone. So the imminent draft
 * gets a row per pick whether or not its order has been seeded, and a row with
 * no selection number simply prints none rather than a placeholder dash.
 *
 * Drafts beyond the next one stay on one dense line — how many picks, which
 * rounds — plus only the rows that carry news: a round that is gone, a pick
 * that came in from another club. Two years out there is nothing to plan
 * against yet, and the trade hub summarises them the same way.
 */
export function DraftCapitalPanel({ years, nextUp, liveOrder }: {
  years: DraftCapitalYear[];
  /** Live draft only — the club's next unused pick and how far away it is. */
  nextUp?: { picksAway: number; round: number; overall: number; onTheClock: boolean };
  /**
   * The clubs whose records are actually setting the projected numbers above:
   * this club first, then anybody whose pick it holds. Every projected
   * selection in the panel is one of these slots plus a round, so this is the
   * part that moves — a pick acquired from a club that then wins six straight
   * is a different asset by December. Only passed while a projection is live.
   */
  liveOrder?: { teamId: string; abbr: string; slot: number; outOf: number; record: string; isMine: boolean }[];
}) {
  // What you can still spend. A pick already used is history, and counting it
  // as capital is how the header ends up disagreeing with the panel under it.
  const unused = years.reduce((n, y) => n + y.picks.filter((p) => !p.spentOn).length, 0);
  const made = years.reduce((n, y) => n + y.picks.filter((p) => p.spentOn).length, 0);
  const itemised = years.filter(isItemised);
  const rest = years.filter((y) => !isItemised(y));
  const cells = itemised.length + (rest.length > 0 || (liveOrder && liveOrder.length > 0) ? 1 : 0);

  return (
    <div className="section">
      <SectionHeading
        title="Your Picks"
        tip={tip('pickValue')}
        action={
          <span className="text-xs text-muted">
            {unused} pick{unused === 1 ? '' : 's'} across {years.length} draft{years.length === 1 ? '' : 's'}
            {made > 0 && <span className="text-chalk"> · {made} made</span>}
          </span>
        }
      />

      <div className="panel p-4 space-y-3">
        {nextUp && (
          <div
            className={`flex flex-wrap items-center justify-between gap-3 rounded-md border px-4 py-3 ${
              nextUp.onTheClock ? 'border-accent bg-accent/10' : 'border-line bg-raised/60'
            }`}
          >
            <div className="flex items-baseline gap-2.5">
              <span className={`stat-value text-stat-md ${nextUp.onTheClock ? 'text-accent' : 'text-chalk'}`}>
                {nextUp.onTheClock ? `#${nextUp.overall}` : nextUp.picksAway}
              </span>
              <span className="label-sm">
                {nextUp.onTheClock
                  ? `${roundLabel(nextUp.round)} · you are on the clock`
                  : `selection${nextUp.picksAway === 1 ? '' : 's'} until you are on the clock`}
              </span>
            </div>
            {!nextUp.onTheClock && (
              <div className="font-mono text-sm text-muted">
                {roundLabel(nextUp.round)} · #{nextUp.overall} overall
              </div>
            )}
          </div>
        )}

        {/* The drafts that have selection numbers get a column each; everything
            further out shares the last column, one line per year. */}
        <div className={`grid gap-3 items-start ${cells >= 2 ? 'md:grid-cols-2' : 'md:max-w-2xl'} ${itemised.length >= 2 ? 'lg:grid-cols-3' : ''}`}>
          {itemised.map((y) => (
            <div key={y.year} className="rounded-md border border-line/70 bg-raised/30 px-3 py-2.5">
              <YearHeading year={y.year} status={statusLabel(y)} projected={y.projected} />
              <div className="divide-y divide-line/40">
                {mergeRows(y).map((row) =>
                  row.kind === 'held'
                    ? <HeldRow key={row.pick.id} pick={row.pick} />
                    : <ForfeitedRow key={row.forfeit.id} forfeit={row.forfeit} />,
                )}
                {y.picks.length === 0 && y.forfeited.length === 0 && (
                  <div className="py-2 text-xs text-muted">Nothing in this draft.</div>
                )}
              </div>
            </div>
          ))}

          {(rest.length > 0 || (liveOrder && liveOrder.length > 0)) && (
            <div className="rounded-md border border-line/70 bg-raised/30 px-3 divide-y divide-line/40">
              {liveOrder && liveOrder.length > 0 && (
                <div className="py-2.5">
                  {/* No "if the season ended today" caption here: the ladder
                      beside this one already carries it, and the same six words
                      twice on one row reads as a stutter. */}
                  <div className="flex items-baseline justify-between gap-2 pb-1 border-b border-line/40">
                    <span className="font-display font-bold uppercase tracking-wide text-sm text-chalk">Live Order</span>
                    <span className="text-[10px] uppercase tracking-wider text-muted">standings now</span>
                  </div>
                  {liveOrder.map((a) => (
                    <div key={a.teamId} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-1">
                      <span className="flex items-center gap-1.5">
                        <TeamLogo seed={a.teamId} abbr={a.abbr} size={16} />
                        <span className="font-mono text-sm text-chalk">{a.abbr}</span>
                      </span>
                      <span className="text-sm">
                        <span className={a.isMine ? 'text-accent2 font-semibold' : 'text-chalk font-semibold'}>{ordinal(a.slot)}</span>
                        <span className="text-muted"> of {a.outOf} · {a.record}</span>
                      </span>
                      <span className="text-[11px] text-muted ml-auto">{a.isMine ? 'your own picks' : `the ${a.abbr} pick`}</span>
                    </div>
                  ))}
                </div>
              )}
              {rest.map((y) => <LaterYear key={y.year} year={y} />)}
            </div>
          )}
        </div>

        {years.length === 0 && <p className="text-sm text-muted">You hold no picks in any scheduled draft.</p>}
      </div>
    </div>
  );
}

function YearHeading({ year, status, projected }: { year: number; status: string; projected: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2 pb-1.5 border-b border-line/60">
      <span className="font-display font-bold uppercase tracking-wide text-sm text-chalk">{year} Draft</span>
      <span className={`text-[10px] uppercase tracking-wider ${projected ? 'text-accent2' : 'text-muted'}`}>{status}</span>
    </div>
  );
}

/**
 * A draft that is still too far out to have an order. One line for what you
 * hold, and then only what is unusual about it — never a row per round with
 * nothing in it.
 */
function LaterYear({ year: y }: { year: DraftCapitalYear }) {
  const doubled = doubledRounds(y.picks);
  const acquired = y.picks.filter((p) => p.from);

  return (
    <div className="py-2.5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-display font-bold uppercase tracking-wide text-sm text-chalk">{y.year}</span>
        <span className="text-sm">
          <span className={y.picks.length === 0 ? 'text-warn font-semibold' : 'text-chalk font-semibold'}>
            {y.picks.length} pick{y.picks.length === 1 ? '' : 's'}
          </span>
          {y.picks.length > 0 && <span className="text-muted"> — {roundSummary(y.picks.map((p) => p.round))}</span>}
          {doubled.length > 0 && <span className="text-accent2"> · {doubled.join(', ')}</span>}
        </span>
        <span className="text-[10px] uppercase tracking-wider text-muted ml-auto">{statusLabel(y)}</span>
      </div>

      {(acquired.length > 0 || y.forfeited.length > 0) && (
        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
          {acquired.map((p) => (
            <span key={p.id} className="flex items-center gap-1.5 text-[11px]">
              <span className="font-mono font-semibold text-chalk">{roundLabel(p.round)}</span>
              <TeamLogo seed={p.from!.teamId} abbr={p.from!.abbr} size={14} />
              <span className="text-accent2 font-medium">from {p.from!.abbr}</span>
            </span>
          ))}
          {y.forfeited.map((f) => (
            <span key={f.id} className="flex items-center gap-1.5 text-[11px]">
              <span className="font-mono font-semibold text-muted line-through">{roundLabel(f.round)}</span>
              <TeamLogo seed={f.to.teamId} abbr={f.to.abbr} size={14} />
              <span className="text-muted font-medium">to {f.to.abbr}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Held and forfeited rounds interleave by round so the sequence reads
 * continuously — a missing third-rounder shows up as a struck-through R3
 * exactly where it would have been, instead of the list jumping R2 to R4 and
 * looking like a rendering fault.
 */
function mergeRows(y: DraftCapitalYear) {
  const rows: ({ kind: 'held'; pick: DraftCapitalPick; round: number } | { kind: 'forfeit'; forfeit: DraftCapitalForfeit; round: number })[] = [
    ...y.picks.map((pick) => ({ kind: 'held' as const, pick, round: pick.round })),
    ...y.forfeited.map((forfeit) => ({ kind: 'forfeit' as const, forfeit, round: forfeit.round })),
  ];
  return rows.sort((a, b) => a.round - b.round
    || (a.kind === 'held' ? 0 : 1) - (b.kind === 'held' ? 0 : 1));
}

function RoundChip({ round, gone = false }: { round: number; gone?: boolean }) {
  return (
    <span
      className={`w-8 shrink-0 text-center font-mono text-[11px] font-semibold rounded py-0.5 ${
        gone ? 'border border-line/60 bg-ink/30 line-through text-muted' : 'border border-line bg-ink/50'
      }`}
    >
      {roundLabel(round)}
    </span>
  );
}

function HeldRow({ pick }: { pick: DraftCapitalPick }) {
  const spent = !!pick.spentOn;
  return (
    <div className={`flex items-center gap-2 py-1.5 ${spent ? 'opacity-60' : ''}`}>
      <RoundChip round={pick.round} />

      {pick.overall !== undefined ? (
        <span className="stat-value text-stat-sm text-chalk">#{pick.overall}</span>
      ) : pick.projectedOverall === undefined ? (
        // The upcoming draft is itemised before its order exists, so this is a
        // normal state now rather than the impossible one it used to be. No
        // number is printed at all: the year heading already says the order
        // lands when the draft opens, and a dash in a column of selection
        // numbers reads like a value that failed to load.
        null
      ) : (
        // The trade screen's exact wording for the same idea, extended with the
        // overall number this panel is actually showing, so one term never gets
        // explained two ways on two screens — or, worse, attached to two
        // different numbers.
        <span
          className="inline-flex items-baseline gap-1"
          title={`Projected pick ${pick.projectedSlot} of ${pick.roundSize} in round ${pick.round} — #${pick.projectedOverall} overall — if the season ended today`}
        >
          <span className="text-[10px] text-accent2 uppercase tracking-wider">proj.</span>
          <span className="stat-value text-stat-sm text-accent2">#{pick.projectedOverall}</span>
        </span>
      )}

      {pick.from && (
        <span className="flex items-center gap-1 shrink-0" title={`Acquired from ${pick.from.abbr}`}>
          <TeamLogo seed={pick.from.teamId} abbr={pick.from.abbr} size={16} />
          <span className="text-[11px] text-accent2 font-medium">from {pick.from.abbr}</span>
        </span>
      )}

      {pick.spentOn ? (
        <span className="flex items-center gap-1.5 min-w-0 ml-auto">
          <span className={`text-[10px] font-semibold ${positionBadgeClass(pick.spentOn.position)}`}>{pick.spentOn.position}</span>
          <span className="text-xs text-chalk truncate max-w-[10rem]">{pick.spentOn.name}</span>
        </span>
      ) : pick.picksAway !== undefined ? (
        <span className={`text-[11px] font-mono ml-auto ${pick.picksAway === 0 ? 'text-accent' : 'text-muted'}`}>
          {pick.picksAway === 0 ? 'on the clock' : `${pick.picksAway} away`}
        </span>
      ) : null}
    </div>
  );
}

function ForfeitedRow({ forfeit }: { forfeit: DraftCapitalForfeit }) {
  return (
    <div className="flex items-center gap-2 py-1.5 opacity-55">
      <RoundChip round={forfeit.round} gone />
      <span className="font-mono text-sm text-muted line-through">
        {forfeit.overall !== undefined
          ? `#${forfeit.overall}`
          : forfeit.projectedOverall !== undefined
          ? `proj. #${forfeit.projectedOverall}`
          : 'traded'}
      </span>
      <span className="flex items-center gap-1 shrink-0" title={`Traded to ${forfeit.to.abbr}`}>
        <TeamLogo seed={forfeit.to.teamId} abbr={forfeit.to.abbr} size={16} />
        <span className="text-[11px] text-muted font-medium">to {forfeit.to.abbr}</span>
      </span>
      {forfeit.spentOn && (
        <span className="flex items-center gap-1.5 min-w-0 ml-auto text-muted">
          <span className={`text-[10px] font-semibold ${positionBadgeClass(forfeit.spentOn.position)}`}>{forfeit.spentOn.position}</span>
          <span className="text-xs truncate max-w-[10rem]">{forfeit.spentOn.name}</span>
        </span>
      )}
    </div>
  );
}
