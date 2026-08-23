'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { fillRosterAction, previewFillRosterAction } from '@/app/actions/roster';
import type { FillRosterPlan, FillRosterSigning } from '@/lib/freeagency';
import { formatMoney } from '@/lib/cap';

/** "CB", "CB or S", "CB, S or LB" — a list a person would say out loud. */
function joinWords(words: string[], conj: string): string {
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} ${conj} ${words[words.length - 1]}`;
}

/**
 * FILL ROSTER — AND IT SAYS WHO AND FOR HOW MUCH FIRST.
 *
 * This used to be one click straight into the server action. The playtest
 * audit filed it as Tier 1 — *"One curiosity click deletes 80% of a new
 * player's cap in 3 seconds with no undo"* — and the pre-launch review said
 * the same thing again in §9: *"no dialog, no preview, no undo"*. It is the
 * most prominent control on the roster page and it spent money.
 *
 * The sheet follows StartDraftButton's shape rather than a modal: ask in
 * place, name the consequence, offer the way out. Two differences from that
 * one, both deliberate.
 *
 *   IT ALWAYS ASKS. StartDraftButton skips its confirm when there is nothing
 *   to warn about, on the reasoning that a confirm which always fires is a
 *   confirm nobody reads. Here the sheet is not a warning, it is the ANSWER —
 *   the user cannot otherwise find out who is available at that price or what
 *   they cost, and that answer is the whole feature the two reviews asked for.
 *
 *   IT NAMES WHAT IT IS NOT DOING. A position where nobody will play for the
 *   minimum stays empty, and saying so is more use than a shorter list with no
 *   explanation for the gap.
 *
 * The plan is a preview only. Pressing through re-derives it on the server and
 * signs that — see previewFillRosterAction — so nothing here is trusted.
 */
export function FillRosterButton({ leagueId, teamId }: { leagueId: string; teamId: string }) {
  const [plan, setPlan] = useState<FillRosterPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState<{ signed: FillRosterSigning[]; missed: string[] } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const router = useRouter();

  const preview = async () => {
    setLoading(true);
    setDone(null);
    setFailure(null);
    try {
      setPlan(await previewFillRosterAction(leagueId, teamId));
    } catch (err) {
      setFailure(err instanceof Error ? err.message : 'Could not check the wire just now.');
    } finally {
      setLoading(false);
    }
  };

  const commit = () => startTransition(async () => {
    try {
      const r = await fillRosterAction(leagueId, teamId);
      setDone({ signed: r.signed, missed: r.missed });
      setPlan(null);
      router.refresh();
    } catch (err) {
      setFailure(err instanceof Error ? err.message : 'Those signings could not be completed.');
    }
  });

  if (!plan) {
    return (
      <div className="flex flex-col items-end gap-1.5">
        <button onClick={preview} disabled={loading || pending} className="btn-secondary text-sm">
          {loading ? 'Checking the wire…' : 'Fill Roster'}
        </button>
        {failure && <div className="text-xs text-bad text-right max-w-xs">{failure}</div>}
        {done && (
          <div className="text-xs text-muted text-right max-w-xs space-y-1">
            {done.signed.length === 0
              ? <div>Nobody signed.</div>
              : <div>Signed {done.signed.length}: {done.signed.map((s) => `${s.name} (${s.position})`).join(', ')}. One year each, no bonus — release any of them for nothing.</div>}
            {done.missed.length > 0 && <div className="text-warn">{done.missed.join(' · ')}</div>}
          </div>
        )}
      </div>
    );
  }

  const passedPositions = plan.passed.map((p) => p.position);
  const nothingToDo = plan.signings.length === 0;

  return (
    <div className="panel border-line p-4 space-y-3 max-w-sm text-left">
      <div className="label-sm">Fill Roster · one-year minimum deals</div>

      {nothingToDo ? (
        <p className="text-sm text-chalk/90 leading-snug">
          {plan.stoppedBy
            ? plan.stoppedBy
            : plan.passed.length > 0
              ? `Nobody on the wire will play ${joinWords(passedPositions, 'or')} for the minimum right now.`
              : 'Nothing to do here — no position on your roster is thin enough to be worth a camp body.'}
          {' '}Fill Roster only offers the veteran minimum on a one-year deal. Anyone better than that is
          a negotiation, on the free agency board.
        </p>
      ) : (
        <>
          <p className="text-sm text-chalk/90 leading-snug">
            {plan.signings.length === 1
              ? 'One man at or near the league minimum, one year, no signing bonus and nothing guaranteed. You can release him tomorrow and it costs you nothing.'
              : `${plan.signings.length} men at or near the league minimum, one year each, no signing bonus and nothing guaranteed. You can release any of them tomorrow and it costs you nothing.`}
          </p>

          <div className="space-y-1 text-sm">
            {plan.signings.map((s) => (
              <div key={s.playerId} className="flex justify-between gap-3">
                <span className="truncate">
                  <span className="text-muted font-mono text-xs mr-1.5">{s.position}</span>
                  {s.name}
                  <span className="text-muted text-xs ml-1.5">{s.age}</span>
                </span>
                <span className="font-mono whitespace-nowrap">{formatMoney(s.apy)} · 1 yr</span>
              </div>
            ))}
          </div>

          {plan.capEnabled && (
            <div className="space-y-1 text-sm pt-2 border-t border-line/60">
              <div className="flex justify-between">
                <span className="text-muted">Against this year&rsquo;s cap</span>
                <span className="font-mono">{formatMoney(plan.totalCapHit)}</span>
              </div>
              {/* BEFORE AS WELL AS AFTER, the same as the release sheet: this app
                  has always told you what a number IS and never what it changed
                  by, and one figure on its own is not a decision. */}
              <div className="flex justify-between">
                <span className="text-muted">Your cap space now</span>
                <span className="font-mono text-muted">{formatMoney(plan.capSpaceBefore)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Cap space left after</span>
                <span className={`font-mono font-semibold ${plan.capSpaceAfter >= 0 ? 'text-accent' : 'text-bad'}`}>
                  {formatMoney(plan.capSpaceAfter)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Dead money if you cut them all</span>
                {/* Read off the built contracts, never asserted. It is zero because
                    these deals carry no bonus and no guarantee, and that is the
                    single fact the app owner needed this button to be honest about. */}
                <span className="font-mono">{formatMoney(plan.signings.reduce((a, s) => a + s.deadMoneyIfCut, 0))}</span>
              </div>
            </div>
          )}

          <div className="text-xs text-muted leading-snug">
            {plan.rosterCount} on the roster, {plan.rosterMax} allowed, {plan.rosterMin} the league minimum.
            {passedPositions.length > 0 && ` No takers at the minimum for ${joinWords(passedPositions, 'or')} — ${passedPositions.length === 1 ? 'that spot stays' : 'those spots stay'} open.`}
            {plan.stoppedBy && ` ${plan.stoppedBy}`}
          </div>
        </>
      )}

      {failure && <div className="text-xs text-bad">{failure}</div>}

      <div className="flex items-center gap-2 flex-wrap">
        {!nothingToDo && (
          <button className="btn-primary text-sm" disabled={pending} onClick={commit}>
            {pending ? 'Signing…' : `Sign ${plan.signings.length === 1 ? 'him' : `all ${plan.signings.length}`}`}
          </button>
        )}
        <button className="btn-ghost text-sm" disabled={pending} onClick={() => setPlan(null)}>
          {nothingToDo ? 'Close' : 'Not now'}
        </button>
      </div>
    </div>
  );
}
