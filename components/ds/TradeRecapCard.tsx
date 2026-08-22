'use client';

import { TeamLogo } from '../TeamLogo';
import { formatMoney } from '@/lib/cap';
import { ratingColor } from '@/lib/ratings';
import { positionBadgeClass } from './positionColor';
import { pickTier } from './TradePickBoard';
import { DeltaChip } from './DeltaChip';
import { generateTeamLogoParams } from '@/lib/gen/teamLogo';

export interface TradeRecapAsset {
  kind: 'PLAYER' | 'PICK';
  /** "Yusuf Idowu", or "2028 R3" in the pick board's own wording. */
  label: string;
  position?: string;
  ovr?: number;
  /** Picks: the round and year, so the card can draw the board's own chip rather than a word. */
  round?: number;
  year?: number;
  /** Only ever set for a pick in the next draft to actually run — a later year has no standings to project from. */
  projectedSlot?: number;
  /**
   * What his arrival or departure does to YOUR depth chart. Every field is
   * rosterFit's (lib/ai/gm.ts) — the same reading that prices a trade — taken
   * on the server against the roster as it now stands. Absent for a pick, and
   * for a player who has since left the league entirely.
   */
  depth?: {
    starts: boolean;
    incumbent: number;
    /** Rating points between him and the man he displaces, in the AI's own terms. */
    overIncumbent: number;
    emptySlot: boolean;
    position: string;
  };
}

export interface TradeRecapData {
  /** TradeRecord id — the trade this card is about, and how the builder knows a new one has landed. */
  id: string;
  seasonYear: number;
  week: number;
  partnerId: string;
  partnerAbbr: string;
  partnerName: string;
  /** Always oriented to the user: what came in, what went out. */
  incoming: TradeRecapAsset[];
  outgoing: TradeRecapAsset[];
  /**
   * Dead money this trade actually put on your books, read off the CapCharge
   * rows the executor wrote — not a second calculation of acceleration.
   */
  deadMoneyBooked: number;
}

/** "an 84", "a 91" — ratings are read aloud, and "an 91" is wrong. */
function rated(n: number): string {
  const s = String(n);
  return `${s.startsWith('8') || s === '11' || s === '18' ? 'an' : 'a'} ${s}`;
}

/**
 * What a man's arrival or departure means, in the terms a GM feels it: who
 * comes off the field, or who takes over, and by how much. Nothing here is a
 * judgement about the trade — the ratings are the roster's own, the gap is the
 * same `overIncumbent` the AI quotes when it explains a price, and the
 * retrospective panel further down the page is where a deal gets graded, with
 * hindsight.
 *
 * The gap is only stated when it is big enough to mean anything, matching the
 * AI's own threshold: below it, "he starts" is the whole fact.
 */
const MEANINGFUL_GAP = 3;

function depthLine(a: TradeRecapAsset, direction: 'IN' | 'OUT'): string | null {
  if (!a.depth) return null;
  const { starts, incumbent, overIncumbent, emptySlot, position } = a.depth;
  const gap = Math.abs(overIncumbent);
  if (direction === 'IN') {
    if (starts && emptySlot) return `Walks into an open ${position} slot — nobody was playing there.`;
    if (starts) {
      return gap >= MEANINGFUL_GAP
        ? `Starts at ${position} — ${gap} points better than ${rated(incumbent)} he replaces.`
        : `Starts at ${position}, level with ${rated(incumbent)} he replaces.`;
    }
    return `Depth at ${position}, behind ${rated(incumbent)}.`;
  }
  if (starts && emptySlot) return `Leaves ${position} to nobody — that slot is empty now.`;
  if (starts) {
    return gap >= MEANINGFUL_GAP
      ? `${rated(incumbent).replace(/^a/, 'A')} takes his ${position} snaps — ${gap} points down at the spot.`
      : `${rated(incumbent).replace(/^a/, 'A')} takes his ${position} snaps.`;
  }
  return `Was behind ${rated(incumbent)} at ${position} — depth, not a starter.`;
}

function AssetRow({ asset, direction }: { asset: TradeRecapAsset; direction: 'IN' | 'OUT' }) {
  const line = depthLine(asset, direction);
  // A pick wears the round chip the board just showed it in — same tier
  // colours, same weight bar — so a first that changed hands still reads as a
  // first here and not as the word "pick" in grey.
  const tier = asset.kind === 'PICK' ? pickTier(asset.round ?? 7) : null;
  return (
    <div className="flex items-start gap-2.5 py-1.5">
      {asset.kind === 'PLAYER' ? (
        <>
          <span className={`text-[10px] font-semibold w-9 shrink-0 pt-1 ${positionBadgeClass(asset.position ?? '')}`}>{asset.position}</span>
          <span className={`stat-value text-[15px] w-7 shrink-0 ${ratingColor(asset.ovr ?? 0)}`}>{asset.ovr}</span>
        </>
      ) : (
        // Held to the same width the position badge and rating occupy on a
        // player row, so both kinds of asset start their label on one line.
        <span className="shrink-0 w-[74px]">
          <span className={`relative inline-block overflow-hidden w-9 rounded-md border px-1.5 pt-1 pb-1.5 ${tier?.edge ?? ''} ${tier?.wash ?? ''}`}>
            <span className={`stat-value text-[13px] leading-none ${tier?.text ?? 'text-muted'}`}>R{asset.round ?? '?'}</span>
            <span
              className={`absolute left-0 right-0 bottom-0 h-[2px] ${tier?.bar ?? 'bg-muted/45'}`}
              style={{ opacity: Math.max(0.25, 1 - ((asset.round ?? 7) - 1) * 0.13) }}
            />
          </span>
        </span>
      )}
      <div className="min-w-0">
        <div className="text-sm text-chalk truncate">
          {asset.kind === 'PICK' ? (asset.year ?? asset.label) : asset.label}
          {asset.kind === 'PICK' && asset.projectedSlot ? (
            <span className="text-muted font-mono text-[11px]"> · proj. #{asset.projectedSlot}</span>
          ) : null}
        </div>
        {line && <div className="text-[11px] text-muted mt-0.5">{line}</div>}
      </div>
    </div>
  );
}

