import { TeamLogo } from '@/components/TeamLogo';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { SectionHeading } from '@/components/ds/SectionHeading';
import { StatNumber } from '@/components/ds/StatNumber';
import { RatingBadge } from '@/components/ds/RatingBadge';
import { ScoutingRange } from '@/components/ds/ScoutingRange';
import { TeamHeader } from '@/components/ds/TeamHeader';
import { PlayerHero } from '@/components/ds/PlayerHero';
import { MatchupCard } from '@/components/ds/MatchupCard';
import { OnTheClock } from '@/components/ds/OnTheClock';
import { NewsRow } from '@/components/ds/NewsRow';
import { ProspectRow } from '@/components/ds/ProspectRow';
import { ContractSummary } from '@/components/ds/ContractSummary';
import { CapDecisionPanel } from '@/components/ds/CapDecisionPanel';
import { TradeOfferPreview } from '@/components/ds/TradeOfferPreview';
import { PlayerRowMobile } from '@/components/ds/PlayerRowMobile';
import { BottomNav } from '@/components/ds/BottomNav';
import { generateTeamLogoParams } from '@/lib/gen/teamLogo';

// Demo-only data — nothing here reads from the database. This route exists
// purely to review the visual language before it touches production pages.
const DEMO_TEAM = { id: 'demo-nyg', abbr: 'NYG', city: 'New York', nickname: 'Giants' };
const PARTNER_TEAM = { id: 'demo-mia', abbr: 'MIA', city: 'Miami', nickname: 'Dolphins' };

