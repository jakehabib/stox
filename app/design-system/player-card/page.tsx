import { PlayerAvatar } from '@/components/PlayerAvatar';
import { TeamLogo } from '@/components/TeamLogo';
import { Tooltip } from '@/components/Tooltip';
import { CareerStatTable } from '@/components/ds/CareerStatTable';
import { ContractLedger } from '@/components/ds/ContractLedger';
import { RatingBadge } from '@/components/ds/RatingBadge';
import { SectionHeading } from '@/components/ds/SectionHeading';
import { StatNumber } from '@/components/ds/StatNumber';
import { positionBadgeClass } from '@/components/ds/positionColor';
import { StatScopeToggle, STAT_SCOPE_PARAM, parseStatScope } from '@/components/ds/StatScopeToggle';
import { classifyContractValue } from '@/lib/analytics';
import {
  capForYear, capHit, formatMoney, marketValue, proration, prorationYears, restructureContract,
  type ContractLike,
} from '@/lib/cap';
import { generateTeamLogoParams } from '@/lib/gen/teamLogo';
import { tip } from '@/lib/glossary';
import type { CareerTable, CareerTableRow, StatScope } from '@/lib/playerSeasons';
import {
  ATTRIBUTE_BY_KEY, POSITION_WEIGHTS, attrsForPosition, computeOverall, playerLabel, ratingColor,
  type AttrMap,
} from '@/lib/ratings';
import { headlineColumns, statLabel } from '@/lib/statLabels';
import type { Position } from '@/lib/tuning';
import type { SeasonStats } from '@/lib/types';
import { PlayerCardShell } from './PlayerCardShell';

/**
 * ===========================================================================
 * MOCKUP — A PLAYER CARD THAT CARRIES HIS CONTRACT WITHOUT LEADING WITH IT
 * ===========================================================================
 * A direction, not a shipped screen. Nothing here reads the database and
 * nothing in production imports this file.
 *
 * The card as it stands today puts production high and the contract last, and
 * spends five cells of the hero strip on money. This asks a different
 * question: what if the contract were a SECOND FACE of the same card rather
 * than a section further down it? The default view is Stats — his season line
 * and what he is graded on — plus two money figures on the band: what he costs
 * this year, how long he is under contract. The other tab opens the whole deal
 * in place: the schedule year by year, what is guaranteed, what walking away
 * costs, the bonus, the void year, and the two moves you can make on it.
 *
 * EVERY DOLLAR ON THIS PAGE COMES OUT OF lib/cap.ts, evaluated against the one
 * mock contract below — the same functions the sim charges. The two figures on
 * the band and the ledger inside the contract pane are not two copies of a
 * number, they are one call to `capHit()` rendered twice.
 *
 * HIS OVERALL IS NOT TYPED IN EITHER. It is `computeOverall()` run over the
 * attribute map below, so the 90 on the chip is the arithmetic of the bars in
 * the Attributes panel and cannot drift from them. The panel lists exactly
 * what `attrsForPosition()` carries for his position, ordered by each
 * attribute's real share of the grade (`POSITION_WEIGHTS`, normalised the way
 * `computeOverall` normalises it) — nothing invented, nothing a receiver is
 * not measured on. The career row of the stat table is likewise summed from
 * the season rows above it rather than typed in.
 * ===========================================================================
 */

const TEAM = { id: 'demo-nyg', abbr: 'NYG', city: 'New York', nickname: 'Giants' };
const TEAM_COLOR = generateTeamLogoParams(TEAM.id).primary;

/** The league year this card is being read in, and the year the league opened. */
const SEASON_YEAR = 2027;
const LEAGUE_START_YEAR = 2026;

const POSITION: Position = 'WR';

/**
 * His true attributes — every key `attrsForPosition('WR')` returns and no
 * others: the seven a receiver's grade is built from, plus the universal
 * physical/mental block every player carries.
 *
 * A card in the game shows these as scouted bands for a player the club has
 * not had in its own building. This mock is the plain case — his own roster,
 * nothing hidden — so the numbers are stated rather than ranged.
 */
const TRUE_ATTRS: AttrMap = {
  // Graded at WR
  speed: 93, route: 92, catching: 94, release: 82, contested: 86, acceleration: 91, agility: 84,
  // Carried by everyone
  strength: 74, awareness: 83, durability: 68, stamina: 88, workEthic: 91,
};

