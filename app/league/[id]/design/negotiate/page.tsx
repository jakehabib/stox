import Link from 'next/link';
import { prisma } from '@/lib/db';
import { getLeagueContext } from '@/lib/league-data';
import { teamCapSummary } from '@/lib/cap-summary';
import { formatMoney, marketValue, askingPrice } from '@/lib/cap';
import type { Position } from '@/lib/tuning';
import { PageMasthead } from '@/components/ds/PageMasthead';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { RatingBadge } from '@/components/ds/RatingBadge';
import { DIRECTIONS } from './[direction]/directions';

/**
 * ===========================================================================
 * CONTRACT TALKS — THREE DIRECTIONS, BESIDE THE LIVE ONE
 * ===========================================================================
 * The app owner asked for a new contract-negotiation design, and for it to
 * apply "equally to free agents and re-signs". This is that mockup, built the
 * way the draft-day broadcast was built (commit cd689c3): a real route, at a
 * real URL, running on a real save, so it can be opened beside the screen it
 * would replace and judged against it rather than against a description.
 *
 * NOTHING HERE IS A SKETCH. The session behind every one of these tables is
 * resolved by `resolveNegotiationSession` — the same function free agency, the
 * re-sign window and the extension form all call — the meter is drawn by
 * `decideOffer` on every drag, and the button submits to the same Server
 * Action against the same database. A negotiation mockup with invented salary
 * figures would answer nothing, because the whole question is whether the real
 * numbers read well.
 *
 * NOTHING LINKS TO IT AND NOTHING IN THE LIVE FLOW IS TOUCHED. The three
 * screens a GM actually negotiates on are exactly as they were.
 * ===========================================================================
 */
export default async function NegotiationDesignIndex({ params }: { params: { id: string } }) {
  const { league, settings, userTeam } = await getLeagueContext(params.id);
  const team = userTeam!;
  const cap = settings.capMode === 'OFF' ? null : await teamCapSummary(team.id, league.seasonYear, settings.capMode);

  const freeAgents = await prisma.player.findMany({
    where: { leagueId: league.id, status: 'FREE_AGENT', teamId: null, isDraftee: false },
    orderBy: { trueOvr: 'desc' }, take: 6,
  });
  const expiring = await prisma.player.findMany({
    where: { teamId: team.id, status: 'ACTIVE', contract: { yearsRemaining: { lte: 1 } } },
    include: { contract: true }, orderBy: { trueOvr: 'desc' }, take: 6,
  });
  const extendable = await prisma.player.findMany({
    where: { teamId: team.id, status: 'ACTIVE', contract: { yearsRemaining: { gte: 2 } } },
    include: { contract: true }, orderBy: { trueOvr: 'desc' }, take: 6,
  });

  return (
    <div className="space-y-6">
      <PageMasthead
        teamId={team.id}
        teamAbbr={team.abbr}
        eyebrow="Design route — not linked from anywhere"
        title="Contract Talks — three directions"
        subtitle="Three ways to draw the same negotiation, on this save's real players and real cap. Open one beside the live screen and compare."
        facts={[
          { label: 'Phase', value: league.phase, detail: `week ${league.week}, ${league.seasonYear}` },
          ...(cap ? [{ label: 'Your room', value: formatMoney(cap.capSpace), detail: 'what any of these has to fit inside' }] : []),
          { label: 'On the market', value: String(freeAgents.length ? freeAgents.length : 0), detail: 'top free agents listed below' },
        ]}
      />

      <section className="section">
        <div className="section-head"><span className="section-title">What each direction is trying</span></div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {DIRECTIONS.map((d) => (
            <div key={d.key} className="panel p-4">
              <div className="label-sm">{d.name}</div>
              <p className="text-sm mt-1.5">{d.pitch}</p>
              <p className="text-xs text-muted mt-2">{d.detail}</p>
            </div>
          ))}
        </div>
      </section>

      <Group
        title="An outside free agent"
        note="The open market. Somebody else can sign him today, and the meter has to be honest about losing him."
        rows={freeAgents.map((p) => ({
          id: p.id, name: `${p.firstName} ${p.lastName}`, position: p.position, age: p.age, ovr: p.trueOvr,
          weightLb: p.weightLb, heightIn: p.heightIn,
          line: `Asking ${formatMoney(askingPrice({ ovr: p.trueOvr, position: p.position as Position, age: p.age, weeksUnsigned: p.weeksUnsigned }))}/yr${
            p.weeksUnsigned > 0 ? ` — down from ${formatMoney(marketValue({ ovr: p.trueOvr, position: p.position as Position, age: p.age }))} after ${p.weeksUnsigned} weeks unsigned` : ''}`,
        }))}
        leagueId={league.id}
      />

      <Group
        title="Your own expiring man"
        note="Nobody else may sign him — yet. The hometown discount is real and it is shrinking."
        rows={expiring.map((p) => ({
          id: p.id, name: `${p.firstName} ${p.lastName}`, position: p.position, age: p.age, ovr: p.trueOvr,
          weightLb: p.weightLb, heightIn: p.heightIn,
          line: p.contract?.yearsRemaining === 0
            ? 'His deal is up — one Advance from free agency'
            : 'Walk year — one season still to play for you',
        }))}
        leagueId={league.id}
      />

      <Group
        title="An extension"
        note="Years still running are leverage a re-sign does not give you, and the new years go on the end."
        rows={extendable.map((p) => ({
          id: p.id, name: `${p.firstName} ${p.lastName}`, position: p.position, age: p.age, ovr: p.trueOvr,
          weightLb: p.weightLb, heightIn: p.heightIn,
          line: `${p.contract?.yearsRemaining} more seasons under contract`,
        }))}
        leagueId={league.id}
      />
    </div>
  );
}

function Group({ title, note, rows, leagueId }: {
  title: string; note: string; leagueId: string;
  rows: { id: string; name: string; position: string; age: number; ovr: number; weightLb: number; heightIn: number; line: string }[];
}) {
  return (
    <section className="section">
      <div className="section-head">
        <span className="section-title">{title}</span>
        <span className="text-xs text-muted">{note}</span>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">Nobody on this save is in that state right now.</p>
      ) : (
        <div className="space-y-1.5">
          {rows.map((r) => (
            <div key={r.id} className="panel px-3 py-2 flex items-center gap-3 flex-wrap">
              <PlayerAvatar seed={r.id} age={r.age} size={34} weightLb={r.weightLb} heightIn={r.heightIn} position={r.position} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold truncate">{r.name}</div>
                <div className="text-xs text-muted">{r.position} · age {r.age} · {r.line}</div>
              </div>
              <RatingBadge value={r.ovr} size="sm" />
              <div className="flex gap-1.5">
                {DIRECTIONS.map((d) => (
                  <Link key={d.key} href={`/league/${leagueId}/design/negotiate/${d.key}?player=${r.id}`} className="btn-secondary text-xs">
                    {d.name}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
