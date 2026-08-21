import Link from 'next/link';
import { currentViewer, listOwnedLeagues } from '@/lib/owner';
import { deleteLeagueAction } from './actions/league';
import { TEAM_SEEDS } from '@/lib/gen/names';
import { PHASE_LABELS } from '@/lib/season';
import { TeamLogo } from '@/components/TeamLogo';
import { generateTeamLogoParams } from '@/lib/gen/teamLogo';
import { CrestDrift, FranchiseWall } from '@/components/ds/FranchiseWall';
import { SiteHeader } from '@/components/ds/SiteHeader';

export const dynamic = 'force-dynamic';

/** How many saves the front door shows before it stops being a front door. */
const VISIBLE_SAVES = 6;

/**
 * ===========================================================================
 * THE FRONT DOOR
 * ===========================================================================
 * This page answers two completely different questions and used to answer
 * them with one layout: "what is this?" for someone opening a link a friend
 * sent them, and "where was I?" for someone coming back to a dynasty.
 *
 * So it has two states, chosen by whether this viewer has any saves at all:
 *
 *   NO SAVES  -> the pitch. One screen: what the game is, in the game's own
 *                voice, over the yard-line texture, with all 32 crests as the
 *                argument. Every crest is a live entry into team select.
 *   HAS SAVES -> the franchises, first thing, above everything else. Someone
 *                who has already played does not need to be sold to, and
 *                making them scroll past a pitch to reach a Continue button
 *                is the single most annoying thing a landing page can do.
 *
 * Signing in is never required at any point on this page. The cookie
 * ownership model in lib/owner.ts works, and a wall in front of a
 * single-player game costs every tester who was only ever going to click
 * once.
 * ===========================================================================
 */
export default async function HomePage({
  searchParams,
}: {
  searchParams: { claimed?: string; all?: string };
}) {
  // Scoped to this viewer's saves — see lib/owner.ts. This used to be an
  // unfiltered findMany, which on any shared deployment listed every tester's
  // franchises to every other tester.
  const [viewer, leagues] = await Promise.all([currentViewer(), listOwnedLeagues()]);

  // Set by the sign-in/sign-up redirect. Parsed defensively — it is a query
  // string, so it is whatever anyone types, and the only thing it controls is
  // a sentence.
  const claimedRaw = Number(searchParams.claimed);
  const claimed = Number.isInteger(claimedRaw) && claimedRaw > 0 ? claimedRaw : 0;

  const showAll = searchParams.all === '1';
  const shown = showAll ? leagues : leagues.slice(0, VISIBLE_SAVES);
  const hidden = leagues.length - shown.length;

  const returning = leagues.length > 0;

  return (
    <div className="min-h-screen">
      <SiteHeader />

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10 space-y-8">
        {/* Proof, at the moment it happens. The pitch for making an account is
            "you won't lose these", so the claim says exactly how many moved
            rather than leaving the player to check. */}
        {claimed > 0 && (
          <div className="rounded-md border border-accent/40 bg-accent/10 px-5 py-4">
            <div className="label-sm text-accent">Saves secured</div>
            <p className="text-sm text-chalk/90 mt-1">
              {claimed === 1 ? 'One save on this browser is' : `${claimed} saves on this browser are`} now attached to{' '}
              <strong className="font-semibold">{viewer.username}</strong>. Clearing cookies won&apos;t lose{' '}
              {claimed === 1 ? 'it' : 'them'}, and you can sign in on another device to keep playing.
            </p>
          </div>
        )}

        {returning ? (
          <ReturningView
            leagues={shown}
            total={leagues.length}
            hidden={hidden}
            username={viewer.username}
            signedIn={Boolean(viewer.userId)}
          />
        ) : (
          <PitchView signedIn={Boolean(viewer.userId)} />
        )}
      </main>

      <footer className="max-w-6xl mx-auto px-4 sm:px-6 pb-10 pt-4 border-t border-line/60 mt-4">
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted">
          <span>Fictional league. No real teams, players or logos anywhere in this game.</span>
          <div className="flex items-center gap-4">
            <Link href="/new" className="hover:text-chalk">New dynasty</Link>
            <Link href="/import" className="hover:text-chalk">Import a league</Link>
            {!viewer.userId && <Link href="/sign-in" className="hover:text-chalk">Sign in</Link>}
          </div>
        </div>
      </footer>
    </div>
  );
}

/* -------------------------------------------------------------------------
   State 1 — never played here before
   ------------------------------------------------------------------------- */

