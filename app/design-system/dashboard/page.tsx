import { TeamHeader } from '@/components/ds/TeamHeader';
import { FrontOfficeBrief } from '@/components/ds/FrontOfficeBrief';
import { RosterNeeds } from '@/components/ds/RosterNeeds';
import { NewsRow } from '@/components/ds/NewsRow';
import { StandingsTable } from '@/components/ds/StandingsTable';
import { SectionHeading } from '@/components/ds/SectionHeading';
import { generateTeamLogoParams } from '@/lib/gen/teamLogo';

// Demo-only data — mockup composition for review, not wired to the real app.
const TEAM = { id: 'demo-nyg', abbr: 'NYG', city: 'New York', nickname: 'Giants' };
const OPP = { id: 'demo-mia', abbr: 'MIA', city: 'Miami', nickname: 'Dolphins' };

export default function DashboardMockup() {
  const teamColor = generateTeamLogoParams(TEAM.id).primary;

  return (
    <div className="max-w-6xl mx-auto px-6 py-10 space-y-8" style={{ ['--team-accent' as never]: teamColor }}>
      <div>
        <div className="label-sm">Mockup — Stage 2 (rework)</div>
        <h1 className="font-display font-extrabold text-3xl uppercase tracking-wide mt-1">Dashboard Composition</h1>
        <p className="text-muted mt-1 max-w-2xl text-sm">
          Assembled from the components on /design-system, with mock data. Not the real dashboard yet.
        </p>
      </div>

      {/* 1. Franchise hero — record, tenure, live scenario, cap/roster, and
          the next matchup with a win probability, all in one read. */}
      <TeamHeader
        teamId={TEAM.id} abbr={TEAM.abbr} city={TEAM.city} nickname={TEAM.nickname}
        wins={8} losses={3} ties={0} standing="1st · AFC East" tenureLabel="Year 4 of your tenure"
        scenarioTag="Clinch scenario: live at Week 12"
        stats={[
          { value: '$12.8M', label: 'Cap Space', color: 'text-accent' },
          { value: '53/53', label: 'Roster' },
          { value: '#3', label: 'Seed' },
        ]}
        nextGame={{ teamId: OPP.id, abbr: OPP.abbr, city: 'Miami', wins: 6, losses: 5, winProb: 64, home: false }}
      />

      <div className="grid lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          {/* 2. Front Office Brief — the game's differentiator, with a real
              action per item, not a link to "go read more." */}
          <div className="section">
            <SectionHeading title="Front Office Intelligence" />
            <FrontOfficeBrief
              items={[
                { category: 'Roster', headline: 'CB is your thinnest position', detail: 'Worth addressing before it costs you a game — you\'re one injury from starting a UDFA.', action: 'Sign a CB' },
                { category: 'Contracts', headline: 'S. Alvarez enters his final year', detail: 'Walking into the offseason unextended risks losing him to the market at a discount to what he\'ll command.', action: 'Open Extension' },
                { category: 'Trade Market', headline: 'Denver is showing severe need at WR', detail: 'You\'re four deep at the position — this is the best return you\'ll see on WR3/4 depth all year.', action: 'Explore Trade' },
                { category: 'Cap', headline: 'Restructuring Whitfield frees $8.1M', detail: 'Available now if you need space before the deadline, at the cost of $4M added to next year\'s number.', action: 'Open Cap' },
              ]}
            />
          </div>

          {/* 3. League Wire — game recaps and news share one feed, each with
              the number the story is actually about, not just a timestamp. */}
          <div className="section">
            <SectionHeading title="League Wire" action={<span className="text-xs text-accent2">View all →</span>} />
            <div className="panel px-4 divide-y divide-line/60">
              <NewsRow featured category="TRADE" teamId={TEAM.id} abbr={TEAM.abbr}
                headline="Giants land WR D. Sampson in three-team deal with Miami and Denver"
                detail="New York gives up a 2027 third and CB T. Reyes to bolster the receiving corps ahead of the playoff push."
                meta="WK 12" />
              <NewsRow category="GAME" teamId={TEAM.id} abbr={TEAM.abbr} headline="Giants beat Buffalo, 27–20" detail="Whitfield throws for 312 yards, 3 TD." meta="WK 11" metric="27–20" />
              <NewsRow category="INJURY" teamId={OPP.id} abbr={OPP.abbr} headline="Dolphins place K. Hooper on injured reserve" detail="Hamstring strain." meta="WK 12" metric="4–6 wk" />
              <NewsRow category="RECORD" headline="M. Thompson sets the single-season passing yards record" meta="2026" metric="5,214 yds" />
            </div>
          </div>
        </div>

        <div className="space-y-8">
          {/* 4. Roster needs */}
          <div className="section">
            <SectionHeading title="Roster Needs" />
            <div className="panel p-4">
              <RosterNeeds needs={[
                { position: 'CB', level: 'Severe' },
                { position: 'EDGE', level: 'High' },
                { position: 'OT', level: 'Moderate' },
                { position: 'RB', level: 'Low' },
              ]} />
            </div>
          </div>

          {/* 5. Standings — trend deltas + a form guide, not just a table. */}
          <div className="section">
            <SectionHeading title="AFC East" />
            <StandingsTable
              label="Standings"
              rows={[
                { teamId: TEAM.id, abbr: TEAM.abbr, city: 'New York', wins: 8, losses: 3, isUser: true, delta: 1, lastFive: ['W', 'W', 'L', 'W', 'W'] },
                { teamId: 'demo-buf', abbr: 'BUF', city: 'Buffalo', wins: 7, losses: 4, delta: -1, lastFive: ['L', 'W', 'W', 'L', 'W'] },
                { teamId: OPP.id, abbr: OPP.abbr, city: 'Miami', wins: 6, losses: 5, lastFive: ['W', 'L', 'W', 'L', 'L'] },
                { teamId: 'demo-ne', abbr: 'NE', city: 'New England', wins: 3, losses: 8, lastFive: ['L', 'L', 'L', 'W', 'L'] },
              ]}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
