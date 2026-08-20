import { PlayerHero } from '@/components/ds/PlayerHero';
import { ScoutingRange } from '@/components/ds/ScoutingRange';
import { ContractSummary } from '@/components/ds/ContractSummary';
import { NewsRow } from '@/components/ds/NewsRow';
import { Timeline } from '@/components/ds/Timeline';
import { SectionHeading } from '@/components/ds/SectionHeading';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { positionBadgeClass } from '@/components/ds/positionColor';
import { generateTeamLogoParams } from '@/lib/gen/teamLogo';

const TEAM_COLOR = generateTeamLogoParams('demo-nyg').primary;

export default function PlayerPageMockup() {
  return (
    <div className="max-w-5xl mx-auto px-6 py-10 space-y-10" style={{ ['--team-accent' as never]: TEAM_COLOR }}>
      <div>
        <div className="label-sm">Mockup — Stage 3 (rework)</div>
        <h1 className="font-display font-extrabold text-3xl uppercase tracking-wide mt-1">Player Page Composition</h1>
        <p className="text-muted mt-1 max-w-2xl text-sm">
          A signed veteran below; a draft prospect variant (College Profile) at the bottom. Mock data only.
        </p>
      </div>

      {/* Hero — the card treatment lives inside PlayerHero itself now. */}
      <PlayerHero
        playerId="demo-player-1" name="Marcus Jones" position="WR" jersey={11} age={26}
        ovr={87} potentialLow={89} potentialHigh={93} confidence={80}
        contract="3 years · $18.4M APY"
        teamColor={TEAM_COLOR}
        tags={['ELITE']}
        keyStats={[{ value: '78', label: 'REC' }, { value: '1,142', label: 'YDS' }, { value: '9', label: 'TD' }]}
      />

      <div className="grid md:grid-cols-3 gap-8">
        {/* Overview -------------------------------------------------------- */}
        <div className="md:col-span-2 space-y-8">
          <div className="section">
            <SectionHeading title="Overview" />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <Bio label="College" value="LSU" />
              <Bio label="Drafted" value="2022 · R2 P41" />
              <Bio label="Experience" value="4th season" />
              <Bio label="Height / Weight" value="6'1&quot; · 198 lb" />
              <Bio label="Status" value="Active" valueClass="text-accent" />
              <Bio label="Morale" value="High" valueClass="text-accent" />
              <Bio label="Dev Trait" value="Star" valueClass="text-gold" />
              <Bio label="Fatigue" value="Fresh" />
            </div>
          </div>

          <div className="section">
            <SectionHeading title="Ratings" />
            <div className="panel p-5 grid grid-cols-2 sm:grid-cols-3 gap-x-8 gap-y-3">
              {[
                ['Speed', 94], ['Acceleration', 92], ['Agility', 89], ['Route Running', 88], ['Catching', 91],
                ['Release', 83], ['YAC', 90], ['Awareness', 79], ['Toughness', 75],
              ].map(([label, value]) => (
                <div key={label as string}>
                  <div className="flex items-baseline justify-between">
                    <span className="label-sm">{label}</span>
                    <span className="font-mono text-xs text-chalk">{value}</span>
                  </div>
                  <div className="h-1 rounded-full bg-raised overflow-hidden mt-1">
                    <div className="h-full bg-accent2/70 rounded-full" style={{ width: `${value}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="section">
            <SectionHeading title="Season Stats" />
            <div className="panel overflow-x-auto">
              <table className="table-clean">
                <thead>
                  <tr><th>Year</th><th>Team</th><th>Rec</th><th>Yds</th><th>TD</th><th>YPC</th></tr>
                </thead>
                <tbody>
                  <tr><td className="font-mono">2026</td><td>NYG</td><td className="font-mono">78</td><td className="font-mono">1,142</td><td className="font-mono">9</td><td className="font-mono text-muted">14.6</td></tr>
                  <tr><td className="font-mono">2025</td><td>NYG</td><td className="font-mono">64</td><td className="font-mono">891</td><td className="font-mono">6</td><td className="font-mono text-muted">13.9</td></tr>
                  <tr><td className="font-mono">2024</td><td>NYG</td><td className="font-mono">41</td><td className="font-mono">512</td><td className="font-mono">3</td><td className="font-mono text-muted">12.5</td></tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="section">
            <SectionHeading title="Career Highlights" />
            <div className="panel p-5">
              <Timeline entries={[
                { year: '2026', text: 'Set a career high with 1,142 receiving yards, earning his first Pro Bowl nod.' },
                { year: '2025', text: 'Named a team captain after leading all receivers in third-down conversion rate.' },
                { year: '2022', text: 'Drafted 41st overall out of LSU — the Giants\' first pick of the Whitfield era.' },
              ]} />
            </div>
          </div>

          <div className="section">
            <SectionHeading title="Transaction History" />
            <div className="panel px-4 divide-y divide-line/60">
              <NewsRow category="TRADE" teamId="demo-nyg" abbr="NYG" headline="Acquired by New York in a three-team trade" detail="Sent from Miami with a 2027 5th for a 2027 3rd and CB T. Reyes." meta="2026" />
              <NewsRow category="SIGNING" teamId="demo-nyg" abbr="NYG" headline="Signed a rookie contract" detail="4 years · $6.2M total, drafted Round 2, Pick 41." meta="2022" />
            </div>
          </div>
        </div>

        {/* Sidebar: contract — OVR/Potential already live in the hero above,
            no need to repeat them here. */}
        <div className="space-y-8">
          <div className="section">
            <SectionHeading title="Contract" />
            <div className="panel p-5">
              <ContractSummary apy="$18.4M" yearsRemaining={3} capHit="$16.1M" futureCapHit="$19.8M" />
            </div>
          </div>

          <div className="section">
            <SectionHeading title="Injury Risk" />
            <div className="panel p-5">
              <div className="flex items-center justify-between mb-1.5">
                <span className="label-sm">Durability</span>
                <span className="text-sm font-medium text-accent">Low Risk</span>
              </div>
              <div className="h-1.5 rounded-full bg-raised overflow-hidden">
                <div className="h-full bg-accent rounded-full" style={{ width: '22%' }} />
              </div>
              <p className="text-xs text-muted mt-2">No missed games in 3 seasons. Age curve favorable through year 6.</p>
            </div>
          </div>
        </div>
      </div>

      {/* Draft prospect variant ---------------------------------------------- */}
      <div className="section border-t border-line/60 pt-8">
        <SectionHeading eyebrow="Variant" title="Draft Prospect — College Profile" />
        <p className="text-xs text-muted -mt-1 mb-3 max-w-lg">
          True OVR is fog-of-war pre-draft — the prospect hero shows a scouted range instead of a hard
          number, not PlayerHero's RatingBadge (which assumes a known overall).
        </p>
        <div className="card card-pad flex flex-wrap items-start gap-6">
          <PlayerAvatar seed="demo-prospect-1" age={21} size={112} teamColor={TEAM_COLOR} />
          <div className="flex-1 min-w-[220px]">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`pill border ${positionBadgeClass('EDGE')}`}>EDGE</span>
              <span className="text-sm text-muted">Age 21 · Ohio State</span>
            </div>
            <div className="font-display font-extrabold text-3xl uppercase tracking-wide leading-none mt-2">Jaylen Marsh</div>
            <div className="flex gap-2 mt-3">
              <span className="pill border-gold/40 text-gold">TOP 10</span>
              <span className="pill border-line text-muted">Star Prospect</span>
            </div>
          </div>
          <ScoutingRange low={85} high={92} confidence={55} label="SCOUTED OVR" />
        </div>
        <div className="grid sm:grid-cols-3 gap-4 mt-4">
          <div className="panel p-4">
            <div className="label-sm mb-1">College Production</div>
            <div className="text-sm">62 tackles · 14.5 sacks · 4 FF (Senior year, Ohio State)</div>
          </div>
          <div className="panel p-4">
            <div className="label-sm mb-1">Combine / Pro Day</div>
            <div className="text-sm">4.52 forty · 34" vertical · 24 reps @ 225</div>
          </div>
          <div className="panel p-4">
            <div className="label-sm mb-1">Competition Level</div>
            <div className="text-sm">Faced 6 NFL-caliber tackles this season — the sack total travels.</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Bio({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div>
      <div className="label-sm">{label}</div>
      <div className={`text-sm font-medium mt-0.5 ${valueClass ?? ''}`}>{value}</div>
    </div>
  );
}
