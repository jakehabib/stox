import Link from 'next/link';
import type { GmDraftRecord, GmDraftSelection } from '@/lib/gmTenure';

/**
 * WHAT THE HIT RATE IS ACTUALLY MADE OF.
 *
 * The career page printed "46% — 26/56 picks hit" and stopped there, which is a
 * verdict with no evidence: a GM cannot tell from it which round he is good in,
 * which selection he got wrong, or whether the men are even still his. Every
 * number here comes off the SAME pick set and the SAME per-round bar the
 * percentage does (lib/gmTenure.ts, lib/gmCareer.ts draftHitThreshold), so the
 * table can never contradict the headline sitting above it.
 *
 * THE BAR IS PRINTED, NOT IMPLIED. "Hit" is not a fact about football, it is
 * this game's threshold — 78 in round one, sliding to 64 on day three — and a
 * column that stamped men PASS/FAIL without saying against what would be the
 * app telling a GM his sixth-rounder is a bust for being a 66. So the round
 * strip carries its own bar and the table's verdict column reads against it.
 */
function nowLabel(p: GmDraftSelection): { text: string; tone: string } {
  if (p.now === 'ROSTER') return { text: 'Still yours', tone: 'text-accent' };
  if (p.now === 'RETIRED') return { text: 'Retired', tone: 'text-muted' };
  if (p.now === 'FREE_AGENT') return { text: 'Free agent', tone: 'text-muted' };
  return { text: p.nowAbbr ?? 'Elsewhere', tone: 'text-muted' };
}

function pickLine(p: GmDraftSelection): string {
  return p.overall !== null ? `${p.year} · R${p.round} #${p.overall}` : `${p.year} · R${p.round}`;
}

export function GmDraftRounds({ record }: { record: GmDraftRecord }) {
  if (record.byRound.length === 0) return null;
  return (
    <div className="panel overflow-hidden">
      <div className="px-4 py-3 border-b border-line/70 flex items-baseline justify-between gap-3 flex-wrap">
        <div className="label-sm">Where You Draft Well</div>
        <div className="text-xs text-muted">
          A pick hits when he reaches his round&rsquo;s bar — 78 in the first, falling to 64 on day three.
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 divide-x divide-y divide-line/40">
        {record.byRound.map((r) => {
          const pct = r.made > 0 ? r.hits / r.made : 0;
          return (
            <div key={r.round} className="px-3 py-2.5">
              <div className="label-sm text-[10px]">Round {r.round}</div>
              <div className="stat-value text-stat-sm mt-1">{r.hits}<span className="text-muted text-sm">/{r.made}</span></div>
              <div className="mt-1.5 h-1 rounded bg-line/50 overflow-hidden">
                <div className={`h-full ${pct >= 0.5 ? 'bg-accent' : pct > 0 ? 'bg-warn' : 'bg-line'}`} style={{ width: `${Math.round(pct * 100)}%` }} />
              </div>
              <div className="text-[10px] text-muted mt-1">{r.threshold}+ to hit</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function GmDraftHighlights({ leagueId, record }: { leagueId: string; record: GmDraftRecord }) {
  if (!record.best && !record.worst) return null;
  const cell = (title: string, note: string, p: GmDraftSelection | null, tone: string) => (
    <div className="panel p-4">
      <div className="label-sm mb-2">{title}</div>
      {p ? (
        <>
          <Link href={`/league/${leagueId}/player/${p.playerId}`} className={`font-display font-bold text-lg leading-none hover:underline ${tone}`}>
            {p.name}
          </Link>
          <div className="text-xs text-muted mt-1.5 font-mono">
            {p.position} · {pickLine(p)} · {p.ovr} OVR{p.potential > p.ovr ? ` (ceiling ${p.potential})` : ''}
          </div>
          <div className="text-xs text-muted mt-1.5">{note}</div>
        </>
      ) : (
        <div className="text-sm text-muted">{note}</div>
      )}
    </div>
  );
  const bestNote = record.best
    ? `${nowLabel(record.best).text === 'Still yours' ? 'Still on your roster' : `Now: ${nowLabel(record.best).text}`}`
      + `${record.best.seasonsHere > 0 ? ` — ${record.best.seasonsHere} season${record.best.seasonsHere === 1 ? '' : 's'} in your uniform.` : '.'}`
      // A GM who has never missed is told so HERE rather than in a panel of
      // his own headed "Biggest Miss" and containing no miss.
      + (record.worst ? '' : ' Nothing you have taken has fallen short of its round’s bar.')
    : 'No selections on the board yet.';

  return (
    <div className={`grid gap-3 ${record.worst ? 'md:grid-cols-2' : ''}`}>
      {cell('Best Selection', bestNote, record.best, 'text-gold')}
      {/* The regret is the EARLIEST swing that missed, not the lowest-rated man
          on the list: a seventh-rounder who never made it cost nothing. And
          when there is no miss there is no panel — an empty box headed
          "Biggest Miss" is a panel reporting nothing. */}
      {record.worst && cell(
        'Biggest Miss',
        `${record.worst.ovr} against a ${record.worst.threshold} bar for that round.`,
        record.worst,
        'text-bad',
      )}
    </div>
  );
}

export function GmDraftTable({ leagueId, record }: { leagueId: string; record: GmDraftRecord }) {
  if (record.picks.length === 0) {
    return (
      <div className="panel p-4 text-sm text-muted">
        No selections yet — this board fills in the first time you are on the clock.
      </div>
    );
  }
  return (
    <div className="panel overflow-hidden">
      <div className="px-4 py-3 border-b border-line/70 flex items-baseline justify-between gap-3 flex-wrap">
        <div className="label-sm">Every Pick You Have Made</div>
        {/* "Seasons" is years he PRODUCED for you (PlayerSeason rows), so a man
            who has only ever been a healthy scratch shows a dash rather than a
            number he never earned. Said here because a bare column heading
            cannot carry it. */}
        <div className="text-xs text-muted">
          {record.made} selection{record.made === 1 ? '' : 's'} · {record.stillHere} still on your roster · seasons counts the years he played for you
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="table-clean">
          <thead>
            <tr>
              <th>Draft</th><th>Player</th><th>Pos</th>
              <th className="text-right">OVR</th><th className="text-right">Ceiling</th>
              <th className="text-right">Seasons</th><th>Verdict</th><th>Where He Is Now</th>
            </tr>
          </thead>
          <tbody>
            {record.picks.map((p) => {
              const where = nowLabel(p);
              return (
                <tr key={p.playerId} className={p.now === 'ROSTER' ? 'bg-accent/[0.04]' : ''}>
                  <td className="font-mono text-muted whitespace-nowrap">{pickLine(p)}</td>
                  <td>
                    <Link href={`/league/${leagueId}/player/${p.playerId}`} className="hover:underline">{p.name}</Link>
                  </td>
                  <td className="font-mono text-xs text-muted">{p.position}</td>
                  <td className="font-mono text-right">{p.ovr}</td>
                  {/* A ceiling below his current rating means he has already got
                      there; printing "ceiling 71" beside a 78 would read as a
                      demotion rather than as a man who outgrew his projection. */}
                  <td className="font-mono text-right text-muted">{p.potential > p.ovr ? p.potential : '—'}</td>
                  <td className="font-mono text-right text-muted">{p.seasonsHere > 0 ? p.seasonsHere : '—'}</td>
                  <td className={`text-xs ${p.hit ? 'text-accent' : 'text-muted'}`}>
                    {p.hit ? 'Hit' : `Short of ${p.threshold}`}
                  </td>
                  <td className={`text-xs ${where.tone}`}>{where.text}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
