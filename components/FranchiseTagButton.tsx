'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { applyFranchiseTagAction, franchiseTagImpactAction, type FranchiseTagImpact } from '@/app/actions/roster';
import { formatMoney } from '@/lib/cap';
import { ActionButton } from './ds/ActionButton';
import { TagDeadMoneyNote } from './ds/TagDeadMoneyNote';
import { Tooltip } from './Tooltip';
import { tip } from '@/lib/glossary';

/**
 * ===========================================================================
 * THE FRANCHISE TAG: A REAL CONTROL, A REAL PRICE, AND A CONFIRM
 * ===========================================================================
 * Three reports, all about the same control:
 *
 *   *"is the franchise tag available for users? I haven't seen it yet"*
 *   *"I don't see any way to franchise tag someone. I see the option in the
 *     contract tab, but no option to use it."*
 *   *"franchise tag is still not proper. it should be a large option players
 *     can notice, and clicking it should show the cap implications just like a
 *     regular contract would and ask to confirm instead of just 1-clicking
 *     into it"*
 *
 * What he saw on the contract tab was the STATUS badge — a pill that only
 * appears on a man who has already been tagged. The only control in the game
 * was a small pill at the bottom of an expanded row on the re-sign screen, it
 * committed on one press, and outside the re-sign window it did not exist at
 * all, with nothing on any screen saying why. The first two fixes made the tag
 * better advertised without making it reachable; a third quiet treatment would
 * have failed the same way.
 *
 * So this is all three answers at once, and it is the ONLY tag control in the
 * game — the player card and the re-sign row render this same component, which
 * is what makes it impossible for the two paths to quote different prices or
 * ask different questions:
 *
 *   WEIGHT. A full-width button at the size of the other decisions on the
 *     card, in the gold this app already reserves for the tag, sitting WITH
 *     Re-sign and Release rather than tucked under them.
 *   THE PRICE, BEFORE ANYTHING COMMITS. Pressing it opens the preview, not the
 *     tag. Every figure is resolved server-side by `franchiseTagImpactAction`
 *     from the functions the commit path charges on, in the shape the signing
 *     ledger uses (NegotiationPanel): what he is paid, what that number is
 *     made of, what comes off the books, what the old deal's stranded bonus
 *     adds, and the room before and after.
 *   A CONFIRM, NOT A CLICK. `CutButton`'s pattern exactly, for the same
 *     reason: it cannot be undone, and a playtest that read the longer release
 *     path judged it correct and warned against shortening it. The tag is
 *     rarer than a release and now costs dead money on top of itself.
 *
 * WHAT IS NOT SHORTENED, ANYWHERE. When it cannot be pressed the control stays
 * on screen, greyed, carrying the reason from the shared rule
 * (lib/franchiseTag.ts) — a missing button teaches that the game is broken, a
 * greyed one teaches the rule. And a man who IS tagged is never offered it.
 * ===========================================================================
 */
