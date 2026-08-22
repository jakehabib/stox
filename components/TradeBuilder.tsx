'use client';

import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from 'react';
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
import { TradePickBoard, pickTier } from './ds/TradePickBoard';
import { TradeVerdict } from './ds/TradeVerdict';
import { TradeRecapCard, type TradeRecapData } from './ds/TradeRecapCard';
import { IconSwap } from './ds/icons';
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
interface Pick {
  id: string; year: number; round: number; slot: number; projectedSlot?: number;
  /** Club it originally belonged to, when that isn't the club holding it — a pick that changed hands is not the same object as one a club has always owned. */
  via?: string;
}
interface Team { id: string; name: string; abbr: string; philosophy?: PhilosophySummary }

/** What the server actions take: an asset by id and kind, nothing else. */
type TradeAssetRef = { type: 'PLAYER' | 'PICK'; id: string };

/** One selected asset, resolved for display on the deal sheet. */
interface DealItem {
  id: string;
  kind: 'PLAYER' | 'PICK';
  label: string;
  position?: string;
  ovr?: number;
  /** Picks: the round, so the sheet tiers a first away from a seventh exactly as the board does. */
  round?: number;
  /** Cap consequence for THIS side of the deal, or a pick's projected slot / origin. */
  sub?: string;
}