function PitchView({ signedIn }: { signedIn: boolean }) {
  return (
    <>
      <section className="relative overflow-hidden rounded-lg border border-line bg-card/40 px-6 sm:px-10 py-10 sm:py-12">
        {/* The same yard-line texture the app background uses, at higher
            contrast — a field under stadium lights, not a hero gradient. */}
        <div
          className="absolute inset-0 opacity-[0.06] pointer-events-none"
          style={{
            backgroundImage:
              'repeating-linear-gradient(90deg, currentColor 0px, currentColor 1px, transparent 1px, transparent 72px)',
            color: '#f4f6fa',
          }}
        />
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse 90% 120% at 15% 0%, rgba(74,222,128,0.10), transparent 65%)' }}
        />
        <CrestDrift seeds={TEAM_SEEDS} />
        <div className="relative max-w-xl">
          <div className="label-sm text-accent">Front Office Simulator</div>
          <h1 className="font-display font-extrabold uppercase tracking-wide leading-[0.92] mt-2 text-5xl sm:text-7xl">
            Dynasty GM
            <br />
            Football
          </h1>
          <p className="text-chalk/80 mt-5 text-base sm:text-lg leading-relaxed">
            You take the chair. Thirty-two clubs, about fifteen hundred generated players, a salary cap that remembers
            every promise you made, and a draft class nobody has scouted yet.
          </p>
          <p className="text-muted mt-3 text-sm sm:text-base leading-relaxed">
            Sim the season a week at a time. Work the phones at the deadline. Find out how long you can keep a winner
            together.
          </p>

          <div className="flex flex-wrap items-center gap-2.5 mt-7">
            <Link href="/new" className="btn-primary text-base px-5 py-2.5">Pick your franchise ▸</Link>
            <Link href="/import" className="btn-secondary">Import a league</Link>
          </div>
          <p className="text-xs text-muted mt-3">
            {signedIn
              ? 'Your saves are attached to your account and follow you to any device.'
              : 'No account needed — start playing now. Sign up later and your saves come with you.'}
          </p>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <div className="section-eyebrow">32 clubs, one chair</div>
            <h2 className="section-title">Choose who you run</h2>
          </div>
          <Link href="/new" className="btn-tertiary text-xs">See the full board →</Link>
        </div>
        <FranchiseWall seeds={TEAM_SEEDS} hrefFor={(s) => `/new?team=${s.abbr}`} />
      </section>

      <section className="grid sm:grid-cols-3 gap-3">
        <JobCard
          kicker="The Draft"
          title="Scout all year"
          body="A 300-prospect class you can browse from week one — behind real fog of war, so your board can be wrong until you spend the points to find out."
        />
        <JobCard
          kicker="The Cap"
          title="Every deal comes back"
          body="Signing bonuses prorate. Cuts leave dead money. Void years borrow against a season you have not played yet."
        />
        <JobCard
          kicker="Sunday"
          title="Sixteen games a week"
          body="Drive-by-drive simulation, a full box score and a written recap for every game in the league, not just yours."
        />
      </section>
    </>
  );
}

function JobCard({ kicker, title, body }: { kicker: string; title: string; body: string }) {
  return (
    <div className="panel p-4">
      <div className="label-sm text-accent2">{kicker}</div>
      <h3 className="font-display font-bold uppercase tracking-wide text-lg mt-1 leading-none">{title}</h3>
      <p className="text-sm text-muted mt-2 leading-relaxed">{body}</p>
    </div>
  );
}

/* -------------------------------------------------------------------------
   State 2 — has saves
   ------------------------------------------------------------------------- */

type OwnedLeague = Awaited<ReturnType<typeof listOwnedLeagues>>[number];

