import { prisma } from '@/lib/db';
import { getLeagueContext } from '@/lib/league-data';
import { readJson } from '@/lib/json';
import { buildScoutedView } from '@/lib/scouting';
import { loadScoutMods } from '@/lib/dynasty';
import { ratingColor } from '@/lib/ratings';
import { askingPrice, marketValue, formatMoney, capHit } from '@/lib/cap';
import { teamCapSummary } from '@/lib/cap-summary';
import { positionSortKey } from '@/lib/league-data';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { positionBadgeClass } from '@/components/ds/positionColor';
import { RatingBadge } from '@/components/ds/RatingBadge';
import { ScoutingRange } from '@/components/ds/ScoutingRange';
import { PageMasthead } from '@/components/ds/PageMasthead';
import { DepthCompare, SlotVerdictBadge, slotVerdict, type DepthCompareEntry } from '@/components/ds/DepthCompare';
import { Tooltip } from '@/components/Tooltip';
import { tip } from '@/lib/glossary';

type SortKey = 'pos' | 'age' | 'ovr' | 'market';

export default async function FreeAgencyPage({ params, searchParams }: { params: { id: string }; searchParams: { pos?: string; sort?: string; dir?: string } }) {
  const { league, settings, userTeam } = await getLeagueContext(params.id);
  const team = userTeam!;

  const where: any = { leagueId: league.id, status: 'FREE_AGENT', teamId: null, isDraftee: false };
  if (searchParams.pos) where.position = searchParams.pos;

  // The spotlight FOLLOWS the position filter. It used to be deliberately
  // unfiltered — "a fixed spotlight, not row 1 of the table" — and that put a
  // right tackle under a masthead reading "filtered to TE", on the same screen
  // as a depth panel naming a different man as the best available at TE. Two
  // elements claiming different bests is worse than a spotlight that moves.
  const topAvailable = await prisma.player.findFirst({ where, orderBy: { trueOvr: 'desc' } });

  // The headline count and the position filters must describe the WHOLE pool,
  // not the slice rendered below it — reporting slice.length as a total claimed
  // "100 AVAILABLE" against 140 real free agents, and dropped the filter pill
  // for any position with nobody in the top 100 by rating, making it look empty.
  // YOUR OWN ROSTER, which this page used to say nothing about at all — you
  // were asked to decide on a receiver with no sight of the receivers you
  // already had. Read from DepthChartSlot in its own rank order: the same
  // table, the same order the Depth Chart screen renders and the sim plays.
  // Joined in one query rather than a lookup per row, and deliberately NOT
  // re-sorted by rating here — the order IS who plays.
  const [freeAgents, totalAvailable, filteredAvailable, positionGroups, depthSlots] = await Promise.all([
    prisma.player.findMany({ where, orderBy: { trueOvr: 'desc' }, take: 100 }),
    prisma.player.count({ where: { leagueId: league.id, status: 'FREE_AGENT', teamId: null, isDraftee: false } }),
    // What the table is actually showing. The pool count above still drives the
    // pills; this drives every number that sits over the filtered table, which
    // used to read "140 AVAILABLE / filtered to TE" above eight tight ends.
    prisma.player.count({ where }),
    prisma.player.groupBy({
      by: ['position'],
      where: { leagueId: league.id, status: 'FREE_AGENT', teamId: null, isDraftee: false },
    }),
    prisma.depthChartSlot.findMany({
      where: { teamId: team.id },
      orderBy: { rank: 'asc' },
      include: { player: { select: { id: true, firstName: true, lastName: true, trueOvr: true, age: true, weightLb: true, heightIn: true, teamId: true, contract: true } } },
    }),
  ]);

  const depthByPosition = new Map<string, DepthCompareEntry[]>();
  for (const slot of depthSlots) {
    // A slot naming somebody who has already gone would inflate your depth and
    // turn a real hole into a phantom starter. reconcileDepthChart clears these
    // on every roster move, so this is a belt on top of braces.
    if (slot.player.teamId !== team.id) continue;
    const list = depthByPosition.get(slot.position) ?? [];
    list.push({
      playerId: slot.playerId,
      name: `${slot.player.firstName} ${slot.player.lastName}`,
      ovr: slot.player.trueOvr,
      age: slot.player.age,
      weightLb: slot.player.weightLb,
      heightIn: slot.player.heightIn,
      // capHit(), not the raw salary — the same function every other money
      // column in the app runs through, so the figure here and the figure on
      // the cap page cannot drift apart.
      //
      // Null, not zero, when there is no contract row: `capHit(null)` returns
      // 0, so letting it answer here drew "$0" and "expiring" at a man who has
      // no deal for either sentence to be about. A man with no deal on file is
      // a different thing from a man whose deal charges nothing, and the row
      // says so. Same policy the re-sign page and the player card already
      // carry — this was the third surface.
      capHit: slot.player.contract ? capHit(slot.player.contract, settings.capMode) : null,
      yearsRemaining: slot.player.contract?.yearsRemaining ?? null,
    });
    depthByPosition.set(slot.position, list);
  }
  const depthAt = (position: string): DepthCompareEntry[] => depthByPosition.get(position) ?? [];
  const reportIds = new Set(freeAgents.map((p) => p.id));
  if (topAvailable) reportIds.add(topAvailable.id);
  const reports = await prisma.scoutingReport.findMany({ where: { teamId: team.id, playerId: { in: Array.from(reportIds) } } });
  const reportMap = new Map(reports.map((r) => [r.playerId, r]));

  const capSummary = settings.capMode === 'OFF' ? null : await teamCapSummary(team.id, league.seasonYear, settings.capMode);
  const scoutMods = await loadScoutMods(league.id);

  // NO `isProspect` HERE, ON PURPOSE. Fog was cut back to draft prospects only
  // (see the SCOPE block in lib/scouting.ts): every man in this pool has played
  // professional football, so you can watch the tape and there is nothing to
  // guess at. buildScoutedView therefore comes back `revealed`, quoting his
  // true rating, and the `view.revealed` branches further down render the exact
  // number rather than a band. Do NOT add `isProspect: true` to "fix" the
  // missing ranges — their absence is the feature.
  const topView = topAvailable ? buildScoutedView({
    position: topAvailable.position as any, trueAttrs: readJson(topAvailable.trueAttrs, {}), trueOvr: topAvailable.trueOvr, potential: topAvailable.potential,
    report: reportMap.get(topAvailable.id), settings, isOwnRoster: false, isUserView: true, dynasty: scoutMods,
  }) : null;
  // TWO FIGURES FOR EVERY MAN ON THIS BOARD, and they are two different
  // questions. `marketValue` is what his rating is worth on an open market;
  // `askingPrice` is what he will sign for TODAY, which is the first number
  // discounted for however many weeks he has stood here unsigned. The ask is
  // the one that matters — it is what the AI's own clubs bid against and what
  // his agent reserves at when you open talks (see resolveNegotiationSession)
  // — so it is the number this page sorts, budgets and prints, with the
  // opening price kept beside it to show how far he has come down.
  //
  // AND IT IS A NUMBER YOU CAN ACTUALLY BUY AT. That is enforced rather than
  // hoped for: the reservation price behind the negotiation panel is anchored
  // so that the dearest man the model can produce still signs at the figure
  // this column prints, on a deal he has no other complaint about (see WHAT
  // THE ASK IS WORTH in lib/negotiation.ts). It was not always so — measured
  // before that change, offering exactly the number in this column closed 13
  // of 60 free agents, which is the lying-metric failure the README's sixth
  // design principle exists to catch, sitting on the busiest screen in the
  // offseason.
  const topAsk = topAvailable && topView ? askingPrice({
    ovr: topView.scoutedOvr, position: topAvailable.position as any, age: topAvailable.age,
    weeksUnsigned: topAvailable.weeksUnsigned,
  }) : 0;
  const topOpening = topAvailable && topView ? marketValue({
    ovr: topView.scoutedOvr, position: topAvailable.position as any, age: topAvailable.age,
  }) : 0;
  const topVerdict = topAvailable && topView
    ? slotVerdict(topAvailable.position, depthAt(topAvailable.position), { ovrLow: topView.ovrLow, ovrHigh: topView.ovrHigh, revealed: topView.revealed })
    : null;

  const positions = positionGroups.map((g) => g.position).sort((a, b) => positionSortKey(a) - positionSortKey(b));

  const rows = freeAgents.map((p) => {
    const view = buildScoutedView({
      position: p.position as any, trueAttrs: readJson(p.trueAttrs, {}), trueOvr: p.trueOvr, potential: p.potential,
      report: reportMap.get(p.id), settings, isOwnRoster: false, isUserView: true, dynasty: scoutMods,
    });
    const market = askingPrice({
      ovr: view.scoutedOvr, position: p.position as any, age: p.age, weeksUnsigned: p.weeksUnsigned,
    });
    const opening = marketValue({ ovr: view.scoutedOvr, position: p.position as any, age: p.age });
    // Still the BAND rather than p.trueOvr, and still routed through the view:
    // slotVerdict must never be handed a number this page's reader cannot see.
    // For a free agent the band is now a point (low === high === truth), so the
    // verdict comes back unfogged and states a plain "STARTER" / "DEPTH" —
    // which is the right answer about a man with a professional career on film.
    const verdict = slotVerdict(p.position, depthAt(p.position), { ovrLow: view.ovrLow, ovrHigh: view.ovrHigh, revealed: view.revealed });
    return { p, view, market, opening, verdict };
  });

  // What the rating column is actually showing. It used to key off
  // `settings.scoutingEnabled`, which is a LEAGUE-WIDE switch and still true —
  // it governs the draft board. With fog scoped to prospects this pool is
  // never fogged, so that heading claimed "Scouted" over a column of exact
  // ratings and pointed the glossary at the wrong entry. Ask the views what
  // they actually returned instead of asking a setting what it permits.
  const fogged = rows.some((r) => !r.view.revealed);

  const sortKey: SortKey = (['pos', 'age', 'ovr', 'market'] as SortKey[]).includes(searchParams.sort as SortKey)
    ? (searchParams.sort as SortKey) : 'ovr';
  const dir = searchParams.dir === 'asc' ? 1 : -1;

  const sorted = [...rows].sort((a, b) => {
    switch (sortKey) {
      case 'age': return (a.p.age - b.p.age) * dir;
      case 'market': return (a.market - b.market) * dir;
      case 'pos': return (positionSortKey(a.p.position) - positionSortKey(b.p.position)) * dir || b.view.scoutedOvr - a.view.scoutedOvr;
      default: return (a.view.scoutedOvr - b.view.scoutedOvr) * dir;
    }
  });

  // How many of the listed free agents you could actually fit under the cap at
  // their estimated rate — the difference between "100 available" and "100 you
  // can do something about."
  const affordable = capSummary ? rows.filter((r) => r.market <= capSummary.capSpace).length : null;

  // THE FULL COMPARISON GETS A HOME WHERE IT IS UNAMBIGUOUS. With a position
  // pill active the whole page is about one position, so "your depth at WR"
  // needs no explaining — it is the answer to the question the pill asked.
  // Unfiltered, the pool spans sixteen positions and a single depth panel
  // would have to pick one arbitrarily, so the unfiltered page carries the
  // per-row badges plus the one on the Top Available strip instead.
  //
  // The man it compares against is the best on the market at that position by
  // the rating YOU can see — not by trueOvr, which would quietly rank the pool
  // using a number the fog is meant to be hiding. Chosen independently of the
  // table's sort so changing the sort never changes the comparison.
  const focusRow = searchParams.pos
    ? rows.reduce<typeof rows[number] | null>((best, r) => (!best || r.view.scoutedOvr > best.view.scoutedOvr ? r : best), null)
    : null;

  const posQuery = searchParams.pos ? `pos=${searchParams.pos}&` : '';
  const sortHref = (key: SortKey) => {
    const nextDir = sortKey === key && dir === -1 ? 'asc' : 'desc';
    return `/league/${league.id}/free-agency?${posQuery}sort=${key}&dir=${nextDir}`;
  };
  const posHref = (pos?: string) => {
    const suffix = `sort=${sortKey}&dir=${dir === -1 ? 'desc' : 'asc'}`;
    return pos ? `/league/${league.id}/free-agency?pos=${pos}&${suffix}` : `/league/${league.id}/free-agency?${suffix}`;
  };

  return (
    <div className="space-y-6">
      <PageMasthead
        teamId={team.id}
        teamAbbr={team.abbr}
        eyebrow="Free Agency"
        title={`${filteredAvailable} Available`}
        subtitle="Open talks and his agent takes the call. The asking price is a number that gets it done — offer it on the deal he is after and he signs — but most men will take something under it, and the interest meter is how you find out how much. Salary, term and guarantee are yours to set, and every offer he turns down costs you patience. Rival teams are bidding on the same players, so a fair offer isn't always the winning one. Nobody holds his spring number forever, either: the longer a man goes unsigned, the less he will take to sign now."
        facts={[
          ...(capSummary ? [{
            label: 'Cap Space',
            tip: tip('capSpace'),
            value: formatMoney(capSummary.capSpace),
            detail: 'room to spend',
            color: capSummary.capSpace >= 0 ? 'text-accent' : 'text-bad',
          }] : []),
          {
            label: 'On The Market',
            value: String(filteredAvailable),
            detail: searchParams.pos ? `${searchParams.pos} · ${totalAvailable} in the whole pool` : 'all positions',
          },
          ...(topAvailable && topView ? [{
            label: 'Best Available',
            tip: topView.revealed ? tip('overall') : tip('scoutedRange'),
            value: String(topView.revealed || topView.confidence >= 90 ? topView.scoutedOvr : `${topView.ovrLow}-${topView.ovrHigh}`),
            detail: `${topAvailable.position} · ${topAvailable.firstName} ${topAvailable.lastName}`,
          }] : []),
          ...(affordable !== null ? [{
            label: 'Within Budget',
            tip: tip('askingPrice'),
            value: String(affordable),
            detail: `of the top ${rows.length} shown, at what they're asking now`,
            color: affordable === 0 ? 'text-warn' : undefined,
          }] : []),
        ]}
      />

      {topAvailable && topView && (
        <div className="panel p-4 flex items-center gap-4 flex-wrap">
          <div className="label-sm shrink-0">Top Available</div>
          <PlayerAvatar seed={topAvailable.id} age={topAvailable.age} size={44} weightLb={topAvailable.weightLb} heightIn={topAvailable.heightIn} position={topAvailable.position} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`font-semibold text-xs ${positionBadgeClass(topAvailable.position)}`}>{topAvailable.position}</span>
              <a href={`/league/${league.id}/player/${topAvailable.id}`} className="font-semibold hover:text-accent2 truncate">{topAvailable.firstName} {topAvailable.lastName}</a>
              <span className="text-xs text-muted">Age {topAvailable.age}</span>
            </div>
            <div className="text-xs text-muted mt-0.5">
              Asking {formatMoney(topAsk)}/yr
              {topOpening > topAsk && <span className="text-accent"> · down from {formatMoney(topOpening)}</span>}
            </div>
          </div>
          {topVerdict && <SlotVerdictBadge verdict={topVerdict} />}
          {topView.revealed || topView.confidence >= 90 ? (
            <RatingBadge value={topView.scoutedOvr} label="OVR" size="sm" />
          ) : (
            <ScoutingRange low={topView.ovrLow} high={topView.ovrHigh} confidence={topView.confidence} label="OVR" className="w-32" />
          )}
          <a href={`/league/${league.id}/player/${topAvailable.id}?view=contract`} className="btn-secondary text-xs px-2.5 py-1.5 shrink-0">Negotiate</a>
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        <a href={posHref()} className={`pill ${!searchParams.pos ? 'border-accent text-accent bg-accent/10' : 'border-line text-muted'}`}>All</a>
        {positions.map((pos) => (
          <a key={pos} href={posHref(pos)} className={`pill ${searchParams.pos === pos ? 'border-accent text-accent bg-accent/10' : 'border-line text-muted'}`}>{pos}</a>
        ))}
      </div>

      {focusRow && (
        <DepthCompare
          position={focusRow.p.position}
          depth={depthAt(focusRow.p.position)}
          candidate={{
            playerId: focusRow.p.id,
            name: `${focusRow.p.firstName} ${focusRow.p.lastName}`,
            age: focusRow.p.age,
            weightLb: focusRow.p.weightLb,
            heightIn: focusRow.p.heightIn,
            rating: { ovrLow: focusRow.view.ovrLow, ovrHigh: focusRow.view.ovrHigh, revealed: focusRow.view.revealed },
          }}
          capOn={settings.capMode !== 'OFF'}
        />
      )}

      <div className="panel overflow-x-auto">
        <table className="table-clean">
          <thead>
            <tr>
              <th><a href={sortHref('pos')} className="hover:text-chalk">Pos{sortKey === 'pos' && (dir === -1 ? ' ▾' : ' ▴')}</a></th>
              <th>Name</th>
              <th><a href={sortHref('age')} className="hover:text-chalk">Age{sortKey === 'age' && (dir === -1 ? ' ▾' : ' ▴')}</a></th>
              <th>
                <span className="inline-flex items-center gap-1">
                  <a href={sortHref('ovr')} className="hover:text-chalk">{fogged ? 'Scouted' : 'OVR'}{sortKey === 'ovr' && (dir === -1 ? ' ▾' : ' ▴')}</a>
                  {/* Downward. The panel is an `overflow-x-auto` scroller, and
                      an auto on one axis clips the other too. */}
                  <Tooltip placement="bottom" text={fogged ? tip('scoutedRange') : tip('overall')} />
                </span>
              </th>
              {/* Not sortable, deliberately: the sort keys are a closed set the
                  URL round-trips, and a seventh one would need its own tie-break
                  story across sixteen positions. It is a scan column. */}
              <th>
                <span className="inline-flex items-center gap-1">
                  Vs. Your Starters
                  <Tooltip placement="bottom" text={tip('starter')} />
                </span>
              </th>
              <th>
                <span className="inline-flex items-center gap-1">
                  <a href={sortHref('market')} className="hover:text-chalk">Asking{sortKey === 'market' && (dir === -1 ? ' ▾' : ' ▴')}</a>
                  <Tooltip placement="bottom" text={tip('askingPrice')} />
                </span>
              </th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(({ p, view, market, opening, verdict }) => (
              <tr key={p.id}>
                <td><span className={`font-semibold text-xs ${positionBadgeClass(p.position)}`}>{p.position}</span></td>
                <td><a href={`/league/${league.id}/player/${p.id}`} className="hover:text-accent2 font-medium flex items-center gap-2"><PlayerAvatar seed={p.id} age={p.age} size={26} weightLb={p.weightLb} heightIn={p.heightIn} position={p.position} /> {p.firstName} {p.lastName}</a></td>
                <td className="text-muted">{p.age}</td>
                <td className={`stat-value text-stat-sm ${ratingColor(view.scoutedOvr)}`}>{view.revealed ? view.scoutedOvr : `${view.ovrLow}-${view.ovrHigh}`}</td>
                <td><SlotVerdictBadge verdict={verdict} /></td>
                {/* What he wants now, and what he wanted. The second line only
                    appears once he has actually come down, so a market that is
                    still fresh reads exactly as it did before. */}
                <td className="font-mono text-muted">
                  <div>{formatMoney(market)}/yr</div>
                  {opening > market && (
                    <div className="text-[11px] text-accent">was {formatMoney(opening)}</div>
                  )}
                </td>
                <td><a href={`/league/${league.id}/player/${p.id}?view=contract`} className="btn-secondary text-xs px-2.5 py-1">Negotiate</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
