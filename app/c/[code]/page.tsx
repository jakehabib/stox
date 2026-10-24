import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/ds/SiteHeader';
import { ChallengeTakeJob } from '@/components/ChallengeTakeJob';
import { CostLimitError, assertCostBudget } from '@/lib/costLimit';
import { SAVE_LIMITS, describeSituation } from '@/lib/saveFile';
import {
  CHALLENGE_NOT_FOUND,
  PUBLICATION_RETENTION_MONTHS,
  resolveChallenge,
} from '@/lib/savePublication';
import { formatShareCode, normalizeShareCode } from '@/lib/shareCode';
import { maxLeaguesPerOwner } from '@/lib/owner';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'A Challenge · Dynasty GM Football',
  description: 'Take over a situation from a Dynasty GM challenge code.',
  /**
   * NOT INDEXED, the same decision as "no gallery". A crawler that followed a
   * code posted in a public channel would put somebody's save into a search
   * index, which is a directory of user-published saves assembled by somebody
   * else — exactly the thing this feature refuses to build itself.
   */
  robots: { index: false, follow: false },
};

/**
 * ===========================================================================
 * /c/[code] — the brief, and the offer to take the job
 * ===========================================================================
 *
 * ONE READ, NOT TWO. The league-file card at /l/[code] decompresses the stored
 * file as well as reading the row, because its recipient needs a wall of
 * crests to pick a club from. A challenge has no picker — the club is the
 * offer — so everything on this page comes off indexed columns that were
 * counted off the file once, at publish time, by `summarizeSaveFile`. A
 * fifteen-megabyte gunzip on a page view that exists to show nine facts would
 * be a denial of service with a nice card on it.
 *
 * THE CEILING IS ON THE RENDER AS WELL AS ON THE ROUTE. This page is a lookup;
 * without a ceiling here an attacker would simply walk codes against the
 * cheaper of the two surfaces. A render cannot mint the `dgm_owner` cookie
 * (Next only allows that in an action or a route handler), so a first-time
 * visitor is counted per address — which is the bucket that bounds a guesser
 * anyway. See CODE_LOOKUP in lib/costLimit.ts.
 * ===========================================================================
 */
export default async function ChallengePage({ params }: { params: { code: string } }) {
  try {
    await assertCostBudget('CODE_LOOKUP');
  } catch (err) {
    if (err instanceof CostLimitError) return <Refusal title="Too many codes" body={err.message} />;
    throw err;
  }

  const preview = await resolveChallenge(params.code);
  if (!preview) {
    // ONE SENTENCE FOR ALL SIX MISSES — mistyped, never published, withdrawn,
    // taken down, expired, or a league-file code at the challenge door. The
    // shown code is the NORMALISED one where that was possible, so somebody
    // who typed an O where a 0 belongs can see what we read.
    const shown = normalizeShareCode(params.code);
    return (
      <Refusal
        title="No such code"
        body={CHALLENGE_NOT_FOUND}
        detail={shown ? `Read as ${formatShareCode(shown)}.` : undefined}
      />
    );
  }

  const situation = describeSituation(preview);

  return (
    <div className="min-h-screen">
      <SiteHeader />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-5">
        <div className="panel p-5 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div className="min-w-0">
              <div className="label-sm">The situation</div>
              <h1 className="font-display font-extrabold text-3xl sm:text-4xl uppercase tracking-wide leading-none mt-1 break-words">
                {preview.challengeTitle || preview.leagueName}
              </h1>
              <p className="text-muted text-sm mt-2">
                Set by {preview.publisher} on {preview.publishedAt.toISOString().slice(0, 10)}.
              </p>
            </div>
            {/* The code, grouped, so a recipient can check it against whatever
                they were sent. `tabular-nums` so the groups line up and
                `break-all` so it never pushes the page sideways at 390px. */}
            <code className="font-mono text-accent2 text-lg tabular-nums break-all">
              {formatShareCode(preview.code)}
            </code>
          </div>

          <div className="flex flex-wrap gap-3">
            {/* Publishing refuses a save with no club flagged as the GM's
                (/api/save/publish), so a null here can only be a row from
                before that check. Named rather than hidden. */}
            <Fact label="The club" value={preview.teamName ?? 'not recorded'} />
            <Fact label="Record" value={preview.record ?? '—'} />
            <Fact label="Where" value={situation} />
            <Fact label="On the books" value={`${preview.rosteredPlayers} rostered`} />
            <Fact label="Free agents" value={String(preview.freeAgents)} />
            <Fact label="History" value={preview.carriesHistory ? 'carried' : 'not carried'} />
          </div>

          {preview.challengeBrief.length > 0 && (
            <blockquote className="border-l-2 border-accent/50 pl-4 text-sm text-chalk/90 leading-relaxed max-w-2xl">
              {preview.challengeBrief}
            </blockquote>
          )}
        </div>

        <ChallengeTakeJob
          code={preview.code}
          defaultName={preview.leagueName}
          clubName={preview.teamName}
          maxNameLength={SAVE_LIMITS.MAX_LEAGUE_NAME}
        />

        <div className="panel p-4 space-y-2">
          <h2 className="label-sm">What you are getting, and what you are not</h2>
          <ul className="text-sm text-muted space-y-1.5">
            <li>
              · The roster, every contract, the cap ledger, the draft picks this club still owns, the standings
              and the season to date. The situation, exactly as it stands.
            </li>
            <li>
              · None of {preview.publisher}&apos;s career. Their record, badges, dynasty level and place on the
              board stay theirs; your tenure starts this season at nought and nought.
            </li>
            <li>
              · None of their scouting book either. What they paid to find out about this year&apos;s class is
              their work, and your scouts start fresh.
            </li>
            <li>
              · {preview.carriesHistory
                ? 'Career stat lines, franchise records and the trophy cabinet came across with it.'
                : 'No career stat lines, franchise records or trophy cabinet — the publisher left the history behind, '
                  + 'so the record books start empty. The save plays exactly the same.'}
            </li>
            <li>
              · A code is anyone with the link. {preview.publisher} can withdraw it at any time, and it lapses{' '}
              {PUBLICATION_RETENTION_MONTHS} months after the last time anybody opened it.
            </li>
            <li>
              · No account needed. One keeps the save if you clear cookies or switch device. Your own saves are
              capped at {maxLeaguesPerOwner()}; delete one from your franchise list if you are full.
            </li>
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
 * again, or go and find another challenge.
 */
function Refusal({ title, body, detail }: { title: string; body: string; detail?: string }) {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="max-w-xl mx-auto px-4 sm:px-6 py-12 space-y-4">
        <div className="panel p-5 space-y-3">
          <h1 className="font-display font-extrabold text-2xl uppercase tracking-wide leading-none">{title}</h1>
          <p className="text-sm text-muted leading-relaxed">{body}</p>
          {detail && <p className="text-xs text-muted font-mono break-all">{detail}</p>}
          {/* STATIC COPY, NOT A LOOKUP — see the matching note on /l/[code].
              This page never says which kind a failed code was. */}
          <p className="text-sm text-muted leading-relaxed">
            Were you handed an authored league rather than a situation — thirty-two franchises and a fresh
            preseason? Those open from the league import screen.
          </p>
          <div className="flex flex-wrap gap-3 pt-1">
            <Link href="/challenges" className="btn-primary">Back to challenges</Link>
            <Link href="/import" className="btn-ghost text-sm">Upload a league file</Link>
            <Link href="/new" className="btn-ghost text-sm">Start a dynasty instead</Link>
          </div>
        </div>
      </main>
    </div>
  );
}