export function FranchiseTagButton({ leagueId, playerId, playerName, blocked, isTagged, compact }: {
  leagueId: string;
  playerId: string;
  playerName: string;
  /** Null when the tag is available. Otherwise the reason, from franchiseTagBlockReason. */
  blocked: string | null;
  /** He is the man this club has already tagged. Status, not an offer. */
  isTagged: boolean;
  /**
   * The re-sign row is a list item inside an open negotiation rather than a
   * decision page, so it takes the same control at list scale. Nothing is
   * removed by it — the preview, the figures and the confirm are identical,
   * because the two paths knowing different things is the bug this component
   * exists to prevent.
   */
  compact?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [impact, setImpact] = useState<FranchiseTagImpact | null>(null);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const router = useRouter();

  // THE RECEIPT OUTRANKS EVERYTHING BELOW, and only for the reader who just
  // pressed the button: it names both halves of what the tag cost, and
  // `router.refresh()` would otherwise replace it with the standing status
  // line a beat later.
  if (receipt) return <p className="text-sm text-accent">{receipt}</p>;

  // ALREADY TAGGED IS A STATE, NOT A CONTROL. The badge in the card's heading
  // says he is on a tag; this says what that means for his season, where the
  // button would otherwise be, and offers nothing.
  if (isTagged) {
    return (
      <p className="text-sm text-muted">
        He is playing this season on your franchise tag — one year, fully guaranteed, and he reaches free
        agency when it is up unless you sign him to something longer first.
      </p>
    );
  }

  if (blocked) {
    return (
      <div className="space-y-1.5">
        <span className="inline-flex items-center gap-1.5">
          {/* Really disabled, not merely styled that way: a button that looks
              live and does nothing is worse than the one that was missing.
              `.btn` greys and deadens it, so no extra styling is needed. */}
          <button type="button" disabled className={compact ? 'btn-secondary text-xs px-3 py-1.5' : 'btn-secondary'}>
            Franchise Tag
          </button>
          <Tooltip text={tip('franchiseTag')} />
        </span>
        <p className="text-xs text-muted">{blocked}</p>
      </div>
    );
  }

  const beginConfirm = async () => {
    setConfirming(true);
    setLoading(true);
    setFailure(null);
    try {
      setImpact(await franchiseTagImpactAction(leagueId, playerId));
    } finally {
      setLoading(false);
    }
  };

  if (!confirming) {
    return (
      <div className="space-y-1.5">
        <button
          type="button"
          onClick={beginConfirm}
          className={`btn w-full border border-gold/50 bg-gold/15 text-gold hover:bg-gold/25 ${compact ? '' : 'py-3 text-base'}`}
        >
          Franchise Tag
        </button>
        <p className="text-xs text-muted inline-flex items-center gap-1.5">
          One a year, and only in this window. Nothing is signed until you have seen what it costs.
          <Tooltip text={tip('franchiseTag')} />
        </p>
      </div>
    );
  }

  // The label carries the price, exactly as the release button carries the
  // dead money: "Confirm" is a form, "$37.7M for one year" is a decision.
  const confirmLabel = impact ? `Tag — ${formatMoney(impact.tagValue)} for one year` : 'Confirm Tag';

  return (
    <div className="space-y-3 pl-3.5 border-l-2 border-gold">
      <div className="label-sm text-gold">Franchise tag · one a year, cannot be undone</div>
      <div className="font-semibold text-[15px] -mt-1.5">{playerName}</div>
      {loading && <p className="text-xs text-muted">Pricing the tag…</p>}

      {impact && (
        <>
          {/* THE LEDGER, in the shape the signing panel uses — same rows, same
              ink, same order of thought: what he is paid, what that is made
              of, and what it does to the books. Every figure comes from
              franchiseTagImpactAction, which reads the same functions the
              commit path charges on. */}
          <div className="panel p-3 space-y-1.5 text-sm">
            <div className="flex justify-between gap-3">
              <span className="text-muted">
                Tag salary — 1 yr, fully guaranteed{impact.capEnabled ? `, and his whole ${impact.seasonYear} cap hit` : ''}
              </span>
              <span className="stat-value text-stat-sm">{formatMoney(impact.tagValue)}</span>
            </div>
            {/* WHERE THE NUMBER COMES FROM. The tag is not a price invented for
                him — it is what the position already pays, and a GM who wants
                to check it can go and read those contracts. */}
            {impact.topSalaries.length > 0 && (
              <div className="text-[11px] text-muted">
                The average of the {impact.topSalaries.length} biggest {impact.position} cap hits in the league:{' '}
                {impact.topSalaries.map((v) => formatMoney(v)).join(' · ')}
              </div>
            )}
            {impact.capEnabled ? (
              <>
                <div className="flex justify-between gap-3">
                  <span className="text-muted">His old deal comes off the books</span>
                  <span className="font-mono text-accent">-{formatMoney(impact.currentHit)}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted">Dead money — his old deal&apos;s unamortised bonus</span>
                  <span className={`font-mono ${impact.deadMoney > 0 ? 'text-bad' : ''}`}>{formatMoney(impact.deadMoney)}</span>
                </div>
                <div className="flex justify-between gap-3 pt-1.5 border-t border-line/60">
                  <span className="text-muted">Net cap cost, {impact.seasonYear}</span>
                  <span className={`font-mono font-semibold ${impact.netCost > 0 ? 'text-bad' : 'text-accent'}`}>
                    {impact.netCost >= 0 ? formatMoney(impact.netCost) : `frees ${formatMoney(-impact.netCost)}`}
                  </span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted">Your cap space now</span>
                  <span className="font-mono text-muted">{formatMoney(impact.capSpaceBefore)}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted">Your cap space after</span>
                  <span className={`stat-value text-stat-sm ${impact.capSpaceAfter < 0 ? 'text-bad' : 'text-accent'}`}>
                    {formatMoney(impact.capSpaceAfter)}
                  </span>
                </div>
              </>
            ) : (
              <div className="text-[11px] text-muted">This league runs without a salary cap, so the tag costs you nothing but the year.</div>
            )}
          </div>

          <TagDeadMoneyNote name={impact.playerName} amount={impact.deadMoney} />

          {impact.leavesOverCap && (
            <p className="text-xs text-bad">
              This tag puts you over the salary cap by {formatMoney(-impact.capSpaceAfter)}, and you have to be
              back under it before the league year turns.
            </p>
          )}

          <p className="text-xs text-muted">
            It buys a season and nothing else: he is a free agent again next offseason unless you sign him to
            something longer before then.
          </p>

          {/* The button that opened this panel was drawn by a page render that
              may be a navigation old. A tag spent in another tab since then is
              found out HERE, not at the press. */}
          {impact.blocked && <p className="text-xs text-bad">{impact.blocked}</p>}
        </>
      )}

      {failure && <p className="text-xs text-bad">{failure}</p>}

      <div className="flex gap-2">
        <ActionButton
          className="btn flex-1 border border-gold/50 bg-gold/15 text-gold hover:bg-gold/25"
          disabled={loading || !!impact?.blocked}
          idleLabel={confirmLabel}
          workingLabel="Tagging…"
          doneLabel="Tagged"
          onAction={async () => {
            const result = await applyFranchiseTagAction(leagueId, playerId);
            // A refusal is not an achievement: no done beat, and the server's
            // own sentence goes on screen rather than into a catch. The cap
            // gate and the one-a-year rule can both still answer here.
            if (!result.ok) { setFailure(result.message); return false; }
            setReceipt(result.message);
            setConfirming(false);
            router.refresh();
          }}
        />
        <button
          type="button"
          onClick={() => { setConfirming(false); setImpact(null); setFailure(null); }}
          className="btn-ghost"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