export default function DesignSystemPage() {
  const teamColor = generateTeamLogoParams(DEMO_TEAM.id).primary;

  return (
    <div className="max-w-5xl mx-auto px-6 py-10 space-y-16">
      <header>
        <div className="label-sm">Internal — Stage 1</div>
        <h1 className="font-display font-extrabold text-4xl uppercase tracking-wide mt-1">Design System</h1>
        <p className="text-muted mt-2 max-w-2xl">
          The visual language for Dynasty GM Football's redesign — tokens first, then the components built
          on top of them. Nothing on this page is wired to real game data or reused in production yet.
        </p>
      </header>

      {/* ================================================================ */}
      <section className="section">
        <SectionHeading eyebrow="Tokens" title="Color" />
        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3">
          {[
            { swatch: 'bg-ink', token: 'ink', desc: 'Page background' },
            { swatch: 'bg-card', token: 'card', desc: 'Primary surface' },
            { swatch: 'bg-raised', token: 'raised', desc: 'Secondary surface' },
            { swatch: 'bg-line', token: 'line', desc: 'Borders / dividers' },
            { swatch: 'bg-chalk', token: 'chalk', desc: 'Primary text' },
            { swatch: 'bg-muted', token: 'muted', desc: 'Muted text' },
            { swatch: 'bg-accent', token: 'accent', desc: 'Positive' },
            { swatch: 'bg-bad', token: 'bad', desc: 'Negative' },
            { swatch: 'bg-warn', token: 'warn', desc: 'Warning' },
            { swatch: 'bg-gold', token: 'gold', desc: 'Elite / gold tier' },
            { swatch: 'bg-accent2', token: 'accent2', desc: 'Info / house blue' },
          ].map(({ swatch, token, desc }) => (
            <div key={token} className="panel p-3">
              <div className={`h-10 rounded border border-line ${swatch}`} />
              <div className="text-xs font-mono mt-2">{token}</div>
              <div className="text-[11px] text-muted">{desc}</div>
            </div>
          ))}
          <div className="panel p-3" style={{ ['--team-accent' as never]: teamColor }}>
            <div className="h-10 rounded border border-line" style={{ background: 'var(--team-accent)' }} />
            <div className="text-xs font-mono mt-2">--team-accent</div>
            <div className="text-[11px] text-muted">Set per page/section</div>
          </div>
        </div>
        <p className="text-xs text-muted mt-3">
          Text hierarchy is opacity-based on <code>chalk</code>, not separate colors: full opacity for primary
          copy, <code>chalk/80</code> for secondary, <code>muted</code> for tertiary/labels.
        </p>
      </section>

      {/* ================================================================ */}
      <section className="section">
        <SectionHeading eyebrow="Tokens" title="Typography" />
        <div className="space-y-4">
          <div>
            <div className="stat-value text-stat-xl">87</div>
            <div className="label-sm">text-stat-xl — hero ratings, on-the-clock countdown</div>
          </div>
          <div>
            <div className="stat-value text-stat-lg">12–5</div>
            <div className="label-sm">text-stat-lg — records, big cap figures</div>
          </div>
          <div>
            <div className="stat-value text-stat-md">$31.4M</div>
            <div className="label-sm">text-stat-md — secondary stat tiles</div>
          </div>
          <div>
            <div className="stat-value text-stat-sm">Round 1 · Pick 7</div>
            <div className="label-sm">text-stat-sm — inline emphasis</div>
          </div>
          <div className="divider pt-4">
            <p className="text-base">Body copy stays on the system sans stack for legibility at small sizes.</p>
            <p className="text-sm text-muted mt-1">Secondary / supporting copy, muted.</p>
            <p className="label-sm mt-1">Label / eyebrow text — uppercase, tracked, muted</p>
          </div>
        </div>
      </section>

      {/* ================================================================ */}
      <section className="section">
        <SectionHeading eyebrow="Tokens" title="Surfaces, Radii & Shadows" />
        <div className="grid sm:grid-cols-3 gap-4">
          <div className="card card-pad">
            <div className="text-sm font-semibold">.card</div>
            <div className="text-xs text-muted mt-1">Rounded, bordered, elevation shadow. Use for one distinct object — a player, a trade offer, a matchup.</div>
          </div>
          <div className="panel p-5">
            <div className="text-sm font-semibold">.panel</div>
            <div className="text-xs text-muted mt-1">Squarer, denser. Data blocks and tables — a decision panel, not "an object."</div>
          </div>
          <div className="p-5">
            <div className="text-sm font-semibold">Bare section</div>
            <div className="text-xs text-muted mt-1">No box at all — heading + divider + content. The default; reach for a card only when justified.</div>
          </div>
        </div>
      </section>

      {/* ================================================================ */}
      <section className="section">
        <SectionHeading eyebrow="1" title="Team Header" />
        <TeamHeader
          teamId={DEMO_TEAM.id} abbr={DEMO_TEAM.abbr} city={DEMO_TEAM.city} nickname={DEMO_TEAM.nickname}
          wins={8} losses={3} ties={0} standing="1st · AFC East"
          phaseLabel="Regular Season" weekLabel="Week 12 · vs Miami"
          capSpace="$12.8M" rosterCount={53}
        />
      </section>

      {/* ================================================================ */}
      <section className="section">
        <SectionHeading eyebrow="2" title="Player Hero" />
        <div className="card card-pad">
          <PlayerHero
            playerId="demo-player-1" name="Marcus Jones" position="WR" jersey={11} age={26}
            ovr={87} potentialLow={89} potentialHigh={93} confidence={80}
            contract="3 years · $18.4M APY"
            teamColor={teamColor}
            attributes={[
              { label: 'Speed', value: 94 }, { label: 'Route Running', value: 88 }, { label: 'Catching', value: 91 },
              { label: 'Release', value: 83 }, { label: 'YAC', value: 90 }, { label: 'Awareness', value: 79 },
            ]}
          />
        </div>
      </section>

      {/* ================================================================ */}
      <section className="section">
        <SectionHeading eyebrow="3" title="Player Row — Desktop Table" />
        <p className="text-xs text-muted mb-2 max-w-lg">
          The real roster page swaps this for the mobile row below a breakpoint rather than shrinking it —
          shown here at native width so it scrolls, not clips, on a narrow viewport.
        </p>
        <div className="panel overflow-x-auto">
          <table className="table-clean">
            <thead>
              <tr><th>Pos</th><th>Player</th><th>Age</th><th>OVR</th><th>Potential</th><th>Cap Hit</th><th>Yrs</th></tr>
            </thead>
            <tbody>
              {[
                { pos: 'QB', name: 'D. Whitfield', age: 28, ovr: 91, pot: '89–93', cap: '$34.2M', yrs: 3 },
                { pos: 'WR', name: 'Marcus Jones', age: 26, ovr: 87, pot: '89–93', cap: '$18.4M', yrs: 3 },
                { pos: 'CB', name: 'T. Reyes', age: 24, ovr: 78, pot: '82–88', cap: '$4.1M', yrs: 2 },
              ].map((p) => (
                <tr key={p.name}>
                  <td className="text-muted">{p.pos}</td>
                  <td className="font-medium">{p.name}</td>
                  <td className="font-mono">{p.age}</td>
                  <td className="stat-value text-stat-sm">{p.ovr}</td>
                  <td className="text-muted">{p.pot}</td>
                  <td className="font-mono">{p.cap}</td>
                  <td className="font-mono">{p.yrs}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ================================================================ */}
      <section className="section">
        <SectionHeading eyebrow="4" title="Player Row — Mobile" />
        <div className="max-w-sm panel p-3">
          <PlayerRowMobile playerId="demo-player-1" position="WR" name="Marcus Jones" age={26} ovr={87} potentialLow={86} potentialHigh={92} capHit="$18.2M" yearsRemaining={3} />
          <PlayerRowMobile playerId="demo-player-2" position="CB" name="Tre Reyes" age={24} ovr={78} potentialLow={82} potentialHigh={88} capHit="$4.1M" yearsRemaining={2} />
        </div>
      </section>

      {/* ================================================================ */}
      <section className="section">
        <SectionHeading eyebrow="5" title="Rating Presentation" />
        <div className="flex items-end gap-6">
          <RatingBadge value={91} label="ELITE" size="lg" />
          <RatingBadge value={82} label="STARTER" size="md" />
          <RatingBadge value={71} label="ROTATION" size="sm" />
          <RatingBadge value={58} label="DEPTH" size="sm" />
        </div>
      </section>

      {/* ================================================================ */}
      <section className="section">
        <SectionHeading eyebrow="6" title="Scouting Range" />
        <div className="flex gap-8 flex-wrap">
          <ScoutingRange low={82} high={89} confidence={80} />
          <ScoutingRange low={70} high={91} confidence={45} />
          <ScoutingRange low={55} high={95} confidence={15} />
        </div>
      </section>

      {/* ================================================================ */}
      <section className="section">
        <SectionHeading eyebrow="7" title="Draft Prospect Row" />
        <div className="panel px-4">
          <ProspectRow playerId="demo-prospect-1" rank={1} position="EDGE" name="Jaylen Marsh" college="Ohio State" ovrLow={85} ovrHigh={92} confidence={55} potentialTag="Star Prospect" shortlisted topN />
          <ProspectRow playerId="demo-prospect-2" rank={14} position="CB" name="Devon Price" college="LSU" ovrLow={74} ovrHigh={84} confidence={40} potentialTag="Rotation Prospect" />
          <ProspectRow playerId="demo-prospect-3" rank={57} position="OT" name="Marco Ellison" college="Iowa" ovrLow={62} ovrHigh={78} confidence={22} potentialTag="Deep Sleeper" />
        </div>
      </section>

      {/* ================================================================ */}
      <section className="section">
        <SectionHeading eyebrow="8" title="Contract Summary" />
        <div className="panel p-5">
          <ContractSummary apy="$18.4M" yearsRemaining={3} capHit="$16.1M" futureCapHit="$19.8M" />
        </div>
      </section>

      {/* ================================================================ */}
      <section className="section">
        <SectionHeading eyebrow="9" title="Cap Decision Panel" />
        <div className="max-w-xs">
          <CapDecisionPanel spaceNow="$11.4M" futureCost="$14.7M" />
        </div>
      </section>

      {/* ================================================================ */}
      <section className="section">
        <SectionHeading eyebrow="10" title="Trade Offer" />
        <TradeOfferPreview
          sendTeam={DEMO_TEAM.abbr} receiveTeam={PARTNER_TEAM.abbr}
          send={[{ label: 'Tre Reyes', sub: 'CB · 78 OVR' }, { label: '2027 3rd Round Pick' }]}
          receive={[{ label: 'D. Sampson', sub: 'WR · 85 OVR' }]}
          capImpact="+$3.2M space"
          interest={{ label: 'Likely to accept', color: 'text-accent' }}
        />
      </section>

      {/* ================================================================ */}
      <section className="section">
        <SectionHeading eyebrow="11" title="News / League Wire" />
        <div className="panel px-4">
          <NewsRow teamId={DEMO_TEAM.id} abbr={DEMO_TEAM.abbr} headline="Giants sign S. Alvarez to a 2-year, $9.4M deal" detail="Fills the primary need at CB2." meta="WK 12" />
          <NewsRow teamId={PARTNER_TEAM.id} abbr={PARTNER_TEAM.abbr} headline="Dolphins place K. Hooper on injured reserve" detail="Hamstring strain — 4 to 6 weeks." meta="WK 12" />
          <NewsRow headline="League Record: M. Thompson sets the single-season passing yards record — 5,214" meta="2026" />
        </div>
      </section>

      {/* ================================================================ */}
      <section className="section">
        <SectionHeading eyebrow="12" title="Matchup Card" />
        <div className="max-w-sm">
          <MatchupCard
            weekLabel="Week 12"
            away={{ teamId: DEMO_TEAM.id, abbr: DEMO_TEAM.abbr, city: 'New York', wins: 8, losses: 3 }}
            home={{ teamId: PARTNER_TEAM.id, abbr: PARTNER_TEAM.abbr, city: 'Miami', wins: 6, losses: 5 }}
          />
        </div>
      </section>

      {/* ================================================================ */}
      <section className="section">
        <SectionHeading eyebrow="13" title="Draft — On The Clock" />
        <div className="max-w-md" style={{ ['--team-accent' as never]: teamColor }}>
          <OnTheClock teamId={DEMO_TEAM.id} abbr={DEMO_TEAM.abbr} city="New York" round={1} pick={11} clock="06:54" />
        </div>
      </section>

      {/* ================================================================ */}
      <section className="section">
        <SectionHeading eyebrow="14" title="Buttons" />
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn-primary">Propose Trade</button>
          <button className="btn-secondary">Cancel</button>
          <button className="btn-tertiary">View details</button>
          <button className="btn-danger">Release Player</button>
          <button className="btn-icon">★</button>
        </div>
      </section>

      {/* ================================================================ */}
      <section className="section">
        <SectionHeading eyebrow="15" title="Navigation — Mobile Concept" />
        <p className="text-xs text-muted mb-3 max-w-lg">
          Concept only, not wired up. Collapsing the current 14 top-level sections into 5 buckets with
          sub-navigation inside each is a real information-architecture decision — revisit deliberately
          during the mobile-polish stage, not here.
        </p>
        <div className="max-w-sm rounded-lg overflow-hidden border border-line">
          <div className="h-24 bg-raised flex items-center justify-center text-xs text-muted">page content</div>
          <BottomNav active={0} />
        </div>
      </section>

      <footer className="pt-6 border-t border-line/60 text-xs text-muted">
        Reusable components live in <code>components/ds/</code>. Tokens live in{' '}
        <code>tailwind.config.ts</code> and <code>app/globals.css</code>.
      </footer>
    </div>
  );
}
