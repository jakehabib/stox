import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/ds/SiteHeader';
import { RedeemCodeForm } from '@/components/RedeemCodeForm';
import type { FranchiseSeed } from '@/components/ds/FranchiseWall';
import { CostLimitError, assertCostBudget } from '@/lib/costLimit';
import {
  CODE_NOT_FOUND,
  PUBLICATION_RETENTION_MONTHS,
  readPublishedFile,
  resolvePublication,
} from '@/lib/publication';
import { formatShareCode, normalizeShareCode } from '@/lib/shareCode';
import { LeagueFileError } from '@/lib/leagueFile';
import { maxLeaguesPerOwner } from '@/lib/owner';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'A Shared League · Dynasty GM Football',
  description: 'Start a league from a Dynasty GM share code.',
  /**
   * NOT INDEXED, and this is the same decision as "no gallery". A crawler that
   * followed a code posted in a public channel would put a published league
   * into a search index, which is a directory of user-authored leagues
   * assembled by somebody else — exactly the thing this feature refuses to
   * build itself.
   */
  robots: { index: false, follow: false },
};

/**
 * ===========================================================================
 * /l/[code] — what a code contains, and the offer to play it
 * ===========================================================================
 *
 * ITS OWN ROUTE, not a field on the import page. A recipient arrives here from
 * a link somebody pasted, knowing nothing about this app, and the only
 * question in front of them is "do I want this league". Everything about
 * authoring, spreadsheets, format versions and byte limits belongs on /import
 * and would be noise here.
 *
 * TWO READS, BOTH METERED AS ONE LOOKUP. `resolvePublication` gives the
 * preview card off indexed columns and stamps the code as opened (which is
 * what holds the expiry clock back). `readPublishedFile` then decompresses the
 * stored file for one reason only: the franchise picker. Choosing a club out
 * of a wall of crests is the first act of this game, and a code's recipient
 * should not get a worse version of it than somebody uploading the same file.
 * It costs a gunzip and a parse of about a megabyte on a page view that is
 * already rate-limited; the alternative was a second copy of the team list in
 * a database column, which is a second place for it to be wrong.
 *
 * WHAT IT PROMISES, AND WHAT IT DOES NOT. The copy says plainly that a code is
 * "anyone with the link" — it is in URLs, browser history and Discord logs —
 * because this page cannot make it private and must not imply that it is.
 * ===========================================================================
 */
