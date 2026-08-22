'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { evaluateTradeAction, executeTradeAction, rankTradePartnersAction } from '@/app/actions/trade';
import { insiderReadAction, tradeIntelAction, type TradeIntelRead } from '@/app/actions/dynasty';
import { ratingColor } from '@/lib/ratings';
import { formatMoney } from '@/lib/cap';
import { sortStatEntries, statLabel } from '@/lib/statLabels';
import { PlayerAvatar } from './PlayerAvatar';
import { TeamLogo } from './TeamLogo';
import { generateTeamLogoParams } from '@/lib/gen/teamLogo';
import { Tooltip } from './Tooltip';
import { positionBadgeClass } from './ds/positionColor';
import type { PhilosophySummary } from '@/lib/ai/gm';
import type { TradePartnerSuggestion } from '@/lib/trade';
import { tip } from '@/lib/glossary';

interface RosterP {
  id: string; name: string; position: string; ovr: number; age: number; capHit: number; yearsRemaining: number;
  /** Listed body — portrait proportions only, never a trade input. */
  weightLb?: number; heightIn?: number;
  /** Cap actually freed by sending him out — his hit minus the bonus that accelerates onto you. */
  freedIfSent: number;
  /** Cap actually taken on by acquiring him — base salary only; his bonus stays with his old team. */
  addedIfAcquired: number;
  /** Parsed Player.seasonStats — kept as an object (not the raw JSON string) so every row can render production without re-parsing on each sort/filter pass. */
  seasonStats: Record<string, number>;
}
/** projectedSlot: where this pick would land "if the season ended today" — only ever set for a current-year pick, since a future year has no standings yet to project from. */
interface Pick { id: string; year: number; round: number; slot: number; projectedSlot?: number }
interface Team { id: string; name: string; abbr: string; philosophy?: PhilosophySummary }

