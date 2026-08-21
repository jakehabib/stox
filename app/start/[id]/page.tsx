import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { canViewLeague, currentViewer } from '@/lib/owner';
import { buildLeagueRatings } from '@/lib/teamRating';
import { TeamLogo } from '@/components/TeamLogo';
import { generateTeamLogoParams } from '@/lib/gen/teamLogo';
import { SiteHeader } from '@/components/ds/SiteHeader';
import type { PositionGroup } from '@/lib/positionGroups';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Your Franchise',
  robots: { index: false, follow: false },
};

const UNIT_LABEL: Record<PositionGroup, string> = {
  QB: 'Quarterback',
  RB: 'Backfield',
  WR: 'Receivers',
  TE: 'Tight Ends',
  OL: 'Offensive Line',
  DL: 'Defensive Line',
  LB: 'Linebackers',
  DB: 'Secondary',
  ST: 'Special Teams',
};

const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

/**
 * ===========================================================================
 * BEAT FOUR — THE HANDOVER
 * ===========================================================================
 * The league has just been generated and this is the first time the player
 * sees the club as it actually is, rather than as a crest on a picker. It
 * exists for one reason: this is the earliest moment a REAL team rating
 * exists, and showing it here is the honest answer to "put a rating on the
 * create screen."
 *
 * Everything on this page is read from `buildLeagueRatings`, the same
 * function the dashboard, the roster page and the win-probability estimate
 * use. The overall is the weighted starter average across all nine units; the
 * rank is that value's position among the 32 teams the league actually
 * generated. Nothing here is estimated, projected or scaled for effect — if
 * it says 4th, the dashboard says 4th.
 *
 * Why nothing like it appears one screen earlier, on the picker: rosters do
 * not exist until generation runs, so before this point every franchise is
 * statistically identical and any strength figure would be invented. See the
 * ordering note in components/CreateLeagueForm.tsx.
 *
 * FANTASY DRAFT leagues skip the rating entirely rather than showing one.
 * Every roster is empty at this point, so `buildLeagueRatings` would score
 * all 32 teams at replacement level — a real number that means nothing, which
 * is worse than no number.
 * ===========================================================================
 */
