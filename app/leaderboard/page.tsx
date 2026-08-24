import Link from 'next/link';
import type { Metadata } from 'next';
import { PageMasthead } from '@/components/ds/PageMasthead';
import { SectionHeading } from '@/components/ds/SectionHeading';
import { SiteHeader } from '@/components/ds/SiteHeader';
import { TeamLogo } from '@/components/TeamLogo';
import { currentViewer } from '@/lib/owner';
import {
  LEADERBOARD_CAVEAT,
  PER_SEASON_MIN_SEASONS,
  REBUILD_SORT_BLURB,
  SORTS,
  parseSort,
  readLeaderboard,
  refreshFootballRanks,
  sportLabel,
  type LeaderboardRow,
  type LeaderboardSort,
} from '@/lib/leaderboard';

export const metadata: Metadata = {
  title: 'Dynasty Leaderboard',
  description: 'Public GM progression across every Dynasty GM franchise. Levels, championships and the seasons they took.',
};

// The board is a live read of every eligible save and it is different for a
// signed-in viewer (their own row is marked). Never statically rendered.
export const dynamic = 'force-dynamic';

/**
 * THE PUBLIC LEADERBOARD.
 *
 * Readable with no account and no session — the entire point is that it can be
 * pasted into a group chat. What a signed-out visitor CANNOT do is appear on
 * it, and the page says so rather than leaving them to work it out.
 *
 * The design decisions live in lib/leaderboard.ts. What this file owes the
 * reader is the honest framing: a rank, next to the seasons it took, next to a
 * plain statement of what a single-player simulation's numbers are worth.
 */