export default async function SharedLeaguePage({ params }: { params: { code: string } }) {
  // THE GUESS CEILING, on the page render as well as on the redeem route. This
  // page is a lookup: without a ceiling here, an attacker would simply walk
  // codes against the cheaper of the two surfaces. A render cannot mint the
  // `dgm_owner` cookie (Next only allows that in an action or a route
  // handler), so a first-time visitor is counted per address — which is the
  // bucket that bounds a guesser anyway. See CODE_LOOKUP in lib/costLimit.ts.
  try {
    await assertCostBudget('CODE_LOOKUP');
  } catch (err) {
    if (err instanceof CostLimitError) return <Refusal title="Too many codes" body={err.message} />;
    throw err;
  }

  const preview = await resolvePublication(params.code);
  if (!preview) {
    // One sentence for all four misses — mistyped, never published, withdrawn,
    // expired. The shown code is the NORMALISED one where that was possible,
    // so somebody who typed an O where a 0 belongs can see what we read.
    const shown = normalizeShareCode(params.code);
    return (
      <Refusal
        title="No such code"
        body={CODE_NOT_FOUND}
        detail={shown ? `Read as ${formatShareCode(shown)}.` : undefined}
      />
    );
  }

  let seeds: FranchiseSeed[];
  try {
    const file = await readPublishedFile(preview.code);
    if (!file) return <Refusal title="No such code" body={CODE_NOT_FOUND} />;
    seeds = file.teams.map((t) => ({
      city: t.city,
      nickname: t.nickname,
      abbr: t.abbr,
      conference: t.conference,
      division: t.division,
    }));
  } catch (err) {
    if (err instanceof LeagueFileError) {
      return (
        <Refusal
          title="This file no longer reads"
          body={
            'That league was published in a format this version can no longer read. Ask whoever shared it to '
            + 'publish it again.'
          }
          detail={err.message}
        />
      );
    }
    throw err;
  }

  const rostersAuthored = preview.rosteredPlayers > 0;

  return (
    <div className="min-h-screen">
      <SiteHeader />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-5">
        <div className="panel p-5 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div className="min-w-0">
              <div className="label-sm">Shared league</div>
              <h1 className="font-display font-extrabold text-3xl sm:text-4xl uppercase tracking-wide leading-none mt-1 break-words">
                {preview.leagueName}
              </h1>
              <p className="text-muted text-sm mt-2">
                Published by {preview.publisher} on{' '}
                {preview.publishedAt.toISOString().slice(0, 10)}.
              </p>
            </div>
            {/* The code, in the grouped form, so a recipient can check it
                against whatever they were sent. `tabular-nums` so the groups
                line up and `break-all` so it never pushes the page sideways
                at 390px. */}
            <code className="font-mono text-accent2 text-lg tabular-nums break-all">
              {formatShareCode(preview.code)}
            </code>
          </div>

          <div className="flex flex-wrap gap-3">
            <Fact label="Franchises" value={String(preview.teamCount)} />
            <Fact
              label="Rostered players"
              value={rostersAuthored ? String(preview.rosteredPlayers) : 'none — generated'}
            />
            <Fact
              label="Free agents"
              value={preview.freeAgents > 0 ? String(preview.freeAgents) : 'none — generated'}
            />
            <Fact label="College class" value={preview.hasDraftClass ? 'included' : 'generated'} />
          </div>

          <p className="text-sm text-muted leading-relaxed max-w-2xl">
            Taking this job copies the league into your own save. It is a starting point, not a save game: you
            get these franchises, these players and these contracts in a fresh preseason, with your own
            schedule, standings and scouting book from there.
          </p>
        </div>

        <RedeemCodeForm code={preview.code} defaultName={preview.leagueName} seeds={seeds} />

        <div className="panel p-4 space-y-2">
          <h2 className="label-sm">About this code</h2>
          <ul className="text-sm text-muted space-y-1.5">
            <li>
              · A code is anyone with the link. It travels in URLs, browser history and whatever channel it was
              pasted into, so treat it as public rather than private.
            </li>
            <li>
              · {preview.publisher} can withdraw it at any time, and it lapses{' '}
              {PUBLICATION_RETENTION_MONTHS} months after the last time anybody opened it.
            </li>
            <li>· You do not need an account to play it. One keeps the save if you clear cookies or switch device.</li>
            <li>· A save of your own is capped at {maxLeaguesPerOwner()}; delete one from your franchise list if you are full.</li>
          </ul>
        </div>
      </main>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line bg-raised/40 px-3 py-2 min-w-[7.5rem]">
      <div className="label-sm">{label}</div>
      <div className="text-chalk text-sm mt-0.5">{value}</div>
    </div>
  );
}

/**
 * Every dead end on this route, in one shape. A refusal names what blocked it
 * and offers the two things a person can actually do next: ask for the code
 * again, or use the file path, which needs nothing from this office at all.
 */
function Refusal({ title, body, detail }: { title: string; body: string; detail?: string }) {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-10 sm:py-16">
        <div className="panel p-6 sm:p-8 space-y-4">
          <div className="label-sm text-warn">{title}</div>
          <p className="text-sm text-chalk/90 leading-relaxed">{body}</p>
          {detail && <p className="text-xs text-muted break-words">{detail}</p>}
          <p className="text-sm text-muted">
            A league file works with no code at all — if whoever shared this can export the file, you can upload
            it yourself.
          </p>
          <div className="flex flex-wrap gap-3 pt-1">
            <Link href="/import" className="btn-secondary">Upload a league file</Link>
            <Link href="/" className="btn-ghost">My franchises</Link>
          </div>
        </div>
      </main>
    </div>
  );
}
