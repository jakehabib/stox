import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { PageMasthead } from '@/components/ds/PageMasthead';
import { SectionHeading } from '@/components/ds/SectionHeading';
import { SiteHeader } from '@/components/ds/SiteHeader';
import { TeamLogo } from '@/components/TeamLogo';
import { ChangePasswordForm } from '@/components/auth/ChangePasswordForm';
import { changePasswordAction, setLeaderboardVisibilityAction } from '@/app/actions/account';
import { signOutAction } from '@/app/actions/auth';
import { getSessionUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { MIN_PASSWORD_LENGTH } from '@/lib/password';
import { ownStanding } from '@/lib/leaderboard';

export const metadata: Metadata = { title: 'Account' };

export const dynamic = 'force-dynamic';

/**
 * ACCOUNT SETTINGS.
 *
 * Two things live here, and both were gaps rather than nice-to-haves:
 *
 *   1. THE LEADERBOARD TOGGLE. Publishing is opt-in and off by default, so
 *      there has to be somewhere to say yes. The block below shows the exact
 *      row a stranger would see — the franchise, the level, the seasons, the
 *      position it would land in — BEFORE the toggle is flipped, because
 *      consent to publish something you have not been shown is not consent.
 *
 *   2. THE PASSWORD CHANGE. The accounts build shipped with recovery being
 *      "an operator sets your password and tells you what it is"
 *      (scripts/resetPassword.ts). That leaves a tester holding a credential
 *      somebody else chose and very likely typed into a chat window, with no
 *      way to replace it. This is that way.
 */
export default async function AccountPage() {
  const user = await getSessionUser();
  // A settings page for nobody is a sign-in prompt. `next` brings them back
  // here afterwards; safeNext in app/actions/auth.ts refuses anything that is
  // not a plain same-site path.
  if (!user) redirect('/sign-in?next=/account');

  const [record, standing, leagueCount] = await Promise.all([
    prisma.user.findUnique({
      where: { id: user.id },
      select: { createdAt: true, leaderboardOptIn: true, passwordHash: true },
    }),
    ownStanding(user.id),
    prisma.league.count({ where: { userId: user.id } }),
  ]);

  const listed = record?.leaderboardOptIn ?? false;
  const hasPassword = !!record?.passwordHash;
  const best = standing.best;

  return (
    <div className="min-h-screen">
      <SiteHeader />

      <main className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        <PageMasthead
          eyebrow="Account"
          title={user.username}
          subtitle="Who you are on this deployment, what the public board shows about you, and the password that gets you back in."
          facts={[
            { label: 'Saves', value: String(leagueCount), detail: leagueCount === 1 ? 'franchise on this account' : 'franchises on this account' },
            {
              label: 'Public board',
              value: listed ? 'Listed' : 'Private',
              detail: listed ? `Ranked #${standing.rank ?? '—'}` : 'Nobody can see you',
              color: listed ? 'text-accent' : 'text-muted',
            },
            {
              label: 'Member since',
              value: record ? record.createdAt.toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) : '—',
            },
          ]}
        />

        {/* --- Leaderboard ------------------------------------------------- */}
        <div className="section">
          <SectionHeading
            eyebrow="Privacy"
            title="Public leaderboard"
            action={<Link href="/leaderboard" className="btn-ghost text-xs">View the board →</Link>}
          />

          <div className="panel p-5 space-y-4">
            <p className="text-sm text-chalk/90 leading-relaxed">
              The leaderboard at <span className="font-semibold">/leaderboard</span> is public: anyone with the link
              reads it, signed in or not. You are <strong className="font-semibold">{listed ? 'listed on it' : 'not on it'}</strong>.
              {' '}Listing is off by default and turning it off again deletes your rows rather than hiding them.
            </p>

            <div className="rounded-md border border-line/70 bg-raised/40 px-4 py-3">
              <div className="label-sm mb-2">
                {listed ? 'What people currently see' : 'What people would see'}
              </div>
              {best ? (
                <div className="flex items-center gap-3">
                  <TeamLogo seed={best.crestSeed} abbr={best.teamAbbr} size={40} className="shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="font-display font-bold uppercase tracking-wide truncate">{user.username}</div>
                    <div className="text-sm text-muted truncate">{best.teamName}</div>
                    <div className="text-xs text-muted mt-0.5 tabular-nums">
                      {best.seasons} season{best.seasons === 1 ? '' : 's'} · {best.wins}-{best.losses}
                      {best.championships > 0 && (
                        <span className="text-gold"> · {best.championships} title{best.championships === 1 ? '' : 's'}</span>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="stat-value text-stat-sm leading-none text-accent">{best.level.level}</div>
                    <div className="label-sm mt-1">Level</div>
                    <div className="text-xs text-muted mt-0.5 tabular-nums">{best.xp.toLocaleString()} XP</div>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted">
                  Nothing yet — you have no franchise on this account with a team in it. Start a league and play a
                  week; your best save is the one that would be published.
                </p>
              )}

              {best && (
                <p className="text-xs text-muted mt-3">
                  {standing.eligibleSaves > 1 && (
                    <>
                      Your best of {standing.eligibleSaves} saves represents you — a GM appears once, not once per
                      league.{' '}
                    </>
                  )}
                  {listed
                    ? `Currently ranked #${standing.rank ?? standing.wouldBeRank}.`
                    : `Publishing now would put you at about #${standing.wouldBeRank}.`}{' '}
                  Your username and this franchise&apos;s record are the only things published. Rosters, trades and
                  anything inside the save stay private.
                </p>
              )}
            </div>

            {/* THE REBUILD BOARD, WHICH IS THE ONE PLACE AN UNFINISHED RUN IS
                SHOWN AT ALL. The public board lists only climbs that ended in
                a title; here the run can honestly be called unfinished, with
                the seasons it has taken so far, instead of being given a rank
                it has not earned. Rendered only when this account has
                something to say about it — an empty panel advertising a mode
                is clutter. */}
            {(standing.rebuild.best || standing.rebuild.inProgress > 0) && (
              <div className="rounded-md border border-line/70 bg-raised/40 px-4 py-3">
                <div className="label-sm mb-2">The Rebuild board</div>
                {standing.rebuild.best ? (
                  <p className="text-sm text-chalk/90">
                    You took the {standing.rebuild.best.teamName} from the worst roster in football to a
                    championship in{' '}
                    <strong className="font-semibold text-gold">
                      {standing.rebuild.best.seasonsToTitle}
                      {standing.rebuild.best.seasonsToTitle === 1 ? ' season' : ' seasons'}
                    </strong>
                    .{' '}
                    {listed
                      ? `That sits at about #${standing.rebuild.wouldBeRank} on the Rebuild board.`
                      : `Publishing would put it at about #${standing.rebuild.wouldBeRank} on the Rebuild board.`}
                  </p>
                ) : (
                  <p className="text-sm text-muted">
                    {standing.rebuild.inProgress === 1 ? 'A rebuild run is' : `${standing.rebuild.inProgress} rebuild runs are`}
                    {' '}under way —{' '}
                    {standing.rebuild.inProgressSeasons.map((n) => `${n} season${n === 1 ? '' : 's'}`).join(', ')}{' '}
                    on the books. Nothing about an unfinished run is published: it appears on that board the
                    season you win the title, with the number of seasons it took, and not before.
                  </p>
                )}
              </div>
            )}

            {/* A plain form posting a Server Action — no client component, so
                this works with JavaScript disabled, same as sign-out.
                The state travels on the BUTTON rather than in a checkbox: an
                unchecked checkbox submits nothing at all, so the action would
                have to read "no field" as "off", and a request that lost a
                field in transit would silently unpublish somebody. One button,
                one explicit value, one meaning. */}
            <form action={setLeaderboardVisibilityAction}>
              {listed ? (
                <>
                  <button className="btn-secondary" name="listed" value="off" type="submit">
                    Remove me from the leaderboard
                  </button>
                  <p className="text-xs text-muted mt-2">Deletes your published rows. You can put them back any time.</p>
                </>
              ) : (
                <>
                  <button className="btn-primary" name="listed" value="on" type="submit">
                    Publish me on the leaderboard
                  </button>
                  <p className="text-xs text-muted mt-2">Publishes your username and the franchise shown above.</p>
                </>
              )}
            </form>
          </div>
        </div>

        {/* --- Password ----------------------------------------------------- */}
        <div className="section">
          <SectionHeading eyebrow="Security" title="Change password" />
          <div className="panel p-5">
            {hasPassword ? (
              <ChangePasswordForm action={changePasswordAction} minLength={MIN_PASSWORD_LENGTH} />
            ) : (
              /* Unreachable today — nothing creates a passwordless account yet
                 — but `User.passwordHash` is nullable on purpose for the OAuth
                 door, and a form whose current-password field can never be
                 satisfied is worse than a sentence saying so. */
              <p className="text-sm text-muted">
                This account has no password set, so there is nothing to change.
              </p>
            )}
          </div>
        </div>

        {/* --- Sign out ------------------------------------------------------ */}
        <div className="section">
          <SectionHeading eyebrow="Session" title="Sign out" />
          <div className="panel p-5 flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm text-muted max-w-md">
              Ends this session on the server, not just in this browser. Your saves stay attached to the account.
            </p>
            <form action={signOutAction}>
              <button className="btn-secondary">Sign out</button>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}
