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
  round?: number;
  /**
   * What his arrival or departure does to YOUR depth chart. Every field is
   * rosterFit's (lib/ai/gm.ts) — the same reading that prices a trade — taken
   * on the server against the roster as it now stands. Absent for a pick, and
   * for a player who has since left the league entirely.
   */
  depth?: { starts: boolean; incumbent: number; emptySlot: boolean; position: string };
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

/**
 * What a man's arrival or departure means, in the terms a GM feels it: who
 * comes off the field, or who takes over. Nothing here is a judgement about
 * the trade — the ratings are the roster's own, and the retrospective panel
 * further down the page is where a deal gets graded, with hindsight.
 */
function depthLine(a: TradeRecapAsset, direction: 'IN' | 'OUT'): string | null {
  if (!a.depth) return null;
  const { starts, incumbent, emptySlot, position } = a.depth;
  if (direction === 'IN') {
    if (starts && emptySlot) return `Starts at ${position} — the spot was open.`;
    if (starts) return `Starts at ${position}, ahead of an ${incumbent}.`;
    return `Depth at ${position}, behind an ${incumbent}.`;
  }
  if (starts && emptySlot) return `Leaves ${position} empty.`;
  if (starts) return `His ${position} snaps go to an ${incumbent}.`;
  return `Was behind an ${incumbent} at ${position}.`;
}

function AssetRow({ asset, direction }: { asset: TradeRecapAsset; direction: 'IN' | 'OUT' }) {
  const line = depthLine(asset, direction);
  const tier = asset.kind === 'PICK' ? pickTier(asset.round ?? 7) : null;
  return (
    <div className="flex items-start gap-2.5 py-1.5">
      {asset.kind === 'PLAYER' ? (
        <>
          <span className={`text-[10px] font-semibold w-9 shrink-0 pt-1 ${positionBadgeClass(asset.position ?? '')}`}>{asset.position}</span>
          <span className={`stat-value text-[15px] w-7 shrink-0 ${ratingColor(asset.ovr ?? 0)}`}>{asset.ovr}</span>
        </>
      ) : (
        <span className={`text-[10px] font-semibold uppercase tracking-wider w-16 shrink-0 pt-1 ${tier?.text ?? 'text-muted'}`}>Pick</span>
      )}
      <div className="min-w-0">
        <div className="text-sm text-chalk truncate">{asset.label}</div>
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
export function TradeRecapCard({ recap, myTeamId, myAbbr, myName, capBefore, capAfter, capMode, onDismiss }: {
  recap: TradeRecapData;
  myTeamId: string; myAbbr: string; myName: string;
  /**
   * Cap space either side of the deal — both the server's own figure from
   * teamCapSummary, one captured the moment before Confirm and one from the
   * render after it landed. Nothing is subtracted here to produce them.
   */
  capBefore: number | null; capAfter: number;
  capMode: string;
  onDismiss: () => void;
}) {
  const capDelta = capBefore === null ? null : capAfter - capBefore;

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
        <div className="border-t border-line/60 bg-ink/25 px-4 py-3 flex items-center gap-8 flex-wrap">
          <div>
            <div className="label-sm">Your cap space</div>
            <div className="flex items-baseline gap-2 mt-1">
              {capBefore !== null && (
                <>
                  <span className="stat-value text-stat-sm text-muted">{formatMoney(capBefore)}</span>
                  <span className="text-muted text-sm">→</span>
                </>
              )}
              <span className={`stat-value text-stat-sm ${capAfter < 0 ? 'text-bad' : 'text-accent'}`}>{formatMoney(capAfter)}</span>
              <DeltaChip delta={capDelta} format={(abs) => formatMoney(abs)} />
            </div>
          </div>
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