export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: { sort?: string; sport?: string };
}) {
  const sort = parseSort(searchParams.sort);

  // Derive every published row from franchise history BEFORE reading the
  // board, in this request. See refreshFootballRanks() for why this is not a
  // cron job: a stored XP total is only trustworthy if nothing could have
  // changed since it was derived, and the only moment that holds is now.
  await refreshFootballRanks();

  const [viewer, board] = await Promise.all([
    currentViewer(),
    readLeaderboard({ sort, sport: searchParams.sport ?? null }),
  ]);

  // Sport tabs appear only once a second sport has actually published a row.
  // Offering a "Baseball" tab before baseball exists is its own kind of lying
  // metric — the schema is ready for it, the UI does not claim it is here.
  const multiSport = board.sports.length > 1;

  const mine = viewer.userId ? board.rows.find((r) => r.userId === viewer.userId) : undefined;
  const topLevel = board.rows.length > 0 ? Math.max(...board.rows.map((r) => r.level.level)) : 0;

  const sortDef = SORTS.find((s) => s.id === sort)!;

  return (
    <div className="min-h-screen">
      <SiteHeader />

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-5">
        <PageMasthead
          eyebrow="Public board"
          title="Dynasty Leaderboard"
          subtitle={
            <>
              Every general manager who has chosen to be listed, ranked by what their best franchise has actually
              achieved. Open to anyone — no account needed to read it.
            </>
          }
          facts={[
            { label: 'GMs Listed', value: String(board.totals.gms) },
            { label: 'Top Level', value: topLevel > 0 ? String(topLevel) : '—', color: topLevel > 0 ? 'text-accent' : undefined },
            { label: 'Championships', value: String(board.totals.championships), detail: 'won by listed GMs' },
            { label: 'Seasons Played', value: board.totals.seasons.toLocaleString(), detail: 'the denominator' },
            ...(sort === 'REBUILD'
              ? [{
                label: 'Fastest Rebuild',
                value: board.rows.length > 0 ? String(board.rows[0].seasonsToTitle ?? '—') : '—',
                detail: 'seasons, worst roster to champion',
                color: board.rows.length > 0 ? 'text-gold' : undefined,
              }]
              : []),
          ]}
        />

        {/* THE HONEST LABEL. Above the table, not under it, and not in a
            tooltip: someone who reads only the first thing on this page should
            still come away knowing what the numbers are. */}
        <div className="panel p-4 border-warn/30">
          <div className="label-sm text-warn">What this board is</div>
          <p className="text-sm text-chalk/90 mt-1.5 leading-relaxed max-w-3xl">{LEADERBOARD_CAVEAT}</p>
          {/* THE SAME HONESTY NOTE, FOR THE ONE COLUMN THE CAVEAT ABOVE DOES
              NOT DESCRIBE. Everything else here can be padded by playing
              longer, and the caveat is about that; this column cannot, and its
              risk is the opposite one — a small number that does not say what
              it excludes. So it says it, in the same place and at the same
              weight, rather than in the tab blurb alone. */}
          {sort === 'REBUILD' && (
            <p className="text-sm text-chalk/90 mt-3 pt-3 border-t border-line/60 leading-relaxed max-w-3xl">
              {REBUILD_SORT_BLURB}
            </p>
          )}
        </div>

        {/* Sort tabs -------------------------------------------------------- */}
        <div className="section">
          <div className="flex flex-wrap items-center gap-1">
            {SORTS.map((s) => (
              <Link
                key={s.id}
                href={sortHref(s.id, searchParams.sport)}
                className={`${s.id === sort ? 'nav-link-active' : 'nav-link'} whitespace-nowrap font-semibold text-sm`}
              >
                {s.label}
              </Link>
            ))}
          </div>
          <p className="text-xs text-muted">{sortDef.blurb}</p>

          {multiSport && (
            <div className="flex flex-wrap items-center gap-1 pt-1">
              <Link
                href={sortHref(sort, undefined)}
                className={`pill ${!board.sport ? 'bg-accent/15 text-accent border-accent/30' : 'text-muted'}`}
              >
                All sports
              </Link>
              {board.sports.map((sp) => (
                <Link
                  key={sp}
                  href={sortHref(sort, sp)}
                  className={`pill ${board.sport === sp ? 'bg-accent/15 text-accent border-accent/30' : 'text-muted'}`}
                >
                  {sportLabel(sp)}
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* The board -------------------------------------------------------- */}
        {board.rows.length === 0 ? (
          <div className="panel p-8 text-center">
            <div className="font-display font-bold uppercase tracking-wide text-xl">Nobody is listed yet</div>
            <p className="text-sm text-muted mt-2 max-w-md mx-auto">
              {sort === 'PER_SEASON'
                ? `This board needs ${PER_SEASON_MIN_SEASONS} completed seasons before a per-season rate means anything. Nobody has qualified yet.`
                : sort === 'REBUILD'
                  /* Not "nobody has played one" — runs may well be under way.
                     What is true is that none has FINISHED, and saying which
                     is the difference between an empty board and a wrong one. */
                  ? 'Nobody has taken the worst roster in football and won a championship with it yet. A run only appears here once the title is on the books.'
                  : 'The board is empty because it is opt-in and brand new. Be the first franchise on it.'}
            </p>
          </div>
        ) : (
          <div className="panel divide-y divide-line/60 overflow-hidden">
            {board.rows.map((row) => (
              <BoardRow key={`${row.sport}:${row.saveKey}`} row={row} sort={sort} isViewer={row.userId === viewer.userId} multiSport={multiSport} />
            ))}
          </div>
        )}

        {/* Who can be here, and how ------------------------------------------ */}
        <div className="section">
          <SectionHeading eyebrow="Getting on the board" title="How a GM gets listed" />
          {!viewer.userId ? (
            /* THE SIGNED-OUT CASE. This is the page a stranger lands on from a
               shared link, so it is where the reason to make an account is
               actually worth stating — and the reason is a fact about the
               model, not a marketing line. */
            <div className="panel p-5 border-accent/30">
              <div className="label-sm text-accent">You are not signed in</div>
              <p className="text-sm text-chalk/90 mt-1.5 leading-relaxed max-w-3xl">
                You can read this board all day without an account. You cannot appear on it.
                A save made while signed out belongs to a cookie in your browser and nothing else — there is no
                durable identity to attach a rank to, and clearing that cookie takes the save with it. Make an
                account and the franchise you already have moves onto it; then one toggle publishes it here.
              </p>
              <div className="flex flex-wrap items-center gap-2 mt-4">
                <Link href="/sign-up?next=/account" className="btn-primary">Create an account</Link>
                <Link href="/sign-in?next=/account" className="btn-ghost text-sm">Sign in</Link>
              </div>
              <p className="text-xs text-muted mt-3">
                Listing is off by default. Signing up does not put you here.
              </p>
            </div>
          ) : mine ? (
            <div className="panel p-5 border-accent/30">
              <div className="label-sm text-accent">You are listed</div>
              <p className="text-sm text-chalk/90 mt-1.5">
                <strong className="font-semibold">{viewer.username}</strong> sits at{' '}
                <strong className="font-semibold">#{mine.rank}</strong> on this board with the {mine.teamName} —
                level {mine.level.level} across {mine.seasons} completed season{mine.seasons === 1 ? '' : 's'}.
              </p>
              <Link href="/account" className="btn-secondary text-sm mt-4 inline-flex">Account settings</Link>
            </div>
          ) : (
            <div className="panel p-5">
              <div className="label-sm">You are not listed</div>
              <p className="text-sm text-chalk/90 mt-1.5 max-w-3xl">
                Signed in as <strong className="font-semibold">{viewer.username}</strong>. Appearing here is opt-in and
                off by default — your username, your franchise and its record are only published once you say so.
                You can see exactly what the board would show about you before you decide.
              </p>
              <Link href="/account" className="btn-primary text-sm mt-4 inline-flex">Review and publish →</Link>
            </div>
          )}
        </div>

        {/* The multi-sport promise, stated once and honestly ---------------- */}
        {!multiSport && (
          <p className="text-xs text-muted max-w-3xl">
            One sport is playing today. The board is built around a sport column and a shared account, so when a second
            game arrives its GMs join this table rather than getting a table of their own — and a combined view appears
            here the moment there is something to combine.
          </p>
        )}
      </main>
    </div>
  );
}

function sortHref(sort: LeaderboardSort, sport: string | undefined): string {
  const params = new URLSearchParams();
  if (sort !== 'LEVEL') params.set('sort', sort);
  if (sport) params.set('sport', sport);
  const qs = params.toString();
  return qs ? `/leaderboard?${qs}` : '/leaderboard';
}

/**
 * One GM's row.
 *
 * Carries a crest and a monogram because a name without a mark reads as a row
 * key (README design principle 2), and carries `seasons` at the same weight as
 * the level because a level without its denominator is the lie this whole
 * feature had to be designed around.
 */
function BoardRow({
  row, sort, isViewer, multiSport,
}: {
  row: LeaderboardRow;
  sort: LeaderboardSort;
  isViewer: boolean;
  multiSport: boolean;
}) {
  const medal = row.rank <= 3;

  return (
    <div
      className={`flex items-center gap-3 sm:gap-4 px-4 sm:px-5 py-3.5 border-l-2 ${
        isViewer ? 'bg-accent/[0.07] border-l-accent' : 'border-l-transparent'
      }`}
    >
      {/* Rank */}
      <div className="w-9 sm:w-11 shrink-0 text-center">
        <div
          className={`stat-value leading-none ${medal ? 'text-stat-md text-gold' : 'text-stat-sm text-muted'}`}
        >
          {row.rank}
        </div>
      </div>

      {/* Crest — the franchise reads as a franchise, not a string. */}
      <TeamLogo seed={row.crestSeed} abbr={row.teamAbbr} size={40} className="shrink-0 hidden sm:block" />

      {/* GM and franchise */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className="w-5 h-5 rounded-full bg-accent2/15 border border-accent2/30 flex items-center justify-center text-accent2 text-[10px] font-display font-bold shrink-0"
            aria-hidden
          >
            {row.username.slice(0, 1).toUpperCase()}
          </div>
          <span className="font-display font-bold uppercase tracking-wide truncate">{row.username}</span>
          {isViewer && <span className="pill bg-accent/15 text-accent border-accent/30 shrink-0">You</span>}
        </div>
        <div className="text-sm text-muted truncate mt-0.5">{row.teamName}</div>
        {/* THE DENOMINATOR. Always present, on every breakpoint. */}
        <div className="text-xs text-muted mt-1 tabular-nums">
          {row.seasons} season{row.seasons === 1 ? '' : 's'} · {row.wins}-{row.losses}
          {row.championships > 0 && (
            <span className="text-gold"> · {row.championships} title{row.championships === 1 ? '' : 's'}</span>
          )}
          {multiSport && <span> · {sportLabel(row.sport)}</span>}
        </div>
      </div>

      {/* The metric being sorted on, at display scale, plus the level always. */}
      <div className="shrink-0 text-right">
        {sort === 'REBUILD' ? (
          <>
            {/* The whole point of the column, at display scale. `seasonsToTitle`
                is never null on this board — readLeaderboard filters the sort
                to rows that have one — and the em dash is the honest render if
                that ever stops being true, rather than a 0 or an Infinity. */}
            <div className="stat-value text-stat-sm leading-none text-gold">
              {row.seasonsToTitle ?? '—'}
            </div>
            <div className="label-sm mt-1">{row.seasonsToTitle === 1 ? 'Season' : 'Seasons'}</div>
            <div className="text-xs text-muted mt-0.5">to first title</div>
          </>
        ) : sort === 'PER_SEASON' ? (
          <>
            <div className="stat-value text-stat-sm leading-none text-accent">
              {Math.round(row.xpPerSeason ?? 0).toLocaleString()}
            </div>
            <div className="label-sm mt-1">XP / season</div>
            <div className="text-xs text-muted mt-0.5">Level {row.level.level}</div>
          </>
        ) : sort === 'TITLES' ? (
          <>
            <div className="stat-value text-stat-sm leading-none text-gold">{row.championships}</div>
            <div className="label-sm mt-1">Titles</div>
            <div className="text-xs text-muted mt-0.5">Level {row.level.level}</div>
          </>
        ) : (
          <>
            <div className="stat-value text-stat-sm leading-none text-accent">{row.level.level}</div>
            <div className="label-sm mt-1">Level</div>
            <div className="text-xs text-muted mt-0.5 tabular-nums">{row.xp.toLocaleString()} XP</div>
          </>
        )}
      </div>
    </div>
  );
}