/** The chip in the hero and the bars in the Attributes panel, from one call. */
const OVR = computeOverall(POSITION, TRUE_ATTRS);

const PLAYER = {
  id: 'demo-card-wr',
  first: 'Elijah',
  last: 'Ward',
  position: POSITION,
  age: 27,
  /** Seasons completed — 2022 through 2026. */
  experience: 5,
  heightIn: 74,
  weightLb: 205,
  college: 'Oregon',
  potential: 92,
  injury: { type: 'Hamstring', weeks: 2 },
  ringYears: [2026],
  allStarYears: [2025, 2026],
};

/**
 * His second contract, as stored. Four real years signed in 2026 with one
 * void year hung off the end — the shape that makes a void year do anything
 * at all, since proration stops at five seasons (see CAP.MAX_PRORATION_YEARS).
 * `baseSalaries` is the full original schedule, indexed from signing.
 */
const CONTRACT: ContractLike & { guaranteed: number; voidYears: number } = {
  years: 4,
  yearsRemaining: 3,
  signedYear: 2026,
  baseSalaries: JSON.stringify([1_500_000, 12_000_000, 16_500_000, 21_000_000]),
  signingBonus: 35_000_000,
  guaranteed: 52_000_000,
  voidYears: 1,
};

const CAP_MODE = 'REALISTIC' as const;

// --- Production ------------------------------------------------------------
// One row per season he has played here. The career line is summed from these
// below rather than written out, so the bottom of the table is always the
// total of the table.
interface Line { year: number; age: number; stats: SeasonStats }

const REGULAR: Line[] = [
  { year: 2022, age: 22, stats: { gp: 15, targets: 62, rec: 38, recYds: 512, recTd: 3 } },
  { year: 2023, age: 23, stats: { gp: 17, targets: 104, rec: 66, recYds: 921, recTd: 6 } },
  { year: 2024, age: 24, stats: { gp: 17, targets: 138, rec: 91, recYds: 1_244, recTd: 9 } },
  { year: 2025, age: 25, stats: { gp: 16, targets: 132, rec: 87, recYds: 1_181, recTd: 8 } },
  { year: 2026, age: 26, stats: { gp: 17, targets: 156, rec: 104, recYds: 1_466, recTd: 12 } },
  { year: 2027, age: 27, stats: { gp: 11, targets: 108, rec: 74, recYds: 1_032, recTd: 8 } },
];

const POSTSEASON: Line[] = [
  { year: 2024, age: 24, stats: { gp: 2, targets: 19, rec: 12, recYds: 168, recTd: 2 } },
  { year: 2026, age: 26, stats: { gp: 3, targets: 31, rec: 21, recYds: 302, recTd: 3 } },
];

function sum(lines: Line[]): SeasonStats {
  const keys: (keyof SeasonStats)[] = ['gp', 'targets', 'rec', 'recYds', 'recTd'];
  const out: SeasonStats = {};
  for (const k of keys) out[k] = lines.reduce((a, l) => a + (l.stats[k] ?? 0), 0);
  return out;
}

function careerTable(scope: StatScope, lines: Line[]): CareerTable {
  const rows: CareerTableRow[] = lines.map((l) => ({
    kind: 'season',
    seasonLabel: String(l.year),
    showSeasonLabel: true,
    teamId: TEAM.id,
    teamAbbr: TEAM.abbr,
    age: l.age,
    stats: l.stats,
    inProgress: l.year === SEASON_YEAR,
  }));
  rows.push({
    kind: 'career',
    seasonLabel: 'Career',
    showSeasonLabel: true,
    teamId: null,
    teamAbbr: null,
    age: null,
    stats: sum(lines),
    inProgress: false,
  });
  return { scope, rows, hasUndecomposed: false, hasPreLeagueCareer: false, empty: lines.length === 0 };
}

/**
 * Every attribute the position carries, ordered by how much of his grade it
 * decides. The share is the weight `computeOverall` actually applies —
 * normalised across the weights present, which is what that function does — so
 * the column adds to 100% and never claims a weight the engine does not use.
 * The universal block a receiver is not graded on sorts to the bottom with no
 * share against it.
 */
function attributeRows(position: Position, attrs: AttrMap) {
  const weights = POSITION_WEIGHTS[position];
  const total = Object.entries(weights).reduce((a, [k, w]) => a + (attrs[k] != null ? w : 0), 0);
  return attrsForPosition(position)
    .map((key) => ({
      key,
      label: ATTRIBUTE_BY_KEY[key]?.label ?? key,
      value: attrs[key] ?? 0,
      share: total > 0 ? (weights[key] ?? 0) / total : 0,
    }))
    .sort((a, b) => b.share - a.share);
}

