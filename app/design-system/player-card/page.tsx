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
import { playerLabel, ratingColor } from '@/lib/ratings';
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
 * than a section further down it? The default view is his production and two
 * money figures — what he costs this year, how long he is under contract —
 * and the switch on the same band opens the whole deal in place: the schedule
 * year by year, what is guaranteed, what walking away costs, the bonus, the
 * void year, and the two moves you can make on it.
 *
 * EVERY DOLLAR ON THIS PAGE COMES OUT OF lib/cap.ts, evaluated against the one
 * mock contract below — the same functions the sim charges. The two figures on
 * the band and the ledger inside the contract pane are not two copies of a
 * number, they are one call to `capHit()` rendered twice. The career row of
 * the stat table is likewise summed from the season rows above it rather than
 * typed in, so the table cannot disagree with itself.
 * ===========================================================================
 */

const TEAM = { id: 'demo-nyg', abbr: 'NYG', city: 'New York', nickname: 'Giants' };
const TEAM_COLOR = generateTeamLogoParams(TEAM.id).primary;

/** The league year this card is being read in, and the year the league opened. */
const SEASON_YEAR = 2027;
const LEAGUE_START_YEAR = 2026;

const PLAYER = {
  id: 'demo-card-wr',
  first: 'Elijah',
  last: 'Ward',
  position: 'WR' as Position,
  age: 27,
  /** Seasons completed — 2022 through 2026. */
  experience: 5,
  heightIn: 74,
  weightLb: 205,
  college: 'Oregon',
  ovr: 90,
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
  const market = marketValue({ ovr: PLAYER.ovr, position: PLAYER.position, age: PLAYER.age, potential: PLAYER.potential });
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
    ovr: PLAYER.ovr, potential: PLAYER.potential, experience: PLAYER.experience, confidence: 100,
  });

  // The hero headline reads the SAME row the table's bottom line is built
  // from, through the same helper the live card uses — so it can never
  // headline a number the table below it doesn't carry.
  const live = REGULAR[REGULAR.length - 1];
  const keyStats = headlineColumns(PLAYER.position).slice(0, 3);

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
        <RatingBadge value={PLAYER.ovr} label="Overall" size="lg" filled />
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
   * The contract's whole presence in the default view: what he costs this
   * season and how long you have him. Both figures are the ones the ledger
   * inside the contract pane opens with — one `capHit()` call, one
   * `yearsRemaining`, rendered in two places.
   */
  const summary = (
    <>
      <div className="px-4 py-3">
        <div className="label-sm inline-flex items-center gap-1.5">
          Cap Hit {SEASON_YEAR}
          <Tooltip text={tip('capHit')} />
        </div>
        <div className="stat-value text-stat-sm leading-none mt-1">{formatMoney(hit)}</div>
        <div className="text-[11px] text-muted mt-1">{((hit / capTotal) * 100).toFixed(1)}% of cap</div>
      </div>
      <div className="px-4 py-3">
        <div className="label-sm inline-flex items-center gap-1.5">
          Years Left
          <Tooltip text={tip('expiringContract')} />
        </div>
        <div className="stat-value text-stat-sm leading-none mt-1">{CONTRACT.yearsRemaining}</div>
        <div className="text-[11px] text-muted mt-1">expires after {lastYear}</div>
      </div>
    </>
  );

  const production = (
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
        <h1 className="font-display font-extrabold text-3xl uppercase tracking-wide mt-1">Player Card — Production / Contract</h1>
        <p className="text-muted mt-2 max-w-2xl text-sm">
          One card, two faces. Production is the default; the contract lives behind the switch on the same
          band that carries this year&apos;s cap hit and his years left. Mock data only — no database reads —
          but every dollar is computed by <code>lib/cap.ts</code> from a single mock contract.
        </p>
      </header>

      <div id="card-production" className="space-y-3">
        <div className="label-sm">Default — production</div>
        <PlayerCardShell
          teamColor={TEAM_COLOR} hero={hero} summary={summary}
          production={production} contract={contract} initialView="production"
        />
      </div>

      <div id="card-contract" className="space-y-3">
        <div className="label-sm">Toggled — contract</div>
        <PlayerCardShell
          teamColor={TEAM_COLOR} hero={hero} summary={summary}
          production={production} contract={contract} initialView="contract"
        />
      </div>
    </div>
  );
}
