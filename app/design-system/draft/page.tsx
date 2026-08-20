import { OnTheClock } from '@/components/ds/OnTheClock';
import { ProspectRow } from '@/components/ds/ProspectRow';
import { RecentPicksFeed } from '@/components/ds/RecentPicksFeed';
import { SectionHeading } from '@/components/ds/SectionHeading';
import { TeamLogo } from '@/components/TeamLogo';
import { generateTeamLogoParams } from '@/lib/gen/teamLogo';

const TEAM = { id: 'demo-nyg', abbr: 'NYG', city: 'New York' };
const TEAM_COLOR = generateTeamLogoParams(TEAM.id).primary;

export default function DraftDayMockup() {
  return (
    <div className="max-w-6xl mx-auto px-6 py-10 space-y-8" style={{ ['--team-accent' as never]: TEAM_COLOR }}>
      <div>
        <div className="label-sm">Mockup — Stage 5</div>
        <h1 className="font-display font-extrabold text-3xl uppercase tracking-wide mt-1">Live Draft Composition</h1>
        <p className="text-muted mt-1 max-w-2xl text-sm">
          The draft-day event view — distinct from browsing the year-round scouting hub. Mock data only.
        </p>
      </div>

      {/* Class context strip ------------------------------------------------- */}
      <div className="panel px-5 py-3 flex items-center justify-between flex-wrap gap-2">
        <div>
          <span className="label-sm mr-2">Class of 2028</span>
          <span className="text-sm">
            <span className="text-accent font-medium">Loaded:</span> LB, DB
            <span className="text-muted mx-2">·</span>
            <span className="text-bad font-medium">Thin:</span> QB
          </span>
        </div>
        <span className="text-xs text-muted">Round 1 of 7 · 21 picks remain</span>
      </div>

      {/* On the clock hero ----------------------------------------------------- */}
      <OnTheClock teamId={TEAM.id} abbr={TEAM.abbr} city={TEAM.city} round={1} pick={11} clock="06:54" />

      <div className="grid lg:grid-cols-3 gap-8">
        {/* Available board --------------------------------------------------- */}
        <div className="lg:col-span-2 section">
          <SectionHeading title="Top Available" action={<span className="text-xs text-accent2">Full board →</span>} />
          <div className="panel px-4">
            <ProspectRow playerId="demo-prospect-1" rank={1} position="EDGE" name="Jaylen Marsh" college="Ohio State" ovrLow={85} ovrHigh={92} confidence={55} potentialTag="Star Prospect" shortlisted topN />
            <ProspectRow playerId="demo-prospect-2" rank={2} position="CB" name="Devon Price" college="LSU" ovrLow={82} ovrHigh={89} confidence={48} potentialTag="Starter Prospect" topN />
            <ProspectRow playerId="demo-prospect-3" rank={3} position="WR" name="Aiden Cole" college="Georgia" ovrLow={80} ovrHigh={90} confidence={40} potentialTag="Star Prospect" shortlisted topN />
            <ProspectRow playerId="demo-prospect-4" rank={4} position="OT" name="Marco Ellison" college="Iowa" ovrLow={78} ovrHigh={86} confidence={44} potentialTag="Starter Prospect" />
            <ProspectRow playerId="demo-prospect-5" rank={5} position="S" name="Trey Nakamura" college="Oregon" ovrLow={76} ovrHigh={87} confidence={38} potentialTag="Rotation Prospect" />
          </div>
        </div>

        {/* Sidebar: recent picks + trade interest ----------------------------- */}
        <div className="space-y-8">
          <div className="section">
            <SectionHeading title="Recent Picks" />
            <div className="panel px-4">
              <RecentPicksFeed picks={[
                { round: 1, slot: 10, teamId: 'demo-buf', abbr: 'BUF', player: 'Xavier Boone', position: 'OT', college: 'Michigan' },
                { round: 1, slot: 9, teamId: 'demo-den', abbr: 'DEN', player: 'Malik Fenwick', position: 'WR', college: 'Alabama' },
                { round: 1, slot: 8, teamId: 'demo-chi', abbr: 'CHI', player: 'Owen Castellano', position: 'CB', college: 'Florida' },
              ]} />
            </div>
          </div>

          <div className="section">
            <SectionHeading title="Trade Interest" />
            <div className="panel p-4 space-y-3">
              <div className="flex items-center gap-2.5">
                <TeamLogo seed="demo-den" abbr="DEN" size={24} />
                <div className="text-sm flex-1">
                  <span className="font-semibold">Denver</span> wants to move up for pick 11
                </div>
              </div>
              <button className="btn-secondary w-full text-xs">Review Offer</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