export default function PlayerCardMockup({ searchParams }: { searchParams?: { split?: string } }) {
  const scope = parseStatScope(searchParams?.[STAT_SCOPE_PARAM]);
  const showPlayoffs = scope === 'PLAYOFFS';
  const table = careerTable(scope, showPlayoffs ? POSTSEASON : REGULAR);
  const scopeHref = (playoffs: boolean) =>
    `/design-system/player-card${playoffs ? `?${STAT_SCOPE_PARAM}=playoffs` : ''}`;

  // --- The money, all of it, from lib/cap.ts -------------------------------
  const hit = capHit(CONTRACT, CAP_MODE);
  const capTotal = capForYear(SEASON_YEAR, LEAGUE_START_YEAR);
  const bases: number[] = JSON.parse(CONTRACT.baseSalaries);
  const totalValue = bases.reduce((a, b) => a + b, 0) + CONTRACT.signingBonus;
  const bonusPerYear = proration(CONTRACT);
  const bonusThrough = CONTRACT.signedYear + prorationYears(CONTRACT) - 1;
  const market = marketValue({ ovr: OVR, position: PLAYER.position, age: PLAYER.age, potential: PLAYER.potential });
  const valueTier = classifyContractValue(market - hit, market);
  const lastYear = SEASON_YEAR + CONTRACT.yearsRemaining - 1;

  // What the restructure button would actually do, from the function the
  // restructure screen itself calls: convert as much of this year's base as
  // the rules allow and re-prorate. Stated so the affordance is a decision
  // rather than a door.
  const restructured = restructureContract(CONTRACT, Number.MAX_SAFE_INTEGER, { nowYear: SEASON_YEAR });
  const restructuredHit = capHit(
    { ...restructured, baseSalaries: JSON.stringify(restructured.baseSalaries) },
    CAP_MODE,
  );
  const restructureFrees = hit - restructuredHit;

  const label = playerLabel({
    ovr: OVR, potential: PLAYER.potential, experience: PLAYER.experience, confidence: 100,
  });

  // The hero headline reads the SAME row the table's bottom line is built
  // from, through the same helper the live card uses — so it can never
  // headline a number the table below it doesn't carry.
  const live = REGULAR[REGULAR.length - 1];
  const keyStats = headlineColumns(PLAYER.position).slice(0, 3);
  const attrs = attributeRows(PLAYER.position, TRUE_ATTRS);

  const hero = (
    <div className="flex flex-wrap items-start gap-6 p-6">
      <div
        className="relative shrink-0 rounded-lg p-3"
        style={{ background: `color-mix(in srgb, ${TEAM_COLOR} 14%, transparent)` }}
      >
        <PlayerAvatar
          seed={PLAYER.id} age={PLAYER.age} size={128} teamColor={TEAM_COLOR}
          weightLb={PLAYER.weightLb} heightIn={PLAYER.heightIn} position={PLAYER.position}
        />
      </div>

      <div className="flex-1 min-w-[280px]">
        <div className="label-sm flex items-center gap-2 flex-wrap">
          <span className={`font-semibold ${positionBadgeClass(PLAYER.position)}`}>{PLAYER.position}</span>
          <span>·</span><span>Age {PLAYER.age}</span>
          <span>·</span><span>Year {PLAYER.experience}</span>
          <span>·</span>
          <span className="flex items-center gap-1.5">
            <TeamLogo seed={TEAM.id} abbr={TEAM.abbr} size={14} />{TEAM.city} {TEAM.nickname}
          </span>
          <span className={`pill text-[10px] border-current ${label.className}`}>{label.label}</span>
          <span className="pill text-[10px] border-bad/50 text-bad bg-bad/10">
            {PLAYER.injury.type} · out {PLAYER.injury.weeks} wks
          </span>
        </div>

        <div className="mt-2">
          <div className="font-display font-bold text-xl uppercase tracking-[0.18em] text-muted leading-none">{PLAYER.first}</div>
          <div className="font-display font-extrabold text-5xl uppercase tracking-wide leading-[0.95] mt-1">{PLAYER.last}</div>
        </div>

        <div className="text-xs text-muted mt-2">
          {Math.floor(PLAYER.heightIn / 12)}&apos;{PLAYER.heightIn % 12}&quot; · {PLAYER.weightLb} lb · {PLAYER.college}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="pill border-warn/40 text-warn bg-warn/10 gap-1.5">
            {PLAYER.ringYears.length}× Champion
            <span className="text-muted font-normal">{PLAYER.ringYears[PLAYER.ringYears.length - 1]}</span>
          </span>
          <span className="pill border-line text-chalk gap-1.5">
            {PLAYER.allStarYears.length}× All-Star
            <span className="text-muted font-normal">{PLAYER.allStarYears[PLAYER.allStarYears.length - 1]}</span>
          </span>
        </div>

        <div className="flex items-stretch gap-6 mt-5 border-t border-line/50 pt-4 flex-wrap">
          <div className="pr-6 border-r border-line/40 self-center">
            <div className="label-sm">{SEASON_YEAR}</div>
            <div className="text-xs text-muted mt-1">Regular season</div>
          </div>
          {keyStats.map((c) => (
            <div key={c.key} className="pr-6 border-r border-line/40 last:border-r-0 last:pr-0">
              <div className="label-sm">{statLabel(c.key)}</div>
              <div className="stat-value text-stat-md leading-none mt-1">
                {(live.stats[c.key as keyof SeasonStats] ?? 0).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* The notched rating chip rather than a plain bordered box — the
          design system's own rating shape, at the size the hero deserves. */}
      <div className="flex flex-col items-center gap-3 shrink-0 w-[140px]">
        <RatingBadge value={OVR} label="Overall" size="lg" filled />
        <div className="panel p-3 w-full text-center">
          <div className="label-sm inline-flex items-center gap-1.5">
            Potential
            <Tooltip text={tip('potential')} />
          </div>
          <div className={`stat-value text-stat-md leading-none mt-1 ${ratingColor(PLAYER.potential)}`}>
            {PLAYER.potential}
          </div>
        </div>
      </div>
    </div>
  );

  /**
   * The contract's whole presence in the stats view: what he costs this season
   * and how long you have him. Both figures are the ones the ledger inside the
   * contract pane opens with — one `capHit()` call, one `yearsRemaining`,
   * rendered in two places.
   */
  const summary = (
    <>
      <div className="px-5 py-4">
        <div className="label-sm inline-flex items-center gap-1.5">
          Cap Hit {SEASON_YEAR}
          <Tooltip text={tip('capHit')} />
        </div>
        <div className="stat-value text-stat-sm leading-none mt-1.5">{formatMoney(hit)}</div>
        <div className="text-[11px] text-muted mt-1">{((hit / capTotal) * 100).toFixed(1)}% of cap</div>
      </div>
      <div className="px-5 py-4">
        <div className="label-sm inline-flex items-center gap-1.5">
          Years Left
          <Tooltip text={tip('expiringContract')} />
        </div>
        <div className="stat-value text-stat-sm leading-none mt-1.5">{CONTRACT.yearsRemaining}</div>
        <div className="text-[11px] text-muted mt-1">expires after {lastYear}</div>
      </div>
    </>
  );

  const stats = (
    <div className="space-y-6">
      <div className="section">
        <SectionHeading
          eyebrow="Year by year"
          title={showPlayoffs ? 'Career Stat Line — Postseason' : 'Career Stat Line'}
          action={<StatScopeToggle scope={scope} regularHref={scopeHref(false)} playoffHref={scopeHref(true)} />}
        />
        <div className="panel overflow-hidden">
          <CareerStatTable position={PLAYER.position} table={table} />
        </div>
      </div>

      {/* WHAT THE GRADE IS MADE OF, on the same tab as what he did with it.
          Ordered by share of the grade, so the two lines a GM should read
          first are the top two rather than wherever the alphabet put them. */}
      <div className="section">
        <SectionHeading
          eyebrow="What his grade is built on"
          title="Attributes"
          action={
            <span className={`text-xs font-semibold ${positionBadgeClass(PLAYER.position)}`}>
              {PLAYER.position} grade
            </span>
          }
        />
        {/* Down one column and then down the next, rather than across: the
            order IS the information here, and a row-major grid zig-zags it. */}
        <div className="panel p-5 grid sm:grid-cols-2 gap-x-8">
          {[attrs.slice(0, Math.ceil(attrs.length / 2)), attrs.slice(Math.ceil(attrs.length / 2))].map((col, i) => (
            <div key={i} className="space-y-3">
              {col.map((a) => (
                <div key={a.key} className="flex items-center gap-3">
                  <span className="text-sm text-muted w-32 shrink-0">{a.label}</span>
                  <div className="flex-1 h-1.5 bg-raised rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${a.share > 0 ? 'bg-accent2/70' : 'bg-line'}`}
                      style={{ width: `${a.value}%` }}
                    />
                  </div>
                  <span className={`text-sm font-mono w-8 text-right ${ratingColor(a.value)}`}>{a.value}</span>
                  <span className="text-xs font-mono w-9 text-right text-muted">
                    {a.share > 0 ? `${Math.round(a.share * 100)}%` : '—'}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const contract = (
    <div className="section">
      <SectionHeading
        eyebrow="Signed 2026"
        title="Contract"
        action={
          <span className="text-xs text-muted">
            {CONTRACT.years} years · through {CONTRACT.signedYear + CONTRACT.years - 1}
          </span>
        }
      />

      {/* THE DEAL AS SIGNED, then what it costs from here, then what you can
          do about it. Nothing in this row is repeated by the ledger below —
          the ledger owns cap hit, remaining value, guaranteed and dead money;
          this row owns the terms it was signed on. */}
      <div className="panel p-5 grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <StatNumber value={formatMoney(totalValue)} label="Total value" size="md" />
          <div className="text-[11px] text-muted mt-1">
            {formatMoney(Math.round(totalValue / CONTRACT.years))} a year across the deal
          </div>
        </div>
        <div>
          <StatNumber value={formatMoney(CONTRACT.signingBonus)} label="Signing bonus" size="md" tip={tip('proration')} />
          <div className="text-[11px] text-muted mt-1">
            {formatMoney(bonusPerYear)} a year on the cap through {bonusThrough}
          </div>
        </div>
        <div>
          <StatNumber
            value={`${formatMoney(market)}/yr`}
            label="Market value"
            size="md"
            tip={tip('marketValue')}
            color={valueTier === 'bargain' ? 'text-accent' : valueTier === 'overpay' ? 'text-bad' : 'text-chalk'}
          />
          <div className="text-[11px] text-muted mt-1">
            {valueTier === 'market'
              ? 'paid at market rate'
              : `${valueTier === 'bargain' ? 'surplus +' : 'over by '}${formatMoney(Math.abs(market - hit))}`}
          </div>
        </div>
      </div>

      <div className="panel p-5 space-y-4">
        <ContractLedger contract={CONTRACT} capMode={CAP_MODE} seasonYear={SEASON_YEAR} />

        <div className="pt-4 border-t border-line/60 space-y-3">
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary">Negotiate Extension</button>
            <button type="button" className="btn-secondary">Restructure</button>
            <button type="button" className="btn-danger">Release</button>
          </div>
          <p className="text-sm text-muted">
            A maximum restructure takes {formatMoney(restructureFrees)} off {SEASON_YEAR} and moves it into{' '}
            {SEASON_YEAR + 1} and {lastYear}.
          </p>
        </div>
      </div>
    </div>
  );

  return (
    <div className="max-w-5xl mx-auto px-6 py-10 space-y-10">
      <header>
        <div className="label-sm">Mockup — internal</div>
        <h1 className="font-display font-extrabold text-3xl uppercase tracking-wide mt-1">Player Card — Stats / Contract</h1>
        <p className="text-muted mt-2 max-w-2xl text-sm">
          One card, two faces. Stats are the default — season line and what he is graded on — and the
          contract lives behind the other tab, on the same band that carries this year&apos;s cap hit and his
          years left. Mock data only, no database reads: every dollar is computed by <code>lib/cap.ts</code>{' '}
          from one mock contract, and his overall by <code>computeOverall()</code> over the attributes shown.
        </p>
      </header>

      <div id="card-stats" className="space-y-3">
        <div className="label-sm">Default — stats</div>
        <PlayerCardShell
          teamColor={TEAM_COLOR} hero={hero} summary={summary}
          stats={stats} contract={contract} initialView="stats"
        />
      </div>

      <div id="card-contract" className="space-y-3">
        <div className="label-sm">Toggled — contract</div>
        <PlayerCardShell
          teamColor={TEAM_COLOR} hero={hero} summary={summary}
          stats={stats} contract={contract} initialView="contract"
        />
      </div>
    </div>
  );
}
