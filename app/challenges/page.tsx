import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/ds/SiteHeader';
import { ChallengeCodeEntry } from '@/components/ChallengeCodeEntry';
import { ChallengePublishPanel, PublishableSave, PublishedChallenge } from '@/components/ChallengePublishPanel';
import { prisma } from '@/lib/db';
import { currentViewer, ownedLeagueWhere } from '@/lib/owner';
import { SAVE_LIMITS, describeSituation } from '@/lib/saveFile';
import {
  MAX_CHALLENGES_PER_USER,
  PUBLICATION_RETENTION_MONTHS,
  listChallengesForUser,
} from '@/lib/savePublication';
import { formatShareCode } from '@/lib/shareCode';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Challenges · Dynasty GM Football',
  description: 'Take over a situation somebody else got themselves into, or set one.',
};

/**
 * ===========================================================================
 * /challenges — a situation, not a starting point
 * ===========================================================================
 *
 * ITS OWN SECTION, deliberately not a tab on /import. The two things read as
 * the same feature from the outside and are opposites from the inside:
 *
 *   A LEAGUE FILE is a starting point somebody AUTHORED. Thirty-two
 *   franchises, rosters, maybe a college class, and a fresh preseason. There
 *   is no year, no record, no cap ledger and no history, because none of it
 *   has happened yet. The question in front of its recipient is "do I want
 *   this league".
 *
 *   A CHALLENGE is a situation somebody GOT THEMSELVES INTO. A specific club,
 *   a specific record, a specific cap sheet and a specific missing
 *   first-rounder, mid-season, with three years of standings behind it. The
 *   question in front of its recipient is "can I fix this".
 *
 * Folding them together would mean one screen explaining both, one set of
 * copy hedging between them, and a recipient who cannot tell which one they
 * were handed. Two sections, two codes, two readers, two sets of caps.
 *
 * WHAT NOBODY GETS: the publisher's career. A recipient arrives as the new
 * hire — the roster, the money and the standings are inherited, the record,
 * the badges, the dynasty level and the rank-board row are not. That is both
 * the privacy answer and the better game, and the copy below says so plainly
 * rather than leaving it to be discovered.
 * ===========================================================================
 */
export default async function ChallengesPage() {
  const viewer = await currentViewer();

  // The caller's own saves, through the same predicate every other listing in
  // the app uses. A save belonging to somebody else is not in this list and
  // the publish route would refuse it anyway.
  const leagues = await prisma.league.findMany({
    where: await ownedLeagueWhere(),
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, name: true, seasonYear: true, phase: true, week: true,
      teams: { where: { isUser: true }, select: { abbr: true, wins: true, losses: true, ties: true } },
    },
  });

  const saves: PublishableSave[] = leagues.map((l) => {
    const club = l.teams[0];
    return {
      id: l.id,
      name: l.name,
      // The same sentence the recipient's card will show, out of the same
      // function — see describeSituation in lib/saveFile.ts.
      situation: describeSituation({
        teamAbbr: club?.abbr ?? null,
        record: club ? `${club.wins}-${club.losses}${club.ties > 0 ? `-${club.ties}` : ''}` : null,
        phase: l.phase,
        week: l.week,
        seasonYear: l.seasonYear,
      }),
    };
  });

  const challenges: PublishedChallenge[] = viewer.userId
    ? (await listChallengesForUser(viewer.userId)).map((c) => ({
      code: c.code,
      display: formatShareCode(c.code),
      title: c.challengeTitle ?? c.leagueName,
      situation: describeSituation({
        teamAbbr: c.saveTeamAbbr,
        record: c.saveRecord,
        phase: c.savePhase ?? 'PRESEASON',
        week: c.saveWeek ?? 1,
        seasonYear: c.saveSeasonYear ?? 0,
      }),
      carriesHistory: c.saveHistory ?? false,
      size: `${(c.fileBytes / 1_048_576).toFixed(1)}MB`,
      openCount: c.openCount,
      publishedOn: c.createdAt.toISOString().slice(0, 10),
      expiresOn: c.expiresAt.toISOString().slice(0, 10),
    }))
    : [];

  return (
    <div className="min-h-screen">
      <SiteHeader />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-5">
        <div className="panel p-5 sm:p-6 space-y-4">
          <div>
            <div className="label-sm">Challenges</div>
            <h1 className="font-display font-extrabold text-3xl sm:text-4xl uppercase tracking-wide leading-none mt-1">
              Somebody Else&apos;s Mess
            </h1>
          </div>
          <p className="text-sm text-muted leading-relaxed max-w-2xl">
            A challenge is a save handed over mid-situation. You are 2-9, you have no cap room and you traded
            the first-rounder — fix it. You inherit the roster, the money, the picks and the standings. You do
            not inherit the last GM&apos;s record, his badges, his dynasty level or his place on the board: your
            tenure starts the day you walk in.
          </p>
          <p className="text-sm text-muted leading-relaxed max-w-2xl">
            Two GMs can take the same code and play it forward from the same week, which is the point of it.
            Compare what you did with the same roster and the same ledger.
          </p>
          <p className="text-xs text-muted">
            Looking for an authored league rather than a situation —&nbsp;thirty-two franchises and a fresh
            preseason? That is <Link href="/import" className="text-accent2 hover:underline">Import a league</Link>.
          </p>
        </div>

        <div className="panel p-5 space-y-4">
          <div>
            <h2 className="font-display font-extrabold text-2xl uppercase tracking-wide leading-none">
              Been Handed a Code
            </h2>
            <p className="text-muted text-sm mt-2">
              Ten characters. No account needed to play one.
            </p>
          </div>
          <ChallengeCodeEntry />
        </div>

        <ChallengePublishPanel
          saves={saves}
          signedIn={viewer.userId != null}
          challenges={challenges}
          retentionMonths={PUBLICATION_RETENTION_MONTHS}
          maxChallenges={MAX_CHALLENGES_PER_USER}
          maxTitle={SAVE_LIMITS.MAX_CHALLENGE_TITLE}
          maxBrief={SAVE_LIMITS.MAX_CHALLENGE_BRIEF}
        />
      </main>
    </div>
  );
}
