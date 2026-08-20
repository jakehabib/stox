import { TeamHeader } from '@/components/ds/TeamHeader';
import { MatchupCard } from '@/components/ds/MatchupCard';
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
        <div className="label-sm">Mockup — Stage 2</div>
        <h1 className="font-display font-extrabold text-3xl uppercase tracking-wide mt-1">Dashboard Composition</h1>
        <p className="text-muted mt-1 max-w-2xl text-sm">
          Assembled from the components on /design-system, with mock data. Not the real dashboard yet.
        </p>
      </div>

      {/* 1. Franchise hero ------------------------------------------------- */}
      <TeamHeader
        teamId={TEAM.id} abbr={TEAM.abbr} city={TEAM.city} nickname={TEAM.nickname}
        wins={8} losses={3} ties={0} standing="1st · AFC East"
        phaseLabel="Regular Season" weekLabel="Week 12 · vs Miami"
        capSpace="$12.8M" rosterCount={53}
      />

      <div className="grid lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          {/* 2. Next matchup / recent result -------------------------------- */}
          <div className="section">
            <SectionHeading title="This Week" />
            <div className="grid sm:grid-cols-2 gap-4">
              <MatchupCard weekLabel="Week 12 — Sunday" away={{ teamId: TEAM.id, abbr: TEAM.abbr, city: 'New York', wins: 8, losses: 3 }} home={{ teamId: OPP.id, abbr: OPP.abbr, city: 'Miami', wins: 6, losses: 5 }} />
              <MatchupCard weekLabel="Week 11 — Final" away={{ teamId: TEAM.id, abbr: TEAM.abbr, city: 'New York', wins: 8, losses: 3 }} home={{ teamId: 'demo-buf', abbr: 'BUF', city: 'Buffalo', wins: 7, losses: 4 }} score={{ away: 27, home: 20 }} />
            </div>
          </div>

          {/* 3. Front Office Brief -------------------------------------------- */}
          <div className="section">
            <SectionHeading title="Front Office Intelligence" />
            <FrontOfficeBrief
              items={[
                { category: 'Roster', text: 'CB is your thinnest position right now — worth addressing before it costs you a game.' },
                { category: 'Scouting', text: '3 prospects on your shortlist crossed 70% scouting confidence this week.' },
                { category: 'Contracts', text: 'S. Alvarez enters his walk year in the offseason — extend early or risk losing him to the market.' },
                { category: 'Trade Market', text: 'Denver is showing Severe need at WR — you\'re four deep there.' },
                { category: 'Cap', text: 'Restructuring D. Whitfield\'s deal would create $8.1M in space if you need it before the deadline.' },
              ]}
            />
          </div>

          {/* 5. Recent league news --------------------------------------------- */}
          <div className="section">
            <SectionHeading title="League Wire" action={<span className="text-xs text-accent2">View all →</span>} />
            <div className="panel px-4 divide-y divide-line/60">
              <NewsRow featured category="TRADE" teamId={TEAM.id} abbr={TEAM.abbr}
                headline="Giants land WR D. Sampson in three-team deal with Miami and Denver"
                detail="New York gives up a 2027 third and CB T. Reyes to bolster the receiving corps ahead of the playoff push."
                meta="WK 12" />
              <NewsRow category="INJURY" teamId={OPP.id} abbr={OPP.abbr} headline="Dolphins place K. Hooper on injured reserve" detail="Hamstring strain — 4 to 6 weeks." meta="WK 12" />
              <NewsRow category="RECORD" headline="M. Thompson sets the single-season passing yards record — 5,214" meta="2026" />
            </div>
          </div>
        </div>

        <div className="space-y-8">
          {/* 4. Roster needs ------------------------------------------------ */}
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

          {/* 6. Standings / season context ----------------------------------- */}
          <div className="section">
            <SectionHeading title="AFC East" />
            <StandingsTable
              label="Standings"
              rows={[
                { teamId: TEAM.id, abbr: TEAM.abbr, city: 'New York', wins: 8, losses: 3, isUser: true },
                { teamId: 'demo-buf', abbr: 'BUF', city: 'Buffalo', wins: 7, losses: 4 },
                { teamId: OPP.id, abbr: OPP.abbr, city: 'Miami', wins: 6, losses: 5 },
                { teamId: 'demo-ne', abbr: 'NE', city: 'New England', wins: 3, losses: 8 },
              ]}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
