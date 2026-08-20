'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { evaluateTradeAction, executeTradeAction, rankTradePartnersAction } from '@/app/actions/trade';
import { ratingColor } from '@/lib/ratings';
import { formatMoney } from '@/lib/cap';
import { PlayerAvatar } from './PlayerAvatar';
import { TeamLogo } from './TeamLogo';
import { generateTeamLogoParams } from '@/lib/gen/teamLogo';
import { Tooltip } from './Tooltip';
import type { PhilosophySummary } from '@/lib/ai/gm';
import type { TradePartnerSuggestion } from '@/lib/trade';

interface RosterP { id: string; name: string; position: string; ovr: number; age: number; capHit: number; yearsRemaining: number }
interface Pick { id: string; year: number; round: number; slot: number }
interface Team { id: string; name: string; abbr: string; philosophy?: PhilosophySummary }

export function TradeBuilder({
  leagueId, myTeam, partners, partnerId, myRoster, myPicks, partnerRoster, partnerPicks, initialGive, initialGet, capSpace, capMode,
}: {
  leagueId: string; myTeam: Team; partners: Team[]; partnerId: string;
  myRoster: RosterP[]; myPicks: Pick[]; partnerRoster: RosterP[]; partnerPicks: Pick[];
  /** Pre-select assets when arriving to review a specific incoming AI offer. */
  initialGive?: string[]; initialGet?: string[];
  /** Current cap space, so the impact of this exact trade is visible before accepting it. */
  capSpace: number; capMode: string;
}) {
  const router = useRouter();
  const [give, setGive] = useState<Set<string>>(new Set(initialGive));
  const [get, setGet] = useState<Set<string>>(new Set(initialGet));
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{
    accepted: boolean; message: string; ratio: number; requiredRatio: number;
    sendValue: number; receiveValue: number;
    explanation?: { give: string[]; receive: string[] };
  } | null>(null);
  const [partnerSuggestions, setPartnerSuggestions] = useState<TradePartnerSuggestion[] | null>(null);

  const toggle = (set: Set<string>, setFn: (s: Set<string>) => void, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    setFn(next);
    setResult(null);
  };

  const giveAssets = useMemo(() => assetList(give, myRoster, myPicks), [give, myRoster, myPicks]);
  const getAssets = useMemo(() => assetList(get, partnerRoster, partnerPicks), [get, partnerRoster, partnerPicks]);

  // Cap impact of exactly what's selected right now — updates live as
  // players are picked, not just after proposing, so the space you'd be
  // left with is visible before you ever hit accept.
  const capAfter = useMemo(() => {
    const freed = [...give].reduce((sum, id) => sum + (myRoster.find((r) => r.id === id)?.capHit ?? 0), 0);
    const added = [...get].reduce((sum, id) => sum + (partnerRoster.find((r) => r.id === id)?.capHit ?? 0), 0);
    return capSpace + freed - added;
  }, [give, get, myRoster, partnerRoster, capSpace]);

  // "Best trade partners" — when exactly one player is selected to shop,
  // surface which other teams actually need that position instead of making
  // the user open all 31 rosters by hand.
  const shoppedPosition = useMemo(() => {
    const playerIds = [...give].filter((id) => myRoster.find((r) => r.id === id));
    if (playerIds.length !== 1) return null;
    return myRoster.find((r) => r.id === playerIds[0])?.position ?? null;
  }, [give, myRoster]);

  useEffect(() => {
    if (!shoppedPosition) { setPartnerSuggestions(null); return; }
    let cancelled = false;
    rankTradePartnersAction(leagueId, shoppedPosition, myTeam.id).then((res) => {
      if (!cancelled) setPartnerSuggestions(res);
    });
    return () => { cancelled = true; };
  }, [shoppedPosition, leagueId, myTeam.id]);

  const propose = () => {
    startTransition(async () => {
      const evaluation = await evaluateTradeAction(leagueId, partnerId, giveAssets, getAssets);
      setResult({
        accepted: evaluation.accepted,
        ratio: evaluation.ratio,
        requiredRatio: evaluation.requiredRatio,
        sendValue: evaluation.sendValue,
        receiveValue: evaluation.receiveValue,
        message: evaluation.accepted
          ? 'Deal accepted! Click confirm to execute the trade.'
          : evaluation.counter?.message ?? 'Rejected.',
        explanation: evaluation.explanation,
      });
    });
  };

  // Arriving via a "Review" link on an incoming offer — surface the trade
  // meter immediately instead of making the user click Propose to see what
  // was actually offered.
  useEffect(() => {
    if ((initialGive?.length || initialGet?.length) && (giveAssets.length > 0 || getAssets.length > 0)) {
      propose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const execute = () => {
    startTransition(async () => {
      await executeTradeAction(leagueId, myTeam.id, partnerId, giveAssets, getAssets);
      setGive(new Set()); setGet(new Set()); setResult(null);
      router.refresh();
    });
  };

  const currentPartner = partners.find((p) => p.id === partnerId);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="label-sm">Trading with</span>
        <select
          className="input"
          value={partnerId}
          onChange={(e) => { window.location.href = `?with=${e.target.value}`; }}
        >
          {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {currentPartner?.philosophy && <PhilosophyBadges p={currentPartner.philosophy} />}
      </div>

      {shoppedPosition && (
        <div className="card card-pad">
          <h3 className="font-semibold text-sm mb-2">Best trade partners for a {shoppedPosition}</h3>
          {partnerSuggestions === null ? (
            <p className="text-xs text-muted">Checking around the league…</p>
          ) : partnerSuggestions.length === 0 ? (
            <p className="text-xs text-muted">No team is showing significant need at {shoppedPosition} right now.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {partnerSuggestions.map((s) => (
                <button
                  key={s.teamId}
                  onClick={() => { window.location.href = `?with=${s.teamId}`; }}
                  className={`pill flex items-center gap-1.5 ${s.teamId === partnerId ? 'border-accent text-accent bg-accent/10' : 'border-line text-muted hover:text-chalk'}`}
                >
                  <TeamLogo seed={s.teamId} abbr={s.teamAbbr} size={16} />
                  {s.teamAbbr}
                  <span className={needColor(s.needLabel)}>{s.needLabel} need</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        <TeamPanel title="You send" teamId={myTeam.id} teamAbbr={myTeam.abbr} teamName={myTeam.name} roster={myRoster} picks={myPicks} selected={give} onToggle={(id) => toggle(give, setGive, id)} />
        <TeamPanel title="You receive" teamId={partnerId} teamAbbr={currentPartner?.abbr ?? ''} teamName={currentPartner?.name ?? ''} roster={partnerRoster} picks={partnerPicks} selected={get} onToggle={(id) => toggle(get, setGet, id)} />
      </div>

      <div className="card card-pad flex items-center justify-between flex-wrap gap-3">
        <div className="text-sm text-muted flex items-center gap-3 flex-wrap">
          <span>{giveAssets.length} asset(s) out · {getAssets.length} asset(s) in</span>
          {capMode !== 'OFF' && (
            <span>
              Your cap space after: <span className={`font-mono font-semibold ${capAfter < 0 ? 'text-bad' : 'text-accent'}`}>{formatMoney(capAfter)}</span>
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" disabled={pending || (giveAssets.length === 0 && getAssets.length === 0)} onClick={propose}>
            {pending ? 'Evaluating…' : 'Propose Trade'}
          </button>
          {result?.accepted && (
            <button className="btn-primary" disabled={pending} onClick={execute}>Confirm & Execute</button>
          )}
        </div>
      </div>

      {result && (
        <div className={`card card-pad text-sm space-y-3 ${result.accepted ? 'border-accent/40' : 'border-bad/30'}`}>
          <div className={result.accepted ? 'text-accent' : 'text-bad'}>{result.message}</div>
          <TradeScoreBar ratio={result.ratio} requiredRatio={result.requiredRatio} accepted={result.accepted} />
          {(result.explanation?.give.length || result.explanation?.receive.length) ? (
            <div className="text-xs text-muted space-y-1 pt-1 border-t border-line/60">
              {result.explanation.receive.map((r, i) => <div key={`r${i}`}>• {r}</div>)}
              {result.explanation.give.map((r, i) => <div key={`g${i}`}>• {r}</div>)}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

/**
 * The AI accepts once (value you're offering) / (value it gives up) clears
 * `requiredRatio`. Normalizing to that threshold ("100" = exactly clears the
 * bar the AI actually applies) is what makes this readable — the raw value
 * points are meaningless to a player with nothing to compare them against.
 */
function TradeScoreBar({ ratio, requiredRatio, accepted }: { ratio: number; requiredRatio: number; accepted: boolean }) {
  const pct = Number.isFinite(ratio) ? (ratio / requiredRatio) * 100 : 150;
  const fillPct = Math.max(2, Math.min(150, pct));
  const barColor = accepted ? 'bg-accent' : pct >= 80 ? 'bg-warn' : 'bg-bad';
  const thresholdLeft = (100 / 150) * 100; // requiredRatio always sits at the 100-of-150 mark on this scale

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="label-sm inline-flex items-center gap-1.5">
          Trade Score
          <Tooltip text="How your offer's value compares to what this team needs to see to accept — 100% is the acceptance line, marked by the vertical tick. Below it, they'll counter or decline; well below, they'll just decline." />
        </span>
        <span className={`text-xs font-mono ${accepted ? 'text-accent' : 'text-muted'}`}>{Math.round(pct)}% of what they need</span>
      </div>
      <div className="relative h-2.5 rounded-full bg-raised overflow-hidden">
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${(fillPct / 150) * 100}%` }} />
        <div className="absolute top-0 bottom-0 w-px bg-line" style={{ left: `${thresholdLeft}%` }} title="Acceptance threshold" />
      </div>
    </div>
  );
}

function PhilosophyBadges({ p }: { p: PhilosophySummary }) {
  return (
    <div className="flex gap-1.5 flex-wrap items-center">
      <span className="pill border-line text-muted inline-flex items-center gap-1">
        {p.windowLabel}
        <Tooltip text="Where this front office sees itself right now — rebuilding teams value youth and draft capital over immediate roster quality; contenders will pay a premium for it." />
      </span>
      <span className="pill border-line text-muted inline-flex items-center gap-1">
        {p.tradeTendency} trader
        <Tooltip text="How willing this GM is to make a deal at all — aggressive GMs engage more readily; conservative ones need a clearly favorable offer before they'll even counter." />
      </span>
      <span className="pill border-line text-muted inline-flex items-center gap-1">
        {p.pickPreference}
        <Tooltip text="This GM's bias between draft picks and immediate talent when the value is otherwise close — it doesn't change what they'll accept, only which side of an even trade they lean toward." />
      </span>
    </div>
  );
}

function needColor(label: TradePartnerSuggestion['needLabel']): string {
  if (label === 'Severe') return 'text-bad';
  if (label === 'High') return 'text-warn';
  if (label === 'Moderate') return 'text-accent2';
  return 'text-muted';
}

function assetList(selected: Set<string>, roster: RosterP[], picks: Pick[]) {
  const out: { type: 'PLAYER' | 'PICK'; id: string }[] = [];
  for (const id of selected) {
    if (roster.find((r) => r.id === id)) out.push({ type: 'PLAYER', id });
    else if (picks.find((p) => p.id === id)) out.push({ type: 'PICK', id });
  }
  return out;
}

function TeamPanel({ title, teamId, teamAbbr, teamName, roster, picks, selected, onToggle }: {
  title: string; teamId: string; teamAbbr: string; teamName: string; roster: RosterP[]; picks: Pick[]; selected: Set<string>; onToggle: (id: string) => void;
}) {
  const teamColor = generateTeamLogoParams(teamId).primary;
  return (
    <div className="card card-pad">
      <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
        <TeamLogo seed={teamId} abbr={teamAbbr} size={24} />
        {title} <span className="text-muted font-normal">({teamName})</span>
      </h3>
      <div className="label-sm mb-1.5">Draft Picks</div>
      <div className="flex flex-wrap gap-1.5 mb-4">
        {picks.map((p) => (
          <button
            key={p.id}
            onClick={() => onToggle(p.id)}
            className={`pill ${selected.has(p.id) ? 'border-accent text-accent bg-accent/10' : 'border-line text-muted hover:text-chalk'}`}
          >
            {p.year} R{p.round}
          </button>
        ))}
        {picks.length === 0 && <span className="text-xs text-muted">No picks owned.</span>}
      </div>
      <div className="label-sm mb-1.5 flex items-center gap-2">
        <span className="w-[22px]" />
        <span className="w-8">Pos</span>
        <span className="w-8">Ovr</span>
        <span className="flex-1">Player</span>
        <span className="w-12 text-right">Age</span>
        <span className="w-16 text-right">Cap Hit</span>
        <span className="w-10 text-right">Yrs</span>
      </div>
      <div className="max-h-64 overflow-y-auto space-y-1">
        {roster.map((p) => (
          <button
            key={p.id}
            onClick={() => onToggle(p.id)}
            className={`flex items-center gap-2 w-full text-left px-2 py-1.5 rounded-lg text-sm ${selected.has(p.id) ? 'bg-accent/10 border border-accent/30' : 'hover:bg-raised border border-transparent'}`}
          >
            <PlayerAvatar seed={p.id} age={p.age} size={22} teamColor={teamColor} />
            <span className="text-xs font-mono text-muted w-8">{p.position}</span>
            <span className={`text-xs font-mono font-semibold w-8 ${ratingColor(p.ovr)}`}>{p.ovr}</span>
            <span className="flex-1 truncate">{p.name}</span>
            <span className="w-12 text-right text-xs text-muted font-mono">{p.age}</span>
            <span className="w-16 text-right text-xs text-muted font-mono">{p.capHit > 0 ? formatMoney(p.capHit) : '—'}</span>
            <span className="w-10 text-right text-xs text-muted font-mono">{p.yearsRemaining > 0 ? `${p.yearsRemaining}yr` : '—'}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