function Side({ teamId, abbr, heading, assets, direction }: {
  teamId: string; abbr: string; heading: string; assets: TradeRecapAsset[]; direction: 'IN' | 'OUT';
}) {
  const color = generateTeamLogoParams(abbr || teamId).primary;
  return (
    <div className="p-4 min-w-0" style={{ ['--team-accent' as never]: color }}>
      <div className="flex items-center gap-2 mb-2 pb-2 border-b border-line/60">
        <TeamLogo seed={teamId} abbr={abbr} size={22} />
        <span className="label-sm text-team">{heading}</span>
      </div>
      {assets.length === 0 ? (
        <div className="text-xs text-muted py-2">Nothing.</div>
      ) : (
        <div className="divide-y divide-line/40">
          {assets.map((a, i) => <AssetRow key={`${a.label}-${i}`} asset={a} direction={direction} />)}
        </div>
      )}
    </div>
  );
}

/**
 * One club's room, before and after. Both figures are teamCapSummary's own —
 * the "before" is what the server last reported while the deal was still on
 * the table, the "after" is what it reports now that it has landed — so the
 * arrow spans two readings rather than a reading and a subtraction.
 */
function CapMove({ label, before, after }: { label: string; before: number | null; after: number }) {
  return (
    <div>
      <div className="label-sm">{label}</div>
      <div className="flex items-baseline gap-2 mt-1">
        {before !== null && Math.round(before) !== Math.round(after) && (
          <>
            <span className="stat-value text-stat-sm text-muted">{formatMoney(before)}</span>
            <span className="text-muted text-sm">→</span>
          </>
        )}
        <span className={`stat-value text-stat-sm ${after < 0 ? 'text-bad' : 'text-accent'}`}>{formatMoney(after)}</span>
        <DeltaChip
          delta={before === null || Math.round(after - before) === 0 ? null : after - before}
          format={(abs) => formatMoney(abs)}
        />
      </div>
    </div>
  );
}

/**
 * THE DEAL, DONE.
 *
 * Executing a trade used to clear the screen and leave nothing behind — the
 * single most consequential button on the page had no more presence than a
 * filter change. This states what happened: who went where, what it did to
 * the depth chart, and what it did to the books.
 *
 * It does not say whether the trade was any good, and it must not. Nobody
 * knows in the moment; the retrospectives further down the page are where a
 * deal is judged, once there is something to judge it on.
 */
export function TradeRecapCard({
  recap, myTeamId, myAbbr, myName, capBefore, capAfter, partnerCapBefore, partnerCapAfter, capMode, onDismiss,
}: {
  recap: TradeRecapData;
  myTeamId: string; myAbbr: string; myName: string;
  /**
   * Cap space either side of the deal — both the server's own figure from
   * teamCapSummary, one captured the moment before Confirm and one from the
   * render after it landed. Nothing is subtracted here to produce them.
   */
  capBefore: number | null; capAfter: number;
  /** The same two readings for the club on the other end. Null when the cap is off, or when the screen has since moved to a different partner. */
  partnerCapBefore: number | null; partnerCapAfter: number | null;
  capMode: string;
  onDismiss: () => void;
}) {
  return (
    <div className="panel border-accent/50 bg-accent/[0.05] overflow-hidden animate-fadeUp">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-line/60 bg-ink/25">
        <div className="flex items-center gap-1.5">
          <TeamLogo seed={myTeamId} abbr={myAbbr} size={26} />
          <TeamLogo seed={recap.partnerId} abbr={recap.partnerAbbr} size={26} />
        </div>
        <div className="min-w-0">
          <div className="font-display font-extrabold uppercase tracking-wide text-lg leading-none text-accent">Trade completed</div>
          <div className="text-[11px] text-muted mt-1 truncate">
            {myName} and {recap.partnerName} · {recap.seasonYear} Week {recap.week}
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss trade recap"
          className="ml-auto btn-icon shrink-0"
        >
          ×
        </button>
      </div>

      <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-line/60">
        <Side teamId={myTeamId} abbr={myAbbr} heading={`To ${myAbbr}`} assets={recap.incoming} direction="IN" />
        <Side teamId={recap.partnerId} abbr={recap.partnerAbbr} heading={`To ${recap.partnerAbbr}`} assets={recap.outgoing} direction="OUT" />
      </div>

      {capMode !== 'OFF' && (
        <div className="border-t border-line/60 bg-ink/25 px-4 py-3 flex items-center gap-x-8 gap-y-3 flex-wrap">
          <CapMove label={`${myAbbr} cap space`} before={capBefore} after={capAfter} />
          {partnerCapAfter !== null && (
            <CapMove label={`${recap.partnerAbbr} cap space`} before={partnerCapBefore} after={partnerCapAfter} />
          )}
          {recap.deadMoneyBooked > 0 && (
            <div>
              <div className="label-sm">Dead money booked</div>
              <div className="stat-value text-stat-sm mt-1 text-bad">{formatMoney(recap.deadMoneyBooked)}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