export function TradeBuilder({
  leagueId, myTeam, partners, partnerId, myRoster, myPicks, partnerRoster, partnerPicks, initialGive, initialGet, capSpace, partnerCapSpace, capMode,
  deadlinePassed, tradeDeadlineWeek, initialPartnerPos, draftRounds, imminentYear, lastTrade,
}: {
  leagueId: string; myTeam: Team; partners: Team[]; partnerId: string;
  /** Position being shopped, carried in the URL so it survives changing club. See TeamPanel's initialPosFilter. */
  initialPartnerPos?: string;
  myRoster: RosterP[]; myPicks: Pick[]; partnerRoster: RosterP[]; partnerPicks: Pick[];
  /** Pre-select assets when arriving to review a specific incoming AI offer. */
  initialGive?: string[]; initialGet?: string[];
  /** Current cap space, so the impact of this exact trade is visible before accepting it. */
  capSpace: number;
  /** The partner club's room. Null only when the cap is switched off for the league. */
  partnerCapSpace: number | null;
  capMode: string;
  /** Trade deadline (see lib/trade.ts isTradeDeadlinePassed) — when true, the builder stays visible for browsing but can't submit or execute anything. */
  deadlinePassed?: boolean; tradeDeadlineWeek?: number;
  /** The league's round count and the next draft that will actually run — the pick board's column count, and which year carries a live slot projection. */
  draftRounds: number; imminentYear: number | null;
  /**
   * The most recent trade this club has made, rebuilt by the page on every
   * render. It is only ever SHOWN when its id differs from the one that was
   * already on screen at mount — i.e. when a deal has just gone through under
   * this session — so an old trade can never announce itself on a page load.
   */
  lastTrade: TradeRecapData | null;
}) {
  const router = useRouter();
  // Held here rather than in the panel because the club switcher has to read it
  // when it builds the URL it navigates to, and the panel unmounts on the way.
  const [partnerPos, setPartnerPos] = useState(initialPartnerPos ?? 'ALL');
  const goToPartner = (id: string) =>
    // router.push, NOT window.location.href, and scroll:false. The hard
    // navigation this replaced reloaded the whole document and threw the
    // reader back to the top of the page every time they looked at a
    // different club — half of the app owner's complaint was the scroll.
    router.push(`?with=${id}${partnerPos !== 'ALL' ? `&pos=${partnerPos}` : ''}`, { scroll: false });
  const [give, setGive] = useState<Set<string>>(new Set(initialGive));
  const [get, setGet] = useState<Set<string>>(new Set(initialGet));
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{
    accepted: boolean; message: string; ratio: number; requiredRatio: number;
    sendValue: number; receiveValue: number;
    explanation?: { give: string[]; receive: string[] };
    capBlock?: { shortfall: number; added: number; available: number };
  } | null>(null);
  const [intel, setIntel] = useState<TradeIntelRead | null>(null);
  const [insider, setInsider] = useState<string | null>(null);
  const [execError, setExecError] = useState<string | null>(null);
  const [partnerSuggestions, setPartnerSuggestions] = useState<TradePartnerSuggestion[] | null>(null);
  // The trade already in the books when this screen loaded. Anything newer
  // than it arrived because of a button on this page.
  const [tradeIdAtMount] = useState(lastTrade?.id ?? null);
  const [showRecap, setShowRecap] = useState(false);
  // Cap space as the server last reported it BEFORE the deal — captured at the
  // moment of Confirm, so the recap can state before and after without either
  // figure being worked out here. Both clubs, since a deal moves both books.
  const [capBefore, setCapBefore] = useState<number | null>(null);
  const [partnerCapBefore, setPartnerCapBefore] = useState<number | null>(null);

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
  //
  // The freed / added / dead totals and the space they leave are summed in one
  // pass, so the per-side lines on the deal sheet and the figure underneath
  // them cannot drift apart. Two derivations of one number is precisely how
  // this app has repeatedly shipped a screen quoting a figure it wasn't using.
  //
  // BOTH CLUBS, because a deal the other club has no room for is not a deal —
  // and the AI only says so at Propose time. `freedIfSent` and
  // `addedIfAcquired` are properties of the CONTRACT, not of a side, so the
  // partner's arithmetic is the mirror of yours off the same two fields: they
  // free what they send and take on what they receive. Those two fields are
  // the per-player halves of `tradeCapDeltas` (lib/capEnforcement.ts) — the
  // function the executor and the AI's own cap refusal both run — which is why
  // this readout and that refusal quote the same figures.
  const capFlow = useMemo(() => {
    let freed = 0;
    let dead = 0;
    let partnerAdds = 0;
    for (const id of give) {
      const r = myRoster.find((x) => x.id === id);
      if (!r) continue;
      freed += r.freedIfSent;
      dead += r.capHit - r.freedIfSent;
      partnerAdds += r.addedIfAcquired;
    }
    let added = 0;
    let partnerFrees = 0;
    for (const id of get) {
      const r = partnerRoster.find((x) => x.id === id);
      if (!r) continue;
      added += r.addedIfAcquired;
      partnerFrees += r.freedIfSent;
    }
    return {
      freed, dead, added, partnerAdds, partnerFrees,
      after: capSpace + freed - added,
      partnerAfter: partnerCapSpace === null ? null : partnerCapSpace + partnerFrees - partnerAdds,
    };
  }, [give, get, myRoster, partnerRoster, capSpace, partnerCapSpace]);

  const giveItems = useMemo(() => dealItems(give, myRoster, myPicks, 'SEND', capMode), [give, myRoster, myPicks, capMode]);
  const getItems = useMemo(() => dealItems(get, partnerRoster, partnerPicks, 'RECEIVE', capMode), [get, partnerRoster, partnerPicks, capMode]);

  // "Best trade partners" — when exactly one player is selected to shop,
  // surface which other teams actually need that position instead of making
  // the user open all 31 rosters by hand.
  // His rating travels with the position: a club already starting an 84
  // right tackle has no HOLE there and would never appear on a hole-ranked
  // list, but it would still take a 91 — see rankTradePartners.
  const shopped = useMemo(() => {
    const playerIds = [...give].filter((id) => myRoster.find((r) => r.id === id));
    if (playerIds.length !== 1) return null;
    const p = myRoster.find((r) => r.id === playerIds[0]);
    return p ? { name: p.name, position: p.position, ovr: p.ovr } : null;
  }, [give, myRoster]);
  const shoppedPosition = shopped?.position ?? null;

  useEffect(() => {
    if (!shopped) { setPartnerSuggestions(null); return; }
    let cancelled = false;
    rankTradePartnersAction(leagueId, shopped.position, myTeam.id, shopped.ovr).then((res) => {
      if (!cancelled) setPartnerSuggestions(res);
    });
    return () => { cancelled = true; };
  }, [shopped, leagueId, myTeam.id]);

  const callInsider = () => {
    startTransition(async () => {
      const r = await insiderReadAction(leagueId, partnerId, giveAssets, getAssets);
      setInsider(r.ok ? `${r.report} (${r.message})` : r.message);
    });
  };

  // The two asset lists are arguments rather than closure reads so a caller
  // that has just built a selection can evaluate THAT selection. Reviewing an
  // offer sets state and asks for an evaluation in the same pass, and the
  // state it just set is not visible to its own closure — reading giveAssets
  // there would price the PREVIOUS offer.
  const propose = (giveA: TradeAssetRef[] = giveAssets, getA: TradeAssetRef[] = getAssets) => {
    startTransition(async () => {
      // Dynasty NEGOTIATION -> Trade Intel. Read-only: this runs the same
      // evaluation the accept/reject path runs and reports the numbers behind
      // the bar. It cannot change what the AI will take.
      tradeIntelAction(leagueId, partnerId, giveA, getA).then(setIntel).catch(() => setIntel(null));
      setInsider(null);
      const evaluation = await evaluateTradeAction(leagueId, partnerId, giveA, getA);
      setResult({
        accepted: evaluation.accepted,
        ratio: evaluation.ratio,
        requiredRatio: evaluation.requiredRatio,
        sendValue: evaluation.sendValue,
        receiveValue: evaluation.receiveValue,
        // Their answer in their own words. Empty on acceptance because there
        // is nothing to answer — evaluateTrade writes no line for a yes, and
        // the verdict's own headline already says so.
        message: evaluation.accepted ? '' : evaluation.counter?.message ?? 'Rejected.',
        explanation: evaluation.explanation,
        // Carried through so the verdict can draw a cap refusal as its own
        // state. The figures behind "we can't fit this" are the evaluator's
        // own, never a second sum taken on this side of the wire.
        capBlock: evaluation.capBlock,
      });
    });
  };

  /**
   * REVIEW HAS TO ACTUALLY BUILD THE TRADE.
   * ==========================================================================
   * The offers panel sits on THIS page, so its Review link is a client-side
   * navigation to the same route with a different `reviewOffer` — React keeps
   * the mounted component and reuses its state. `useState(new Set(initialGive))`
   * runs on first mount and never again, so the assets the server had just
   * resolved off the offer were handed to a component that had already decided
   * its selection was empty: the app owner pressed Review and the builder came
   * up blank.
   *
   * Keyed on the ids themselves rather than a mount key, so this syncs when a
   * DIFFERENT offer is reviewed but does not wipe a selection the user is in
   * the middle of assembling. The evaluation goes with it — what was offered
   * is the whole question, and making him press Propose to see it is a click
   * that answers nothing.
   */
  /*
   * CHANGING CLUB THROWS AWAY THE OLD CLUB'S ANSWER.
   *
   * The verdict on screen belongs to the club that gave it. Switching partner
   * re-renders this component with new props but does NOT remount it, so an
   * ACCEPTED verdict from Cleveland used to still be sitting there — with
   * Confirm live — after the user stepped to Denver. The players in "you
   * receive" are on the old club's roster, so they silently drop out, and
   * Confirm then sent the user's own players to a club that had never seen
   * the offer, for nothing.
   *
   * What the user is giving survives on purpose: shopping the same player
   * around the league is the normal way this screen gets used, and clearing
   * his side every step would make that miserable.
   *
   * A ref rather than a plain effect body because this must NOT fire on the
   * first render — the Review deep-link below seeds both sides from props,
   * and a mount-time clear would wipe the offer the user clicked Review on.
   */
  const lastPartner = useRef(partnerId);
  useEffect(() => {
    if (lastPartner.current === partnerId) return;
    lastPartner.current = partnerId;
    setGet(new Set());
    setResult(null);
    setIntel(null);
  }, [partnerId]);

  const reviewKey = `${initialGive?.join(',') ?? ''}|${initialGet?.join(',') ?? ''}`;
  useEffect(() => {
    if (!initialGive?.length && !initialGet?.length) return;
    setGive(new Set(initialGive));
    setGet(new Set(initialGet));
    const g = assetList(new Set(initialGive), myRoster, myPicks);
    const r = assetList(new Set(initialGet), partnerRoster, partnerPicks);
    if (g.length > 0 || r.length > 0) propose(g, r);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewKey]);

  const execute = () => {
    const spaceBefore = capSpace;
    const partnerSpaceBefore = partnerCapSpace;
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
      setCapBefore(spaceBefore);
      setPartnerCapBefore(partnerSpaceBefore);
      setShowRecap(true);
      // The recap rides in on this: the page rebuilds `lastTrade` server-side
      // and the refreshed props carry both the new trade and the post-trade
      // cap sheet.
      router.refresh();
    });
  };

  const currentPartner = partners.find((p) => p.id === partnerId);
  const nothingSelected = giveAssets.length === 0 && getAssets.length === 0;
  // Only a record the refresh actually brought back counts as "just done" —
  // which also guarantees the cap figure beside it is the post-trade one.
  const recap = showRecap && lastTrade && lastTrade.id !== tradeIdAtMount ? lastTrade : null;

  return (
    <div className="space-y-4">
      {deadlinePassed && (
        <div className="panel p-3 border-warn/40 bg-warn/5 text-sm flex flex-wrap items-baseline gap-x-2">
          <span className="text-warn font-semibold">Trade deadline passed{tradeDeadlineWeek ? ` — week ${tradeDeadlineWeek}` : ''}.</span>
          <span className="text-muted">Reopens with free agency. Rosters and picks stay open below.</span>
        </div>
      )}

      {shopped && (
        <div className="panel p-3 flex items-center gap-x-3 gap-y-2 flex-wrap">
          <span className="label-sm shrink-0">Who needs a {shoppedPosition}</span>
          <span className="text-xs text-chalk shrink-0">
            {shopped.name} <span className={`stat-value text-[13px] ${ratingColor(shopped.ovr)}`}>{shopped.ovr}</span>
          </span>
          <span className="w-px h-4 bg-line hidden sm:block" />
          {partnerSuggestions === null ? (
            <span className="text-xs text-muted">Checking around the league…</span>
          ) : partnerSuggestions.length === 0 ? (
            <span className="text-xs text-muted">No club is showing significant need at {shoppedPosition} right now.</span>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {partnerSuggestions.map((s) => (
                <button
                  key={s.teamId}
                  // The same soft navigation the club switcher uses. This was a
                  // window.location.href assignment, which reloaded the whole
                  // document, dropped the position being shopped and threw the
                  // reader back to the top of the page.
                  onClick={() => goToPartner(s.teamId)}
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
        <TeamPanel
          leagueId={leagueId} title="You send" teamId={myTeam.id} teamAbbr={myTeam.abbr} teamName={myTeam.name}
          roster={myRoster} picks={myPicks} draftRounds={draftRounds} imminentYear={imminentYear}
          selected={give} onToggle={(id) => toggle(give, setGive, id)}
          // Same wrapper as the partner's, so the two headers are the same
          // height to the pixel and the pick boards below start on one line.
          meta={capMode !== 'OFF' ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="pill border-line text-muted inline-flex items-center gap-1.5">
                Cap space
                <span className={`font-mono ${capSpace >= 0 ? 'text-accent' : 'text-bad'}`}>{formatMoney(capSpace)}</span>
                <Tooltip text={tip('capSpace')} />
              </span>
            </div>
          ) : null}
        />
        <TeamPanel
          leagueId={leagueId} title="You receive" teamId={partnerId}
          teamAbbr={currentPartner?.abbr ?? ''} teamName={currentPartner?.name ?? ''}
          roster={partnerRoster} picks={partnerPicks} draftRounds={draftRounds} imminentYear={imminentYear}
          selected={get} onToggle={(id) => toggle(get, setGet, id)}
          initialPosFilter={initialPartnerPos}
          onPosFilter={setPartnerPos}
          switcher={<PartnerStepper partners={partners} partnerId={partnerId} onGo={goToPartner} />}
          // The club <select> sits in this header rather than at the top of the
          // page for the same reason the stepper does: every way of changing
          // club belongs beside the roster it changes, not a scroll away.
          selector={
            <select className="input py-1 text-sm w-full max-w-[16rem]" value={partnerId} onChange={(e) => goToPartner(e.target.value)}>
              {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          }
          meta={
            <div className="flex flex-wrap items-center gap-1.5">
              {partnerCapSpace !== null && (
                <span className="pill border-line text-muted inline-flex items-center gap-1.5">
                  Cap space
                  <span className={`font-mono ${partnerCapSpace >= 0 ? 'text-accent' : 'text-bad'}`}>{formatMoney(partnerCapSpace)}</span>
                  <Tooltip text={tip('capSpace')} />
                </span>
              )}
              {currentPartner?.philosophy && <PhilosophyBadges p={currentPartner.philosophy} />}
            </div>
          }
        />
      </div>

      {/* THE DEAL SHEET. What is actually on the table, what it does to your
          books, and the verdict once it has been put to them — one object,
          because they are one thought. */}
      <div className="panel overflow-hidden">
        <div className="grid md:grid-cols-[1fr_auto_1fr]">
          <DealSide
            teamId={myTeam.id} abbr={myTeam.abbr} heading="You send" items={giveItems}
            footer={capMode !== 'OFF' && (capFlow.freed > 0 || capFlow.partnerAdds > 0) ? (
              <>
                Frees <span className="font-mono text-accent">{formatMoney(capFlow.freed)}</span>
                {capMode === 'REALISTIC' && capFlow.dead > 0 && (
                  <>
                    {' · '}
                    <span className="inline-flex items-center gap-1">
                      dead money <span className="font-mono text-bad">{formatMoney(capFlow.dead)}</span>
                      <Tooltip text={tip('deadMoney')} />
                    </span>
                  </>
                )}
                {capFlow.partnerAdds > 0 && (
                  <> · costs {currentPartner?.abbr} <span className="font-mono text-bad">{formatMoney(capFlow.partnerAdds)}</span></>
                )}
              </>
            ) : null}
            onRemove={(id) => toggle(give, setGive, id)}
          />
          <div className="flex md:flex-col items-center justify-center px-4 py-2 md:py-6 border-y md:border-y-0 md:border-x border-line/60 bg-ink/20">
            <IconSwap className="text-muted" size={22} />
          </div>
          <DealSide
            teamId={partnerId} abbr={currentPartner?.abbr ?? ''} heading="You receive" items={getItems}
            // Picks carry no salary, so a side that is all picks moves neither
            // club's books. "Costs you $0" is a line about nothing; there is
            // nothing to say, so nothing is said.
            footer={capMode !== 'OFF' && (capFlow.added > 0 || capFlow.partnerFrees > 0) ? (
              <>
                Costs you <span className="font-mono text-bad">{formatMoney(capFlow.added)}</span>
                {capFlow.partnerFrees > 0 && (
                  <> · frees {currentPartner?.abbr} <span className="font-mono text-accent">{formatMoney(capFlow.partnerFrees)}</span></>
                )}
              </>
            ) : null}
            onRemove={(id) => toggle(get, setGet, id)}
          />
        </div>

        <div className="border-t border-line/60 bg-ink/30 px-4 py-3 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-8 flex-wrap">
            <div>
              <div className="label-sm">On the table</div>
              <div className="stat-value text-stat-sm mt-1 text-chalk tabular-nums">
                {giveItems.length} <span className="text-muted text-sm font-sans">out</span> · {getItems.length} <span className="text-muted text-sm font-sans">in</span>
              </div>
            </div>
            {/* "after" only once there is something for it to be after. An
                empty board saying "cap space after $29.9M" is a claim about a
                deal that doesn't exist. */}
            {capMode !== 'OFF' && (
              <CapAfter label={nothingSelected ? `${myTeam.abbr} cap space` : `${myTeam.abbr} cap space after`} before={capSpace} after={capFlow.after} />
            )}
            {capMode !== 'OFF' && capFlow.partnerAfter !== null && partnerCapSpace !== null && (
              <CapAfter
                label={`${currentPartner?.abbr ?? 'Their'} cap space${nothingSelected ? '' : ' after'}`}
                before={partnerCapSpace}
                after={capFlow.partnerAfter}
              />
            )}
          </div>
          <div className="flex gap-2">
            <button className="btn-secondary" disabled={pending || deadlinePassed || nothingSelected} onClick={() => propose()}>
              {pending ? 'Evaluating…' : deadlinePassed ? 'Deadline Passed' : 'Propose Trade'}
            </button>
            {result?.accepted && !deadlinePassed && (
              <button className="btn-primary" disabled={pending} onClick={execute}>Confirm &amp; Execute</button>
            )}
          </div>
        </div>
      </div>

      {execError && (
        <div className="panel p-4 border-bad/40 bg-bad/5 text-sm space-y-1">
          <div className="label-sm text-bad">Trade blocked</div>
          <p className="text-muted">{execError}</p>
        </div>
      )}

      {/* Lands exactly where the verdict was, under the button that was just
          pressed — and dismisses out of the way for the next deal. */}
      {recap && (
        <TradeRecapCard
          recap={recap}
          myTeamId={myTeam.id}
          myAbbr={myTeam.abbr}
          myName={myTeam.name}
          capBefore={capBefore}
          capAfter={capSpace}
          partnerCapBefore={partnerCapBefore}
          // Only while the screen is still pointed at the club the deal was
          // done with — walk on to the next partner and this prop is somebody
          // else's cap sheet, which would be a figure about the wrong team.
          partnerCapAfter={recap.partnerId === partnerId ? partnerCapSpace : null}
          capMode={capMode}
          onDismiss={() => setShowRecap(false)}
        />
      )}

      {result && currentPartner && (
        <TradeVerdict
          result={result}
          intel={intel}
          partner={{ id: partnerId, abbr: currentPartner.abbr, name: currentPartner.name }}
        >
          <div className="border-t border-line/60 pt-3 flex items-center gap-3 flex-wrap">
            <button type="button" className="btn-secondary text-xs" disabled={pending} onClick={callInsider}>
              Call your Insider
            </button>
            <span className="text-[11px] text-muted">Costs one of this season&apos;s Insider calls.</span>
            {insider && <span className="text-xs text-accent2 basis-full">{insider}</span>}
          </div>
        </TradeVerdict>
      )}
    </div>
  );
}

/**
 * A club's room once this deal lands. The figure it started from is only
 * printed when the deal actually moves it, so an empty board reads as one
 * number rather than as a change that hasn't happened.
 */
function CapAfter({ label, before, after }: { label: string; before: number; after: number }) {
  return (
    <div>
      <div className="label-sm inline-flex items-center gap-1.5">
        {label}
        <Tooltip text={tip('capSpace')} />
      </div>
      <div className="flex items-baseline gap-2 mt-1">
        <span className={`stat-value text-stat-sm ${after < 0 ? 'text-bad' : 'text-accent'}`}>{formatMoney(after)}</span>
        {Math.round(after) !== Math.round(before) && (
          <span className="text-[11px] text-muted whitespace-nowrap">from {formatMoney(before)}</span>
        )}
      </div>
    </div>
  );
}

/** One side of the deal sheet: what is on the table, and what it does to that club's books. */
function DealSide({ teamId, abbr, heading, items, footer, onRemove }: {
  teamId: string; abbr: string; heading: string; items: DealItem[];
  footer: ReactNode; onRemove: (id: string) => void;
}) {
  return (
    <div className="p-4 min-w-0">
      <div className="flex items-center gap-2 mb-3">
        <TeamLogo seed={teamId} abbr={abbr} size={22} />
        <span className="label-sm">{heading}</span>
        <span className="text-[11px] text-muted tabular-nums ml-auto">{items.length} {items.length === 1 ? 'asset' : 'assets'}</span>
      </div>
      {items.length === 0 ? (
        <div className="rounded-md border border-dashed border-line/60 px-3 py-2.5 text-xs text-muted">
          Nothing on the table.
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {items.map((it) => (
            <button
              key={it.id}
              type="button"
              onClick={() => onRemove(it.id)}
              aria-label={`Remove ${it.label} from the deal`}
              className="group flex items-center gap-2 rounded-md border border-accent/40 bg-accent/10 pl-2 pr-1.5 py-1.5 hover:border-bad/60 hover:bg-bad/10 transition-colors"
            >
              {it.kind === 'PLAYER' ? (
                <>
                  <span className={`text-[10px] font-semibold ${positionBadgeClass(it.position ?? '')}`}>{it.position}</span>
                  <span className={`stat-value text-[13px] ${ratingColor(it.ovr ?? 0)}`}>{it.ovr}</span>
                </>
              ) : (
                // Same tier the board just drew it in, so a first stays a
                // first once it is on the table and a seventh does not borrow
                // its colour.
                <span className={`stat-value text-[10px] uppercase tracking-wider ${pickTier(it.round ?? 7).text}`}>Pick</span>
              )}
              <span className="text-xs text-chalk">{it.label}</span>
              {it.sub && <span className="text-[10px] text-muted font-mono">{it.sub}</span>}
              <span className="text-muted group-hover:text-bad text-sm leading-none">×</span>
            </button>
          ))}
        </div>
      )}
      {footer && <div className="text-[11px] text-muted mt-3">{footer}</div>}
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

/**
 * The selected ids resolved into what the deal sheet renders. Sorted for
 * display: a Set iterates in click order, which makes the sheet a log of what
 * you clicked rather than a statement of what the deal is.
 *
 * The cap figure on a player is the one for HIS side of the trade — what
 * sending him frees, or what acquiring him costs — and both are read off the
 * row the server built (see toRosterP on the page), the same fields the
 * space-after total is summed from.
 */
function dealItems(selected: Set<string>, roster: RosterP[], picks: Pick[], side: 'SEND' | 'RECEIVE', capMode: string): DealItem[] {
  const players: DealItem[] = [];
  const chosenPicks: DealItem[] = [];
  for (const id of selected) {
    const p = roster.find((r) => r.id === id);
    if (p) {
      const cap = side === 'SEND' ? p.freedIfSent : p.addedIfAcquired;
      players.push({
        id, kind: 'PLAYER', label: p.name, position: p.position, ovr: p.ovr,
        sub: capMode !== 'OFF' && cap !== 0 ? `${side === 'SEND' ? '+' : '−'}${formatMoney(Math.abs(cap))}` : undefined,
      });
      continue;
    }
    const pick = picks.find((x) => x.id === id);
    if (pick) {
      chosenPicks.push({
        id, kind: 'PICK', label: `${pick.year} R${pick.round}`, round: pick.round,
        sub: pick.projectedSlot ? `#${pick.projectedSlot}` : pick.via ? `via ${pick.via}` : undefined,
      });
    }
  }
  players.sort((a, b) => (b.ovr ?? 0) - (a.ovr ?? 0));
  chosenPicks.sort((a, b) => a.label.localeCompare(b.label));
  return [...players, ...chosenPicks];
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

/**
 * Walk to the next club without leaving the list you are reading.
 *
 * Shopping for one position means looking at the same slot on thirty-one
 * rosters, and the only way to change club was a <select> at the very top of
 * the page: *"i need to [go to] the top of the page, change teams, then it
 * refreshes almost, and i have to re start"*. These sit in the partner panel's
 * own header, beside the roster they change.
 */
function PartnerStepper({ partners, partnerId, onGo }: {
  partners: Team[]; partnerId: string; onGo: (id: string) => void;
}) {
  const i = partners.findIndex((p) => p.id === partnerId);
  if (i < 0 || partners.length < 2) return null;
  const step = (d: number) => onGo(partners[(i + d + partners.length) % partners.length].id);
  return (
    <span className="inline-flex items-center gap-1 font-normal shrink-0">
      <button type="button" onClick={() => step(-1)} aria-label="Previous club"
        className="pill border-line text-muted hover:text-chalk px-2 py-0.5 leading-none">‹</button>
      <span className="text-[11px] text-muted tabular-nums">{i + 1}/{partners.length}</span>
      <button type="button" onClick={() => step(1)} aria-label="Next club"
        className="pill border-line text-muted hover:text-chalk px-2 py-0.5 leading-none">›</button>
    </span>
  );
}

function TeamPanel({
  leagueId, title, teamId, teamAbbr, teamName, roster, picks, draftRounds, imminentYear, selected, onToggle,
  initialPosFilter, onPosFilter, switcher, selector, meta,
}: {
  leagueId: string; title: string; teamId: string; teamAbbr: string; teamName: string; roster: RosterP[]; picks: Pick[];
  draftRounds: number; imminentYear: number | null;
  selected: Set<string>; onToggle: (id: string) => void;
  /**
   * SHOPPING A POSITION SURVIVES CHANGING CLUB. Switching partner is a real
   * navigation — the other roster has to be fetched — so this panel remounts
   * and its filter state dies with it. The app owner hit exactly that: *"i set
   * my position filter to RB, then if i want a new team, i need to [go to] the
   * top of the page, change teams, then it refreshes almost, and i have to re
   * start"*. The filter is carried in the URL so the remount restores it.
   * Optional: the user's own panel doesn't need it, only the partner's.
   */
  initialPosFilter?: string;
  onPosFilter?: (pos: string) => void;
  /** Club stepper rendered in this panel's header, so changing club never means scrolling away from the list. */
  switcher?: ReactNode;
  /** Club chooser, rendered where the club's name sits on the user's own side. */
  selector?: ReactNode;
  /** A line of context about this club — its books, or the front office running it. */
  meta?: ReactNode;
}) {
  const teamColor = generateTeamLogoParams(teamAbbr || teamId).primary;
  const [search, setSearch] = useState('');
  const [posFilter, setPosFilter] = useState(initialPosFilter ?? 'ALL');
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

  const selectedHere = roster.filter((p) => selected.has(p.id)).length + picks.filter((p) => selected.has(p.id)).length;

  return (
    <div
      className="panel border-l-[3px] p-4"
      style={{ ['--team-accent' as never]: teamColor, borderLeftColor: teamColor }}
    >
      <div className="flex items-start gap-3 mb-4">
        <TeamLogo seed={teamId} abbr={teamAbbr} size={38} className="shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          {/* min-h holds the row open on the side with no stepper in it, so
              the two panels' contents stay level with each other. */}
          <div className="flex items-center gap-2 min-h-[22px]">
            <span className="label-sm">{title}</span>
            {selectedHere > 0 && (
              <span className="pill border-accent/40 text-accent bg-accent/10 tabular-nums">{selectedHere} in the deal</span>
            )}
            {switcher && <span className="ml-auto">{switcher}</span>}
          </div>
          {/* Both panels hold the same height here whether the club is named or
              chosen, so the two pick boards below stay on one line as the eye
              crosses the screen. */}
          <div className="min-h-[34px] flex items-center mt-1">
            {selector ?? (
              <span className="font-display font-bold uppercase tracking-wide text-base text-team truncate">{teamName}</span>
            )}
          </div>
          {/* Reserved for two rows of pills, because the partner's side carries
              its front office's leanings as well as its books and wraps onto a
              second line at this width. Holding the height on BOTH sides is
              what keeps the two draft boards below on the same line as each
              other — which is the whole point of fixing the round column. */}
          <div className="mt-2 min-h-[3.25rem]">{meta}</div>
        </div>
      </div>

      <TradePickBoard
        picks={picks}
        rounds={draftRounds}
        imminentYear={imminentYear}
        selected={selected}
        onToggle={onToggle}
      />

      <div className="flex items-center gap-2 mb-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search roster…"
          className="input flex-1 text-xs py-1"
        />
        <select
          value={posFilter}
          onChange={(e) => { setPosFilter(e.target.value); onPosFilter?.(e.target.value); }}
          className="input text-xs py-1 w-20"
        >
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
            className={`flex items-center gap-2 w-full text-left px-2 py-1.5 rounded-lg text-sm cursor-pointer ${selected.has(p.id) ? 'bg-accent/10 border border-accent/30 border-l-[3px] border-l-accent' : 'hover:bg-raised border border-transparent'}`}
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
