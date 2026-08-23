import { prisma } from '@/lib/db';
import { getLeagueContext } from '@/lib/league-data';
import { POSITIONS } from '@/lib/tuning';
import { startersAt, splitStarters, OFFENSE_STARTERS, DEFENSE_STARTERS } from '@/lib/lineup';
import { capHit } from '@/lib/cap';
import { DepthChartGroup } from '@/components/DepthChartGroup';
import { AutoSortButton } from '@/components/AutoSortButton';
import { PageMasthead } from '@/components/ds/PageMasthead';
import { tip } from '@/lib/glossary';

export default async function DepthChartPage({ params }: { params: { id: string } }) {
  const { settings, userTeam } = await getLeagueContext(params.id);
  const team = userTeam!;

  const [players, slots] = await Promise.all([
    // Contracts come with the players because the chart now prices each man.
    // The app owner asked for cap hits beside his depth twice — *"it also still
    // doesnt show the salaries of the players ... sorry, the cap hit"* — and
    // this screen, the one actually named Depth Chart, could not have shown
    // them: its query did not fetch a contract and its row type had nowhere to
    // put one.
    prisma.player.findMany({ where: { teamId: team.id }, orderBy: { trueOvr: 'desc' }, include: { contract: true } }),
    prisma.depthChartSlot.findMany({ where: { teamId: team.id }, orderBy: { rank: 'asc' } }),
  ]);

  const byPosition: Record<string, typeof players> = {};
  for (const pos of POSITIONS) byPosition[pos] = [];
  for (const p of players) (byPosition[p.position] ??= []).push(p);

  const orderByPosition: Record<string, string[]> = {};
  for (const pos of POSITIONS) {
    const ranked = slots.filter((s) => s.position === pos).sort((a, b) => a.rank - b.rank).map((s) => s.playerId);
    const rest = byPosition[pos].filter((p) => !ranked.includes(p.id)).map((p) => p.id);
    orderByPosition[pos] = [...ranked, ...rest];
  }

  const byId = new Map(players.map((p) => [p.id, p]));

  /**
   * The men actually on the field at a position — the top `startersAt(pos)` of
   * its chart, not its top man. Every number on this masthead used to take the
   * first player at each position and call that the starter, which is right at
   * QB and wrong at WR, CB, EDGE, DT, LB and S. It counted 16 starters for a
   * lineup that fields 22.
   */
  const startersAtPosition = (pos: string) =>
    splitStarters(pos, orderByPosition[pos] ?? [])
      .starters.map((id) => byId.get(id))
      .filter((p): p is NonNullable<typeof p> => !!p);

  const groupCount = POSITIONS.filter((pos) => byPosition[pos].length > 0).length;
  const thinPositions = POSITIONS.filter((pos) => byPosition[pos].length === 1);

  // "Unmanned" means a starting slot with nobody in it, which is not the same
  // as a position group with nobody in it: two receivers at a position that
  // starts three is a hole in the lineup, and this tile used to read "every
  // spot covered" over exactly that.
  const shortPositions = POSITIONS.filter((pos) => startersAtPosition(pos).length < startersAt(pos));
  const openStarterSlots = POSITIONS.reduce(
    (n, pos) => n + Math.max(0, startersAt(pos) - startersAtPosition(pos).length), 0);

  // Average across the STARTERS — all 22 of them plus the specialists, each
  // counted once per slot he fills, so a three-deep receiver group weighs what
  // it does on the field.
  const starterOvrs = POSITIONS.flatMap((pos) => startersAtPosition(pos).map((p) => p.trueOvr));
  const starterAvgOvr = starterOvrs.length > 0
    ? starterOvrs.reduce((s, v) => s + v, 0) / starterOvrs.length
    : 0;
  // A depth chart that isn't sorted by rating is a legitimate choice, so this
  // reports rather than corrects — but a new signing appends to the bottom of
  // his group, so an 83 can end up behind two 69s without the user ever
  // deciding that. Injured players are excluded: benching someone who's hurt
  // is exactly right, and counting it would make the number meaningless.
  const misordered = POSITIONS.filter((pos) => {
    const order = orderByPosition[pos] ?? [];
    const healthy = order
      .map((id) => players.find((p) => p.id === id))
      .filter((p): p is NonNullable<typeof p> => !!p && p.injuryWeeks === 0);
    return healthy.some((p, i) => healthy.slice(i + 1).some((q) => q.trueOvr > p.trueOvr));
  });

  // Every starter, not every position's top man — an injured WR2 is an injured
  // starter, and this tile used to read zero with him on the field.
  const injuredStarters = POSITIONS.reduce(
    (n, pos) => n + startersAtPosition(pos).filter((p) => p.injuryWeeks > 0).length, 0);

  return (
    <div className="space-y-6">
      <PageMasthead
        teamId={team.id}
        teamAbbr={team.abbr}
        eyebrow="Depth Chart"
        title={`${team.city} ${team.nickname}`}
        subtitle={`Set who starts. The sim engine uses this order every game — ${OFFENSE_STARTERS} on offense, ${DEFENSE_STARTERS} on defense, highlighted below.`}
        action={<AutoSortButton teamId={team.id} />}
        facts={[
          // Colour stays off the group count itself — 16 groups isn't the
          // problem, an unmanned one is, and that gets its own tile below.
          { label: 'Position Groups', value: String(groupCount), detail: 'with at least one player' },
          {
            label: 'Open Starting Slots',
            tip: tip('starter'),
            value: String(openStarterSlots),
            detail: openStarterSlots > 0 ? shortPositions.join(', ') : 'every starting slot filled',
            color: openStarterSlots > 0 ? 'text-bad' : 'text-accent',
            // An empty starting slot is not fixed by reordering — there is
            // nobody to reorder. The move is to go and sign one, so the tile
            // opens free agency already filtered to the first position it
            // names. First and not all of them because the strip carries one
            // href: the GM works the list top-down, and the tile's own detail
            // is in that order.
            href: openStarterSlots > 0 ? `/league/${params.id}/free-agency?pos=${shortPositions[0]}` : undefined,
          },
          {
            // THE COLOUR LEGEND LANDS HERE BECAUSE THIS PAGE HAS NO OVR COLUMN
            // HEADER TO HANG IT ON. Every rating on the screen below is drawn
            // in its tier's ink — DepthChartGroup renders each man's number
            // through ratingColor — but the groups are cards, not a table, so
            // there is no header row anywhere on this route. This tile is the
            // one place on the page that is already about the rating, and it
            // sits above every coloured number it explains. The alternative
            // was a "?" inside the group card header, which would have printed
            // the same bubble sixteen times down one screen.
            label: 'Starter OVR',
            tip: `${tip('overall')} ${tip('ratingColours')}`,
            value: starterAvgOvr.toFixed(1),
            detail: `across all ${starterOvrs.length} starters`,
            color: undefined,
          },
          // Same reasoning as Open Starting Slots: cover for a starter comes
          // from the market, not from this page.
          { label: 'No Backup', value: String(thinPositions.length), detail: thinPositions.length > 0 ? thinPositions.join(', ') : 'depth everywhere', tip: tip('rosterNeed'), color: thinPositions.length > 0 ? 'text-warn' : 'text-accent', href: thinPositions.length > 0 ? `/league/${params.id}/free-agency?pos=${thinPositions[0]}` : undefined },
          // THE COUNT IS REAL. THE INSTRUCTION UNDER IT WAS NOT, and it read
          // "reorder before kickoff" for long enough to have cost somebody a
          // season of Sundays. computeUnits (lib/sim/units.ts) filters the
          // group through `isAvailable` BEFORE it applies the depth chart, so
          // an injured man is skipped wherever the chart puts him and the next
          // healthy man takes his snaps. Reordering by hand changed nothing at
          // all — and obeying it was worse than ignoring it, because the demote
          // was permanent and nothing on any screen prompts a GM to undo it
          // when the man heals two or three weeks later. A starter left behind
          // his own backup, for a press the sim never read.
          //
          // So the tile reports and stops. Who is missing this week is real
          // information; the move it argues for is cover from the market, not
          // an arrow on this page. Still no href — "No Backup" above already
          // opens the wire, and sending a GM shopping over an injury that
          // clears itself in a fortnight is a worse answer than none.
          { label: 'Injured Starters', value: String(injuredStarters), detail: injuredStarters > 0 ? 'backups start automatically' : 'none', color: injuredStarters > 0 ? 'text-bad' : 'text-accent' },
          {
            label: 'Out Of Order',
            tip: tip('depthChart'),
            value: String(misordered.length),
            detail: misordered.length > 0 ? misordered.join(', ') : 'best man starts everywhere',
            color: misordered.length > 0 ? 'text-warn' : 'text-accent',
          },
        ]}
      />

      {/* Column flow, not a grid. A grid row is as tall as its tallest cell, so
          a two-deep QB card sat in a box sized for the seven-deep WR card
          beside it and the page ran close to half empty. Columns pack each
          card against the previous one instead. Reading order becomes
          top-to-bottom then across, which is fine here because every card
          names its own position.

          Two up only from lg. The rows carry a cap hit now, and in a
          two-column card at 768px that left the name 105px — every man on the
          page truncated to a first name and three letters. At lg the cards are
          480px wide and the name gets 233px, at xl three-up it gets 153px, and
          below lg a single full-width column gives it the whole card. Measured,
          not assumed: the panel this figure came from shipped with eight pixels
          for a name the first time it was tried.

          On a phone the card is only ~342px and long surnames do truncate —
          there is no arrangement of rank, rating, name, money and two reorder
          buttons that fits one. Truncating is the side to give: the name is a
          link to his card, and a price he cannot see anywhere on this screen is
          the thing that has been reported three times. */}
      <div className="columns-1 lg:columns-2 xl:columns-3 gap-4 [&>*]:mb-4 [&>*]:break-inside-avoid">
        {POSITIONS.filter((pos) => byPosition[pos].length > 0).map((pos) => (
          <DepthChartGroup
            key={pos}
            leagueId={params.id}
            teamId={team.id}
            position={pos}
            players={byPosition[pos].map((p) => ({
              id: p.id, name: `${p.firstName} ${p.lastName}`, ovr: p.trueOvr, age: p.age,
              injured: p.injuryWeeks > 0, weightLb: p.weightLb, heightIn: p.heightIn,
              // `capHit()` — the same function the cap page, the player card
              // and the trade board run — so the figure beside a man here is
              // the figure the club is charged for him. Null, not zero, when
              // he has no contract row: capHit(null) is 0, and a man with no
              // deal is not a man on a free one.
              capHit: p.contract ? capHit(p.contract, settings.capMode) : null,
            }))}
            order={orderByPosition[pos]}
            capOn={settings.capMode !== 'OFF'}
          />
        ))}
      </div>
    </div>
  );
}