export default async function StartPage({ params }: { params: { id: string } }) {
  const league = await prisma.league.findUnique({
    where: { id: params.id },
    select: { id: true, name: true, seasonYear: true, phase: true, ownerKey: true, userId: true },
  });
  if (!league) notFound();
  // Same rule as everywhere else: a save you do not own is reported as
  // missing rather than as forbidden.
  if (!(await canViewLeague(league))) notFound();

  const [viewer, teams] = await Promise.all([
    currentViewer(),
    prisma.team.findMany({
      where: { leagueId: league.id },
      select: { id: true, abbr: true, city: true, nickname: true, conference: true, division: true, isUser: true },
      orderBy: { abbr: 'asc' },
    }),
  ]);

  const me = teams.find((t) => t.isUser);
  // Defensive: createLeague always flags a user team. If one somehow isn't
  // there, this page has nothing to say — send them straight into the game
  // rather than rendering a broken celebration.
  if (!me) redirect(`/league/${league.id}`);

  const fantasy = league.phase === 'FANTASY_DRAFT';
  const ratings = fantasy ? null : await buildLeagueRatings(league.id);
  const mine = ratings?.get(me.id);

  const accent = generateTeamLogoParams(me.abbr).primary;
  const rivals = teams.filter(
    (t) => t.conference === me.conference && t.division === me.division && t.id !== me.id,
  );

  const units = mine ? [...mine.units].sort((a, b) => a.rank - b.rank) : [];
  const best = units[0];
  const worst = units[units.length - 1];

  return (
    <div className="min-h-screen">
      <SiteHeader />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-5" style={{ ['--team-accent' as never]: accent }}>
        <section
          className="relative overflow-hidden rounded-lg border-2 shadow-elevated"
          style={{
            borderColor: accent,
            background: `radial-gradient(ellipse 110% 150% at 50% 0%, color-mix(in srgb, ${accent} 26%, transparent), transparent 70%)`,
          }}
        >
          <div
            className="absolute inset-0 opacity-[0.06] pointer-events-none"
            style={{
              backgroundImage:
                'repeating-linear-gradient(115deg, currentColor 0px, currentColor 1px, transparent 1px, transparent 14px)',
              color: accent,
            }}
          />
          <div className="relative px-6 py-9 sm:py-12 text-center">
            <TeamLogo
              seed={me.id}
              abbr={me.abbr}
              nickname={me.nickname}
              size={132}
              className="mx-auto drop-shadow motion-safe:animate-fadeUp"
            />
            <div className="label-sm mt-5">You are now the general manager of the</div>
            <h1 className="font-display font-extrabold uppercase tracking-wide leading-[0.92] mt-2 text-4xl sm:text-6xl text-team">
              {me.city}
              <br />
              {me.nickname}
            </h1>
            <p className="text-muted text-sm mt-4">
              {league.name} · {league.seasonYear} · {me.conference} {me.division}
            </p>
          </div>

          {mine ? (
            <div className="relative border-t border-line/60 grid grid-cols-2 lg:grid-cols-4 divide-x divide-y lg:divide-y-0 divide-line/40 bg-ink/40">
              <Fact label="Team overall" value={String(mine.overall)} detail={`${ordinal(mine.rank)} of 32`} team />
              <Fact label="Offense" value={String(mine.offense)} detail={offDefRankDetail(ratings!, me.id, 'offense')} />
              <Fact label="Defense" value={String(mine.defense)} detail={offDefRankDetail(ratings!, me.id, 'defense')} />
              <Fact
                label="Special teams"
                value={String(mine.specialTeams)}
                detail={`${ordinal(units.find((u) => u.group === 'ST')?.rank ?? 0)} of 32`}
              />
            </div>
          ) : (
            <div className="relative border-t border-line/60 px-6 py-5 bg-ink/40 text-center">
              <div className="label-sm">Fantasy draft</div>
              <p className="text-sm text-chalk/85 mt-1.5 max-w-xl mx-auto leading-relaxed">
                Every roster in the league is empty. There is no team rating yet because there is no team yet — you
                build one, pick by pick, starting now.
              </p>
            </div>
          )}
        </section>

        <div className={`grid gap-4 ${mine ? 'md:grid-cols-2' : ''}`}>
          {mine && (
            <section className="panel p-5">
              <div className="label-sm">The roster you inherit</div>
              <h2 className="font-display font-bold uppercase tracking-wide text-lg mt-1">Strengths and holes</h2>
              <dl className="mt-4 space-y-3">
                {best && (
                  <UnitLine
                    kicker="Best unit"
                    unit={UNIT_LABEL[best.group]}
                    rating={best.rating}
                    rank={best.rank}
                    good
                  />
                )}
                {worst && (
                  <UnitLine kicker="Weakest unit" unit={UNIT_LABEL[worst.group]} rating={worst.rating} rank={worst.rank} />
                )}
              </dl>
              <p className="text-[11px] text-muted mt-4 leading-relaxed">
                Overall is the weighted starter rating across all nine units — the same number your dashboard shows,
                and the same one the sim uses to set a win chance. Ranks are among the 32 clubs in this league.
              </p>
            </section>
          )}

          {/* Shown whether or not a rating exists. In a fantasy-draft league
              the division is the ONLY real thing about the club yet, and it is
              still the thing worth knowing: these are the three teams drafting
              against you and then playing you twice a year. */}
          <section className="panel p-5">
              <div className="label-sm">Twice a year, every year</div>
              <h2 className="font-display font-bold uppercase tracking-wide text-lg mt-1">
                {me.conference} {me.division}
              </h2>
              <ul className="mt-4 space-y-2.5">
                {rivals.map((r) => {
                  const rr = ratings?.get(r.id);
                  return (
                    <li key={r.id} className="flex items-center gap-3">
                      <TeamLogo seed={r.id} abbr={r.abbr} nickname={r.nickname} size={34} className="shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[11px] uppercase tracking-wider text-muted leading-tight truncate">
                          {r.city}
                        </span>
                        <span className="block font-display font-bold uppercase tracking-wide truncate leading-tight">
                          {r.nickname}
                        </span>
                      </span>
                      {rr && (
                        <span className="text-right shrink-0">
                          <span className="stat-value text-stat-sm block leading-none">{rr.overall}</span>
                          <span className="text-[10px] text-muted">{ordinal(rr.rank)}</span>
                        </span>
                      )}
                    </li>
                  );
                })}
            </ul>
          </section>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
          <Link href={`/league/${league.id}`} className="btn-primary text-base px-6 py-3">
            Enter the front office ▸
          </Link>
          <Link href="/" className="btn-ghost text-sm">Back to my franchises</Link>
        </div>

        {!viewer.userId && (
          <div className="rounded-md border border-line bg-card/50 px-5 py-4 text-center">
            <p className="text-sm text-muted">
              This dynasty lives in this browser only.{' '}
              <Link href={`/sign-up?next=/league/${league.id}`} className="text-accent2 hover:underline">
                Make an account
              </Link>{' '}
              and it survives a cleared cookie and follows you to another device.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

function Fact({
  label,
  value,
  detail,
  team,
}: {
  label: string;
  value: string;
  detail?: string;
  team?: boolean;
}) {
  return (
    <div className="px-4 py-4 text-center">
      <div className="label-sm">{label}</div>
      <div className={`stat-value text-stat-md leading-none mt-1.5${team ? ' text-team' : ''}`}>{value}</div>
      {detail && <div className="text-[11px] text-muted mt-1.5">{detail}</div>}
    </div>
  );
}

function UnitLine({
  kicker,
  unit,
  rating,
  rank,
  good,
}: {
  kicker: string;
  unit: string;
  rating: number;
  rank: number;
  good?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <dt className="label-sm">{kicker}</dt>
        <dd className={`font-display font-bold uppercase tracking-wide text-lg leading-tight ${good ? 'text-team' : ''}`}>
          {unit}
        </dd>
      </div>
      <div className="text-right shrink-0">
        <div className="stat-value text-stat-sm leading-none">{rating}</div>
        <div className="text-[11px] text-muted mt-1">{ordinal(rank)} of 32</div>
      </div>
    </div>
  );
}

/**
 * Offense/defense rank, computed here rather than read off TeamRating — that
 * type carries a league rank for the OVERALL and for each unit, but not for
 * the two composites. Ranking them on the spot from the same map is the only
 * way the number under "Offense" is the rank of the number above it (see
 * principle 6: if you display a rank, it must be the rank of the grade you
 * displayed).
 */
function offDefRankDetail(
  ratings: Map<string, { teamId: string; offense: number; defense: number }>,
  teamId: string,
  key: 'offense' | 'defense',
): string {
  const all = [...ratings.values()].sort((a, b) => b[key] - a[key]);
  const idx = all.findIndex((t) => t.teamId === teamId);
  return idx < 0 ? '' : `${ordinal(idx + 1)} of ${all.length}`;
}
