import Link from 'next/link';
import { formatMoney } from '@/lib/cap';
import type { GmAward } from '@/lib/gmCareer';
import type { GmAllStarTally } from '@/lib/allStars';
import type { GmDeadMoneyLedger, GmTenureMan } from '@/lib/gmTenure';

/**
 * THE HONOURS, IN ONE COLUMN, IN THE ORDER THEY WERE WON.
 *
 * These were two flat tables stacked — "All-Stars You Developed" and "Awards Won
 * By Your Players" — each sorted by year, each repeating the year down its own
 * left edge. Two tables answering "what did my players win" is the reader doing
 * the merge in his head, and the same 2031 appearing in both is the same fact
 * printed twice on one screen. One timeline, year by year, says it once.
 *
 * A TROPHY AND A SELECTION ARE NOT THE SAME HONOUR and are not levelled here:
 * the awards lead each year, in gold, because winning MVP is not making the
 * All-Star roster. The All-Star line keeps its stat line, which is the whole
 * reason that table was worth having.
 */
export function GmHonoursTimeline({ awards, allStars }: { awards: GmAward[]; allStars: GmAllStarTally }) {
  const years = [...new Set([...awards.map((a) => a.year), ...allStars.entries.map((e) => e.year)])]
    .sort((a, b) => b - a);
  if (years.length === 0) return null;

  return (
    <div className="panel overflow-hidden">
      <div className="px-4 py-3 border-b border-line/70 flex items-baseline justify-between gap-3 flex-wrap">
        <div className="label-sm">Honours Won Under You</div>
        <div className="text-xs text-muted">
          {awards.length > 0 && `${awards.length} award${awards.length === 1 ? '' : 's'}`}
          {awards.length > 0 && allStars.selections > 0 && ' · '}
          {allStars.selections > 0 && `${allStars.players} All-Star${allStars.players === 1 ? '' : 's'}, ${allStars.selections} selection${allStars.selections === 1 ? '' : 's'}`}
        </div>
      </div>
      <div className="divide-y divide-line/50">
        {years.map((y) => {
          const yearAwards = awards.filter((a) => a.year === y);
          const yearStars = allStars.entries.filter((e) => e.year === y);
          return (
            <div key={y} className="px-4 py-3 flex gap-4">
              <div className="font-mono text-sm text-muted w-14 shrink-0 pt-0.5">{y}</div>
              <div className="min-w-0 space-y-1.5">
                {yearAwards.map((a, i) => (
                  <div key={`a${i}`} className="text-sm">
                    <span className="text-gold">🏆 {a.label}</span>
                    <span className="text-muted"> — {a.detail}</span>
                  </div>
                ))}
                {yearStars.map((e, i) => (
                  <div key={`s${i}`} className="text-sm flex flex-wrap items-baseline gap-x-2">
                    <span className="text-gold">⭐ {e.name}</span>
                    <span className="font-mono text-xs text-muted">{e.position}</span>
                    <span className="text-xs text-muted">{e.statLine}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * THE MEN WHO ACTUALLY SERVED THE TENURE.
 *
 * A career page full of counts has nobody in it. This is the roster nobody else
 * on the page keeps: who stayed, for how long, and which of them you found
 * yourself. Seasons come from PlayerSeason, which is the only table that knows
 * which club a man produced for in a given year, so "six seasons in your
 * uniform" is a count of real years played rather than of years he was on some
 * roster somewhere.
 */
export function GmTenureMenPanel({ leagueId, men }: { leagueId: string; men: GmTenureMan[] }) {
  if (men.length === 0) return null;
  return (
    <div className="panel overflow-hidden">
      <div className="px-4 py-3 border-b border-line/70 flex items-baseline justify-between gap-3 flex-wrap">
        <div className="label-sm">Longest-Serving Players</div>
        <div className="text-xs text-muted">Seasons produced in your uniform since you took the job</div>
      </div>
      <table className="table-clean">
        <thead><tr><th>Player</th><th>Pos</th><th className="text-right">Age</th><th className="text-right">OVR</th><th className="text-right">Seasons</th><th>How He Got Here</th></tr></thead>
        <tbody>
          {men.map((m) => (
            <tr key={m.playerId} className={m.stillHere ? '' : 'text-muted'}>
              <td><Link href={`/league/${leagueId}/player/${m.playerId}`} className="hover:underline">{m.name}</Link></td>
              <td className="font-mono text-xs text-muted">{m.position}</td>
              <td className="font-mono text-right text-muted">{m.age}</td>
              <td className="font-mono text-right">{m.ovr}</td>
              <td className="font-mono text-right">{m.seasons}</td>
              {/* THREE ANSWERS, AND THE THIRD ONE IS REAL. A man with neither a
                  pick nor a signing behind him is not a gap in the data: he is
                  the roster this GM was handed on his first day, which league
                  generation writes with no transaction at all. Saying "signed
                  or acquired" about him was the page guessing. */}
              <td className="text-xs text-muted">
                {m.draftedBy
                  ? `Your pick — ${m.draftedBy.year} round ${m.draftedBy.round}`
                  : m.signedIn !== null
                    ? `Signed in ${m.signedIn}`
                    : 'Here when you took the job'}
                {!m.stillHere && ' · gone'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * WHAT THE OLD MOVES ARE STILL COSTING.
 *
 * This replaces a half-width "Cap Management" panel whose whole content, for
 * almost every GM in this database, was the words "None on the books" — a panel
 * reporting nothing, which is exactly what the draft-complete cleanup went
 * after. Where there IS money on the books it is now itemised: which release,
 * which trade, and how much.
 *
 * IT SAYS WHAT IT IS. The cap ledger is a live sheet — lib/season.ts deletes
 * every charge dated before the current season once the bill is settled — so
 * this is money still owed, not a career total, and the standfirst says so
 * rather than letting a GM read a tenure's worth of discipline into two rows.
 * The career average beside it is the summary's own figure over the seasons the
 * ledger actually covers (lib/gmCareer.ts), which is a different and equally
 * bounded statement.
 */
export function GmDeadMoneyPanel({ ledger, avgPerYear, years }: {
  ledger: GmDeadMoneyLedger;
  avgPerYear: number;
  /** Seasons the ledger actually holds a charge for. Zero is no evidence, not a clean sheet. */
  years: number;
}) {
  if (ledger.items.length === 0) {
    // One line, not a panel: nothing on the books is worth saying once and is
    // not worth a box of its own.
    return (
      <div className="text-xs text-muted px-1">
        No dead money on your books — nothing you have released, traded or torn up is still being charged.
      </div>
    );
  }
  return (
    <div className="panel overflow-hidden">
      <div className="px-4 py-3 border-b border-line/70 flex items-baseline justify-between gap-3 flex-wrap">
        <div className="label-sm">Dead Money Still On Your Books</div>
        <div className="text-xs text-muted">
          {/* The per-season average is only a second number when the ledger
              covers more than one season; over a single year it IS the total,
              and printing "$22.8M owed · $22.8M a season" twice says nothing
              the first half did not. */}
          {formatMoney(ledger.total)} owed{years > 1 ? ` · ${formatMoney(avgPerYear)} a season across the ${years} years the ledger covers` : ''}
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y divide-line/40 border-b border-line/70">
        {ledger.byCause.map((g) => (
          <div key={g.cause} className="px-3 py-2.5">
            <div className="label-sm text-[10px]">{g.label}</div>
            <div className="stat-value text-stat-sm mt-1">{formatMoney(g.amount)}</div>
            <div className="text-[10px] text-muted mt-0.5">{g.count} charge{g.count === 1 ? '' : 's'}</div>
          </div>
        ))}
      </div>
      <table className="table-clean">
        <thead><tr><th>Year</th><th>Charge</th><th className="text-right">Amount</th></tr></thead>
        <tbody>
          {ledger.items.map((i, n) => (
            <tr key={n}>
              <td className="font-mono text-muted">{i.year}</td>
              <td className="text-sm">{i.label}</td>
              <td className="font-mono text-right text-bad">{formatMoney(i.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