export function TradeBuilder({
  leagueId, myTeam, partners, partnerId, myRoster, myPicks, partnerRoster, partnerPicks, initialGive, initialGet, capSpace, capMode,
  deadlinePassed, tradeDeadlineWeek,
}: {
  leagueId: string; myTeam: Team; partners: Team[]; partnerId: string;
  myRoster: RosterP[]; myPicks: Pick[]; partnerRoster: RosterP[]; partnerPicks: Pick[];
  /** Pre-select assets when arriving to review a specific incoming AI offer. */
  initialGive?: string[]; initialGet?: string[];
  /** Current cap space, so the impact of this exact trade is visible before accepting it. */
  capSpace: number; capMode: string;
  /** Trade deadline (see lib/trade.ts isTradeDeadlinePassed) — when true, the builder stays visible for browsing but can't submit or execute anything. */
  deadlinePassed?: boolean; tradeDeadlineWeek?: number;
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
  const [intel, setIntel] = useState<TradeIntelRead | null>(null);
  const [insider, setInsider] = useState<string | null>(null);
  const [execError, setExecError] = useState<string | null>(null);
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
  // Asymmetric on purpose: sending a player out frees his hit MINUS the bonus
  // that accelerates onto your cap, and acquiring one adds base salary only
  // (his bonus stays behind with his old team). Using his raw cap hit for both
  // sides would overstate what a bonus-heavy contract actually saves you.
  const capAfter = useMemo(() => {
    const freed = [...give].reduce((sum, id) => sum + (myRoster.find((r) => r.id === id)?.freedIfSent ?? 0), 0);
    const added = [...get].reduce((sum, id) => sum + (partnerRoster.find((r) => r.id === id)?.addedIfAcquired ?? 0), 0);
    return capSpace + freed - added;
  }, [give, get, myRoster, partnerRoster, capSpace]);

  // Dead money you'd eat by sending these players out — surfaced separately
  // because it's the part a raw "cap space after" number hides.
  const deadIncurred = useMemo(
    () => [...give].reduce((sum, id) => {
      const r = myRoster.find((x) => x.id === id);
      return sum + (r ? r.capHit - r.freedIfSent : 0);
    }, 0),
    [give, myRoster],
  );

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

  const callInsider = () => {
    startTransition(async () => {
      const r = await insiderReadAction(leagueId, partnerId, giveAssets, getAssets);
      setInsider(r.ok ? `${r.report} (${r.message})` : r.message);
    });
  };

  const propose = () => {
    startTransition(async () => {
      // Dynasty NEGOTIATION -> Trade Intel. Read-only: this runs the same
      // evaluation the accept/reject path runs and reports the numbers behind
      // the bar. It cannot change what the AI will take.
      tradeIntelAction(leagueId, partnerId, giveAssets, getAssets).then(setIntel).catch(() => setIntel(null));
      setInsider(null);
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
      const res = await executeTradeAction(leagueId, myTeam.id, partnerId, giveAssets, getAssets);
      if (!res.ok) {
        // Most often the salary cap on one side or the other. Keep the
        // assembled offer on screen so the user can rework it instead of
        // rebuilding it from scratch.
        setExecError(res.message);
        return;
      }
      setExecError(null);
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

      {deadlinePassed && (
        <div className="panel p-4 border-warn/40 bg-warn/5 text-sm">
          <span className="text-warn font-semibold">Trade deadline has passed.</span>
          <span className="text-muted"> Trades reopen once free agency opens for the new league year{tradeDeadlineWeek ? ` — the deadline was week ${tradeDeadlineWeek}` : ''}. You can still browse rosters and picks below.</span>
        </div>
      )}

      {shoppedPosition && (
        <div className="panel p-4">
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
        <TeamPanel leagueId={leagueId} title="You send" teamId={myTeam.id} teamAbbr={myTeam.abbr} teamName={myTeam.name} roster={myRoster} picks={myPicks} selected={give} onToggle={(id) => toggle(give, setGive, id)} />
        <TeamPanel leagueId={leagueId} title="You receive" teamId={partnerId} teamAbbr={currentPartner?.abbr ?? ''} teamName={currentPartner?.name ?? ''} roster={partnerRoster} picks={partnerPicks} selected={get} onToggle={(id) => toggle(get, setGet, id)} />
      </div>

      <div className="panel p-4 flex items-center justify-between flex-wrap gap-3">
        <div className="text-sm text-muted flex items-center gap-3 flex-wrap">
          <span>{giveAssets.length} asset(s) out · {getAssets.length} asset(s) in</span>
          {capMode !== 'OFF' && (
            <span>
              Your cap space after: <span className={`stat-value text-stat-sm ${capAfter < 0 ? 'text-bad' : 'text-accent'}`}>{formatMoney(capAfter)}</span>
            </span>
          )}
          {capMode === 'REALISTIC' && deadIncurred > 0 && (
            <span title="Signing-bonus proration on the players you're sending out accelerates onto your cap the moment the trade goes through — it does not follow them to their new team.">
              Dead money you'd eat: <span className="stat-value text-stat-sm text-bad">{formatMoney(deadIncurred)}</span>
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" disabled={pending || deadlinePassed || (giveAssets.length === 0 && getAssets.length === 0)} onClick={propose}>
            {pending ? 'Evaluating…' : deadlinePassed ? 'Deadline Passed' : 'Propose Trade'}
          </button>
          {result?.accepted && !deadlinePassed && (
            <button className="btn-primary" disabled={pending} onClick={execute}>Confirm & Execute</button>
          )}
        </div>
      </div>

      {execError && (
        <div className="panel p-4 border-bad/40 bg-bad/5 text-sm space-y-1">
          <div className="label-sm text-bad">Trade blocked</div>
          <p className="text-muted">{execError}</p>
        </div>
      )}

      {result && (
        <div className={`panel p-4 text-sm space-y-3 ${result.accepted ? 'border-accent/40' : 'border-bad/30'}`}>
          <div className={result.accepted ? 'text-accent' : 'text-bad'}>{result.message}</div>
          <TradeScoreBar ratio={result.ratio} requiredRatio={result.requiredRatio} accepted={result.accepted} />

          {intel?.unlocked && (
            <div className="text-xs border-t border-line/60 pt-2 space-y-0.5">
              <div className="label-sm text-accent2 inline-flex items-center gap-1.5">
                Trade Intel
                <Tooltip text={tip('tradeValue')} />
              </div>
              <div className="text-muted">
                They price what you&apos;re asking for at <span className="font-mono text-chalk">{intel.theirValue.toLocaleString()}</span>{' '}
                and your offer at <span className="font-mono text-chalk">{intel.yourValue.toLocaleString()}</span>.
                {intel.shortfall > 0
                  ? <> You are <span className="font-mono text-bad">{intel.shortfall.toLocaleString()}</span> short of their bar.</>
                  : <> That clears their bar.</>}
              </div>
            </div>
          )}

          <div className="border-t border-line/60 pt-2 flex items-center gap-2 flex-wrap">
            <button type="button" className="btn-secondary text-xs" disabled={pending} onClick={callInsider}>
              Call your Insider
            </button>
            <span className="text-[11px] text-muted">Spends one of your season&apos;s Insider calls for a concrete asking price. Requires the Insider upgrade.</span>
          </div>
          {insider && <div className="text-xs text-accent2">{insider}</div>}
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
          <Tooltip text={tip('tradeAcceptance')} />
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
        <Tooltip text={tip('gmPhilosophy')} />
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

type SortKey = 'pos' | 'ovr' | 'age' | 'cap' | 'years';
const SORT_COLUMNS: { key: SortKey; label: string; width: string }[] = [
  { key: 'pos', label: 'Pos', width: 'w-8' },
  { key: 'ovr', label: 'Ovr', width: 'w-8' },
];
const SORT_COLUMNS_RIGHT: { key: SortKey; label: string; width: string }[] = [
  { key: 'age', label: 'Age', width: 'w-12' },
  { key: 'cap', label: 'Cap Hit', width: 'w-16' },
  { key: 'years', label: 'Yrs', width: 'w-10' },
];

// Duplicated from lib/league-data.ts positionSortKey — that module pulls in
// prisma, so it can't be imported into this client component. Keep in sync
// with positionBadgeClass's grouping if positions ever change.
const POSITION_ORDER = ['QB', 'RB', 'WR', 'TE', 'LT', 'LG', 'C', 'RG', 'RT', 'EDGE', 'DT', 'LB', 'CB', 'S', 'K', 'P'];
function localPositionSortKey(pos: string): number {
  const idx = POSITION_ORDER.indexOf(pos);
  return idx === -1 ? 99 : idx;
}

/** A one-line production headline so a player can be judged without leaving the trade screen — the full stat sheet is one click away on his card. Games played is omitted here since it's a volume floor, not production. */
function productionLine(stats: Record<string, number>): string {
  const entries = sortStatEntries(stats).filter(([k, v]) => k !== 'gp' && v !== 0);
  if (entries.length === 0) return 'No stats recorded yet';
  return entries.slice(0, 3).map(([k, v]) => `${v} ${statLabel(k)}`).join(' · ');
}

function SortHeader({ label, sortKey, active, dir, onClick, className }: {
  label: string; sortKey: SortKey; active: boolean; dir: 1 | -1; onClick: (key: SortKey) => void; className: string;
}) {
  return (
    <button type="button" onClick={() => onClick(sortKey)} className={`${className} hover:text-chalk ${active ? 'text-chalk' : ''}`}>
      {label}{active && (dir === -1 ? ' ▾' : ' ▴')}
    </button>
  );
}

function TeamPanel({ leagueId, title, teamId, teamAbbr, teamName, roster, picks, selected, onToggle }: {
  leagueId: string; title: string; teamId: string; teamAbbr: string; teamName: string; roster: RosterP[]; picks: Pick[]; selected: Set<string>; onToggle: (id: string) => void;
}) {
  const teamColor = generateTeamLogoParams(teamId).primary;
  const [search, setSearch] = useState('');
  const [posFilter, setPosFilter] = useState('ALL');
  const [sortKey, setSortKey] = useState<SortKey>('ovr');
  const [dir, setDir] = useState<1 | -1>(-1);

  const positions = useMemo(
    () => Array.from(new Set(roster.map((p) => p.position))).sort((a, b) => localPositionSortKey(a) - localPositionSortKey(b)),
    [roster],
  );

  const toggleSort = (key: SortKey) => {
    // Clicking a fresh column always starts high-to-low; clicking the same
    // column again flips it — same idiom as the Roster page's sort links.
    setDir((d) => (sortKey === key && d === -1 ? 1 : -1));
    setSortKey(key);
  };

  const rows = useMemo(() => {
    let list = roster;
    if (posFilter !== 'ALL') list = list.filter((p) => p.position === posFilter);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((p) => p.name.toLowerCase().includes(q));
    return [...list].sort((a, b) => {
      switch (sortKey) {
        case 'ovr': return (a.ovr - b.ovr) * dir;
        case 'age': return (a.age - b.age) * dir;
        case 'cap': return (a.capHit - b.capHit) * dir;
        case 'years': return (a.yearsRemaining - b.yearsRemaining) * dir;
        default: return (localPositionSortKey(a.position) - localPositionSortKey(b.position)) * dir || b.ovr - a.ovr;
      }
    });
  }, [roster, posFilter, search, sortKey, dir]);

  return (
    <div className="panel p-4">
      <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
        <TeamLogo seed={teamId} abbr={teamAbbr} size={24} />
        {title} <span className="text-muted font-normal">({teamName})</span>
      </h3>
      <div className="label-sm mb-1.5 inline-flex items-center gap-1.5">
        Draft Picks
        <Tooltip text={tip('pickValue')} />
      </div>
      <div className="flex flex-wrap gap-1.5 mb-4">
        {picks.map((p) => (
          <button
            key={p.id}
            onClick={() => onToggle(p.id)}
            title={p.projectedSlot ? `Projected pick ${p.projectedSlot} of 32 if the season ended today` : undefined}
            className={`pill ${selected.has(p.id) ? 'border-accent text-accent bg-accent/10' : 'border-line text-muted hover:text-chalk'}`}
          >
            {p.year} R{p.round}
            {p.projectedSlot && <span className="text-[10px] opacity-70 ml-1">(proj. #{p.projectedSlot})</span>}
          </button>
        ))}
        {picks.length === 0 && <span className="text-xs text-muted">No picks owned.</span>}
      </div>

      <div className="flex items-center gap-2 mb-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search roster…"
          className="input flex-1 text-xs py-1"
        />
        <select value={posFilter} onChange={(e) => setPosFilter(e.target.value)} className="input text-xs py-1 w-20">
          <option value="ALL">All Pos</option>
          {positions.map((pos) => <option key={pos} value={pos}>{pos}</option>)}
        </select>
        <span className="text-[11px] text-muted whitespace-nowrap">{rows.length} of {roster.length}</span>
      </div>

      <div className="label-sm mb-1.5 flex items-center gap-2">
        <span className="w-[22px]" />
        {SORT_COLUMNS.map((c) => (
          <SortHeader key={c.key} label={c.label} sortKey={c.key} active={sortKey === c.key} dir={dir} onClick={toggleSort} className={c.width} />
        ))}
        <span className="flex-1">Player / Production</span>
        {SORT_COLUMNS_RIGHT.map((c) => (
          <SortHeader key={c.key} label={c.label} sortKey={c.key} active={sortKey === c.key} dir={dir} onClick={toggleSort} className={`${c.width} text-right`} />
        ))}
      </div>
      {/* Fixed-height scroller: .scroll-shadow-y (app/globals.css) gives it an
          affordance so a row clipped at the fold reads as "there's more below"
          rather than as a rendering bug. --scroll-bg must match this
          container's actual surface or the cover gradients leave a seam. */}
      <div
        className="max-h-96 overflow-y-auto space-y-1 scroll-shadow-y"
        style={{ ['--scroll-bg' as never]: '#141417' }}
      >
        {rows.map((p) => (
          <div
            key={p.id}
            role="button"
            tabIndex={0}
            // The row is a toggle, not a plain action — without aria-pressed a
            // screen reader announces nothing about whether he's already in
            // the deal, which is the whole state this panel conveys visually.
            aria-pressed={selected.has(p.id)}
            onClick={() => onToggle(p.id)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(p.id); } }}
            className={`flex items-center gap-2 w-full text-left px-2 py-1.5 rounded-lg text-sm cursor-pointer ${selected.has(p.id) ? 'bg-accent/10 border border-accent/30' : 'hover:bg-raised border border-transparent'}`}
          >
            <PlayerAvatar seed={p.id} age={p.age} size={22} teamColor={teamColor} weightLb={p.weightLb} heightIn={p.heightIn} position={p.position} />
            <span className={`text-xs font-semibold w-8 shrink-0 ${positionBadgeClass(p.position)}`}>{p.position}</span>
            <span className={`stat-value text-xs w-8 shrink-0 ${ratingColor(p.ovr)}`}>{p.ovr}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate">{p.name}</span>
                {/* stopPropagation so opening the player card doesn't also toggle the row into the trade — the row itself handles selection. */}
                <Link
                  href={`/league/${leagueId}/player/${p.id}`}
                  onClick={(e) => e.stopPropagation()}
                  className="text-[10px] text-muted hover:text-accent2 shrink-0"
                >
                  Card →
                </Link>
              </div>
              <div className="text-[11px] text-muted truncate">{productionLine(p.seasonStats)}</div>
            </div>
            <span className="w-12 text-right text-xs text-muted font-mono shrink-0">{p.age}</span>
            <span className="w-16 text-right text-xs text-muted font-mono shrink-0">{p.capHit > 0 ? formatMoney(p.capHit) : '—'}</span>
            <span className="w-10 text-right text-xs text-muted font-mono shrink-0">{p.yearsRemaining > 0 ? `${p.yearsRemaining}yr` : '—'}</span>
          </div>
        ))}
        {rows.length === 0 && <p className="text-xs text-muted px-2 py-3">No players match this filter.</p>}
      </div>
    </div>
  );
}