function ReturningView({
  leagues,
  total,
  hidden,
  username,
  signedIn,
}: {
  leagues: OwnedLeague[];
  total: number;
  hidden: number;
  username: string | null;
  signedIn: boolean;
}) {
  const lead = leagues[0];
  const leadTeam = lead?.teams[0];
  const accent = leadTeam ? generateTeamLogoParams(leadTeam.abbr).primary : undefined;

  return (
    <>
      <section
        className="relative overflow-hidden rounded-lg border-2"
        style={{
          ['--team-accent' as never]: accent,
          borderColor: accent ?? undefined,
          background: accent
            ? `radial-gradient(ellipse 110% 150% at 100% 0%, color-mix(in srgb, ${accent} 20%, transparent), transparent 68%)`
            : undefined,
        }}
      >
        <div
          className="absolute inset-0 opacity-[0.05] pointer-events-none"
          style={{
            backgroundImage:
              'repeating-linear-gradient(115deg, currentColor 0px, currentColor 1px, transparent 1px, transparent 14px)',
            color: accent ?? '#f4f6fa',
          }}
        />
        {leadTeam && (
          <TeamLogo
            seed={leadTeam.id}
            abbr={leadTeam.abbr}
            nickname={leadTeam.nickname}
            size={220}
            className="watermark-logo opacity-[0.07] -right-12 -top-12"
          />
        )}
        <div className="relative px-6 py-6 flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <div className="label-sm">{signedIn && username ? `Signed in as ${username}` : 'Welcome back'}</div>
            <h1
              className={`font-display font-extrabold uppercase tracking-wide leading-none mt-1.5 text-4xl sm:text-5xl${
                accent ? ' text-team' : ''
              }`}
            >
              Your Franchises
            </h1>
            <p className="text-muted text-sm mt-2">
              {total === 1 ? 'One dynasty in progress.' : `${total} dynasties in progress.`} Pick up where you left off.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <Link href="/new" className="btn-primary">Start another ▸</Link>
            <Link href="/import" className="btn-secondary">Import a league</Link>
          </div>
        </div>
      </section>

      {/* The invitation. Only shown when there is something to lose — telling
          somebody with no saves that their saves are at risk is noise. */}
      {!signedIn && (
        <div className="rounded-md border border-warn/40 bg-warn/10 px-5 py-4 flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="label-sm text-warn">This browser is the only copy</div>
            <p className="text-sm text-chalk/90 mt-1 max-w-2xl">
              {total === 1 ? 'Your save lives' : 'Your saves live'} in a cookie on this browser. Clear it and{' '}
              {total === 1 ? 'it is' : 'they are'} gone. Make an account and {total === 1 ? 'it moves' : 'they move'}{' '}
              with you.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link href="/sign-up" className="btn-primary">Save my dynasty</Link>
            <Link href="/sign-in" className="btn-ghost text-sm">Sign in</Link>
          </div>
        </div>
      )}

      <div className="panel divide-y divide-line/60">
        {leagues.map((l) => {
          const team = l.teams[0];
          const teamAccent = team ? generateTeamLogoParams(team.abbr).primary : undefined;
          return (
            <div
              key={l.id}
              className="flex items-center gap-4 px-4 sm:px-5 py-4 border-l-2"
              style={{ borderLeftColor: teamAccent ?? 'transparent' }}
            >
              {team ? (
                <TeamLogo seed={team.id} abbr={team.abbr} nickname={team.nickname} size={44} className="shrink-0" />
              ) : (
                <div className="w-11 h-11 rounded-full bg-raised shrink-0" />
              )}
              {/* League name leads: with several saves it's the only thing
                  that tells them apart (the franchise can repeat). Team
                  identity sits under it as the evocative line. */}
              <div className="min-w-0 flex-1">
                <div className="label-sm truncate">{l.name}</div>
                <div className="font-display font-bold text-lg uppercase tracking-wide truncate mt-0.5">
                  {team ? `${team.city} ${team.nickname}` : 'No team'}
                </div>
                <div className="text-xs text-muted mt-0.5">
                  {l.seasonYear} · Week {l.week} · {PHASE_LABELS[l.phase] ?? l.phase}
                  {team && ` · ${team.wins}-${team.losses}${team.ties ? `-${team.ties}` : ''}`}
                </div>
              </div>
              <Link href={`/league/${l.id}`} className="btn-primary shrink-0">Continue ▸</Link>
              <form action={deleteLeagueAction.bind(null, l.id)} className="shrink-0 hidden sm:block">
                <button className="btn-ghost text-xs" title="Delete league">Delete</button>
              </form>
            </div>
          );
        })}
      </div>

      {hidden > 0 && (
        <div className="text-center">
          <Link href="/?all=1" className="btn-ghost text-xs">Show {hidden} older {hidden === 1 ? 'save' : 'saves'}</Link>
        </div>
      )}

      <section className="section">
        <div className="section-head">
          <div>
            <div className="section-eyebrow">32 clubs, one chair</div>
            <h2 className="section-title">Take over somebody else</h2>
          </div>
          <Link href="/new" className="btn-tertiary text-xs">See the full board →</Link>
        </div>
        <FranchiseWall seeds={TEAM_SEEDS} hrefFor={(s) => `/new?team=${s.abbr}`} size={46} />
      </section>
    </>
  );
}
