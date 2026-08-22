/**
 * ===========================================================================
 * DOES THE METER TELL THE TRUTH?
 * ===========================================================================
 * The contract minigame draws its interest meter by running `decideOffer` in
 * the browser on every drag of a slider, and the Server Action decides what
 * actually happens by running `decideOffer` again on submit. If those two ever
 * disagree — the bar says "will sign" and the server refuses, or the reverse —
 * the meter is a lying metric, which this codebase treats as a bug class
 * (README, design principle 6) rather than a rough edge.
 *
 * Three things are checked, in increasing order of how much they can actually
 * catch:
 *
 *   1. SESSION STABILITY. The client decides against the session it was handed
 *      when talks opened; the server re-resolves one from the database at
 *      submit. Same function, different inputs is exactly how two "identical"
 *      evaluators drift apart, so the two sessions are compared field by field.
 *
 *   2. GRID SWEEP. Every offer on a salary x years x guarantee grid is run
 *      through the client's decision (client session) and the server's
 *      (re-resolved session) and every field of the answer is compared — not
 *      just `accepted`, but the interest number the bar is drawn from, the
 *      verdict word, the cap block, the auction state and whether it costs
 *      patience. Plus the model invariants the UI implies: more money never
 *      lowers interest, and the accept region is upward-closed in salary.
 *
 *   3. END TO END. A sample of offers is put through `negotiateOffer` for
 *      real, against the real database, and the outcome is compared with what
 *      the meter promised for that exact offer. This is the only one of the
 *      three that can catch a disagreement introduced by the signing path
 *      itself (cap enforcement, a competing bid closing first).
 *
 * Two more were added when the model grew a persisted resource and a rival on
 * both screens, because both are places a meter can start lying:
 *
 *   4. PATIENCE SURVIVES. The count of pips burned is server state now
 *      (prisma NegotiationTalks) rather than a number the browser sends up.
 *      It used to be the latter, which meant a page reload set it to zero and
 *      the loss condition — the entire cost of a lowball — could be cleared
 *      with F5. Section 6 below burns patience, throws the client away, and
 *      re-resolves from the database the way a reload does. It also pins the
 *      three bookkeeping rules: opening talks writes NO row, signing clears
 *      the row, and prior league years are pruned.
 *
 *   5. THE RUMOUR IS REAL. The re-sign window now names a rival club, with its
 *      cap room and its need at the position printed beside it. Section 7
 *      re-derives all three from the database, checks the quoted bid is the
 *      number that club's own `maxOffer` produces, and then puts the player on
 *      the open market and runs the actual AI wave to confirm somebody who was
 *      claimed to want him actually comes for him. A suitor that could not be
 *      checked would be the invented-metric bug class this file exists to
 *      police, moved from the meter into the flavour text.
 *
 * Three more arrived with this pass, because all three moved `decideOffer`:
 *
 *   6. THE MARKET IS NOT UNIVERSAL, AND IT IS NOT INVENTED. `leadingCompetingBid`
 *      used to answer "does any of 31 clubs have a need here" and so could only
 *      ever say yes. It now answers the wave's own question — would this club
 *      get to him, on its real slots and its real budget — so "nobody is
 *      circling" is a state that happens. Section 12 makes the claim falsifiable
 *      in the only direction it can be: it resolves a spread of free agents,
 *      runs the REAL sealed-bid wave, and fails if anybody the panel said was
 *      unwanted is signed by a rival's bid.
 *
 *   7. THE GUARANTEE FLOOR. Guaranteed money used to be a luxury: at his asking
 *      price with nothing locked in a player still read 70-88 interest, so
 *      guaranteeing zero was optimal and the slider was decoration. There is a
 *      floor now (lib/negotiation.ts, guaranteeFloorFor) that caps interest
 *      below the band, which means a whole region of the grid where NO salary
 *      signs him. Section 2 sweeps guarantee as it always did; section 13 pins
 *      the invariants that region has to obey.
 *
 *   8. SET ASIDE COSTS NOTHING. The re-sign list can park a player
 *      (NegotiationTalks.dismissedAt). It shares a table with the patience
 *      count, which is the one number the whole minigame rests on, so section 14
 *      checks against the database that parking and un-parking a man moves
 *      neither his pips nor his price — and that the advance warning names him
 *      before he is allowed to walk.
 *
 * And one more, which is the reason this pass happened at all:
 *
 *   9. THE PANEL MAY NOT CONTRADICT ITSELF. A rival used to be a number
 *      compared against your salary, computed with no reference to the meter
 *      beside it, so the app owner could photograph a screen reading 95 · WILL
 *      SIGN directly under a red "you have to beat that". A rival is a PACKAGE
 *      the player scores now (lib/negotiation.ts, THE CONTEST). Section 15
 *      sweeps the grid for the contradiction itself — "he will sign" and "he
 *      signs elsewhere" true of the same offer — re-derives the rival's term
 *      and guarantee from the functions the wave signs with, presses every chip
 *      the panel would draw to confirm it does what it says, and measures how
 *      often the rival actually wins. A rival who never wins would be as wrong
 *      as one that contradicts the meter.
 *
 * Run: npx tsx scripts/checkNegotiationAgreement.ts
 * ===========================================================================
 */

import { prisma } from '../lib/db';
import { createLeague } from '../lib/gen/league';
import { parseSettings } from '../lib/settings';
import {
  resolveNegotiationSession, negotiateOffer, runAiFreeAgencyWave, setResignSetAside, MARKET_FLOOR,
  AI_GUARANTEE_PCT,
} from '../lib/freeagency';
import { advanceWeek } from '../lib/season';
import {
  decideOffer, minimumAcceptableApy, sessionFingerprint, clampOffer,
  signBandFor, maybeChance, ACCEPT_INTEREST, guaranteeFloorFor, beatRival,
  DEFAULT_STRUCTURE, type DealStructure, type NegotiationMode,
  type NegotiationSession, type Offer, type OfferDecision,
} from '../lib/negotiation';
import { capHit, formatMoney, marketValue, willingnessHorizon, maxYearsForAge, suggestedYears, TERM } from '../lib/cap';
import { teamCapSummary } from '../lib/cap-summary';
import { maxOffer, parseGmProfile, teamNeeds, type RosterPlayer } from '../lib/ai/gm';
import { FREE_AGENCY } from '../lib/tuning';
import { Rng } from '../lib/rng';

let failures = 0;
let comparisons = 0;

/**
 * Deal shapes the user can now reach on EVERY screen. The re-sign window had
 * no structure controls at all until this pass — it passed no structure, so
 * every re-signed deal silently took the default — which means this whole
 * dimension of the state space was unreachable there and unswept here.
 */
const STRUCTURES: DealStructure[] = [
  { escalation: 0.85, voidYears: 0 },
  { escalation: 1.00, voidYears: 0 },
  { escalation: 1.12, voidYears: 0 },
  { escalation: 1.25, voidYears: 0 },
  { escalation: 0.85, voidYears: 3 },
  { escalation: 1.12, voidYears: 2 },
  { escalation: 1.25, voidYears: 3 },
];

/**
 * What a NUMBER FIELD can produce and a slider cannot.
 *
 * The panel grew typed entry beside every slider, so the reachable offer
 * space stopped being a grid: any dollar amount, any whole year, any whole
 * percent — and, because it is a text box, also empty, negative, 1e9, NaN and
 * Infinity. Every one of those has to end up somewhere legal and has to end up
 * in the SAME legal place on both sides of the wire, which is what
 * `clampOffer` is for and what this probe set exists to sweep.
 */
function typedEntryProbes(gate: NegotiationSession['gate']): Offer[] {
  const mid = Math.round((gate.minSalary + gate.maxSalary) / 2);
  const salaries = [
    Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY,
    -1, 0, 1, 1e9, 1e15,
    gate.minSalary, gate.minSalary + 1, gate.minSalary + 37_413,
    mid, mid + 1, mid + 12_345, mid - 99_999,
    gate.maxSalary - 1, gate.maxSalary, gate.maxSalary + 5_000_000,
  ];
  const years = [Number.NaN, -3, 0, 1, 2, 7, gate.maxYears, gate.maxYears + 5, 1e6];
  const guarantees = [Number.NaN, -0.5, 0, 0.01, 0.375, 0.999, 1, 5];
  const out: Offer[] = [];
  // Not the full cross product — that is 1,300 points per subject of mostly
  // repeated clamping. One pass pairing them off, plus every salary against a
  // legal middle, covers each field's edges against a live neighbour.
  for (const apy of salaries) {
    for (let i = 0; i < years.length; i++) {
      out.push({ apy, years: years[i], guaranteePct: guarantees[i % guarantees.length] });
    }
  }
  return out;
}

function fail(msg: string) {
  failures++;
  if (failures <= 20) console.error(`  FAIL: ${msg}`);
}

/** Every field of the answer, not just the yes/no. */
function sameDecision(a: OfferDecision, b: OfferDecision): string | null {
  const keys: (keyof OfferDecision)[] = [
    // `signBand` and `accepted` are two different claims now and both are
    // compared. The band is what the panel DRAWS; `accepted` is the hidden
    // draw the server ACTS on. A meter that agreed about the band and
    // disagreed about the outcome would be the subtlest lying metric this
    // file has ever had to catch, so neither is allowed to drift alone.
    // `rivalInterest` is the number the meter draws the rival's mark from and
    // `outbid` is the answer it feeds. Both are compared because the contest
    // is now part of the decision rather than a warning printed beside it —
    // see THE CONTEST in lib/negotiation.ts.
    'accepted', 'signBand', 'blocked', 'outbid', 'rivalInterest', 'costsPatience', 'patienceCost',
    'maxPatienceCost', 'year1CapHit',
    'totalValue', 'guaranteedMoney', 'deadMoneyIfCut', 'strandedVoidMoney', 'reason',
  ];
  for (const k of keys) if (a[k] !== b[k]) return `${String(k)}: client ${JSON.stringify(a[k])} vs server ${JSON.stringify(b[k])}`;
  if (a.evaluation.interest !== b.evaluation.interest) return `interest: ${a.evaluation.interest} vs ${b.evaluation.interest}`;
  if (a.evaluation.verdict !== b.evaluation.verdict) return `verdict: ${a.evaluation.verdict} vs ${b.evaluation.verdict}`;
  if (a.evaluation.insulting !== b.evaluation.insulting) return `insulting: ${a.evaluation.insulting} vs ${b.evaluation.insulting}`;
  if (a.evaluation.underGuaranteed !== b.evaluation.underGuaranteed) return `underGuaranteed: ${a.evaluation.underGuaranteed} vs ${b.evaluation.underGuaranteed}`;
  return null;
}

async function main() {
  const leagueId = await createLeague({ name: 'NEGOTIATION AGREEMENT CHECK', userTeamAbbr: 'NYG', seed: 'nego-agreement' });
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const settings = parseSettings(league.settings);
  const team = await prisma.team.findFirstOrThrow({ where: { leagueId, isUser: true } });

  const freeAgents = await prisma.player.findMany({
    where: { leagueId, status: 'FREE_AGENT', teamId: null, isDraftee: false },
    orderBy: { trueOvr: 'desc' },
    take: 60,
  });
  const own = await prisma.player.findMany({
    where: { teamId: team.id, status: 'ACTIVE' },
    include: { contract: true },
    orderBy: { trueOvr: 'desc' },
    take: 10,
  });

  // WIDENING THE SWEEP FOR THE RE-SIGN CLOCK.
  //
  // An incumbent's context is no longer one shape. It now depends on which
  // half of the re-sign window he is in (lib/negotiation.ts, ResignWindow):
  // in his WALK_YEAR the loyalty discount is at full size and a rumoured
  // suitor barely registers, at FINAL_CALL the discount has mostly gone and
  // the same suitor is nearly a bid. Different reservation price, different
  // patience, different slider ceiling — a sweep that only ever saw one of the
  // two would be checking half the state space the panel can actually be in.
  //
  // The window is read off `contract.yearsRemaining`, so the scratch league's
  // contracts are pinned to give us both. This league is created and dropped
  // by this script; nothing else ever sees it.
  const walkYear = own.slice(0, 3);
  const finalCall = own.slice(3, 6);
  // AND THE THIRD SCREEN. Extensions run through `decideOffer` now instead of
  // through a form the server rubber-stamped, so they belong in this sweep on
  // exactly the same terms as the other two: a man under contract with real
  // years left, nobody able to bid on him, and those years of control priced
  // as leverage. Pinned to three years remaining, which is what makes him an
  // extension rather than a re-sign.
  const underContract = own.slice(6, 9);
  await prisma.contract.updateMany({ where: { playerId: { in: walkYear.map((p) => p.id) } }, data: { yearsRemaining: 1 } });
  await prisma.contract.updateMany({ where: { playerId: { in: finalCall.map((p) => p.id) } }, data: { yearsRemaining: 0 } });
  // Only `yearsRemaining` is pinned — never `years`. Forcing both invents a
  // contract whose baseSalaries array is a different length from the term it
  // claims, which is not a state the game can produce and only ever tests the
  // fixture. Any deal of three years or more will do.
  for (const p of underContract) {
    const c = await prisma.contract.findUnique({ where: { playerId: p.id }, select: { years: true } });
    if (c) await prisma.contract.update({ where: { playerId: p.id }, data: { yearsRemaining: Math.min(3, c.years) } });
  }

  // A spread of the market, not just the top of it: the model's shape changes
  // with age (term limits), rating (patience) and rival interest.
  const sweepSubjects: { p: typeof freeAgents[number]; incumbent: boolean; mode: NegotiationMode }[] = [
    ...freeAgents.slice(0, 4).map((p) => ({ p, incumbent: false, mode: 'FREE_AGENT' as const })),
    ...freeAgents.slice(20, 23).map((p) => ({ p, incumbent: false, mode: 'FREE_AGENT' as const })),
    ...walkYear.map((p) => ({ p, incumbent: true, mode: 'RESIGN' as const })),
    ...finalCall.map((p) => ({ p, incumbent: true, mode: 'RESIGN' as const })),
    ...underContract.map((p) => ({ p, incumbent: true, mode: 'EXTENSION' as const })),
  ];

  console.log(`\nLeague ${leagueId} — ${sweepSubjects.length} negotiations under test\n`);

  let gridPoints = 0;
  let typedPoints = 0;
  let shapePoints = 0;
  let guaranteePoints = 0;

  for (const { p, incumbent, mode } of sweepSubjects) {
    // What the browser was handed when talks opened...
    const clientSession: NegotiationSession = await resolveNegotiationSession({
      leagueId, playerId: p.id, teamId: team.id, seasonYear: league.seasonYear, settings, incumbent, mode,
    });
    // ...and what the Server Action resolves for itself on submit.
    const serverSession: NegotiationSession = await resolveNegotiationSession({
      leagueId, playerId: p.id, teamId: team.id, seasonYear: league.seasonYear, settings, incumbent, mode,
    });

    if (sessionFingerprint(clientSession) !== sessionFingerprint(serverSession)) {
      fail(`${p.firstName} ${p.lastName}: session is not stable across resolves`);
    }
    if (JSON.stringify(clientSession) !== JSON.stringify(serverSession)) {
      fail(`${p.firstName} ${p.lastName}: session fields differ across resolves`);
    }

    const { ctx, gate } = clientSession;
    const salaries: number[] = [];
    for (let s = gate.minSalary; s <= gate.maxSalary; s += 100_000) salaries.push(s);
    const guarantees: number[] = [];
    for (let g = 0; g <= 100; g += 5) guarantees.push(g / 100);

    let acceptedCount = 0;
    for (let years = 1; years <= gate.maxYears; years++) {
      for (const guaranteePct of guarantees) {
        let lastInterest = -1;
        let seenAccept = false;
        for (const apy of salaries) {
          const offer: Offer = { apy, years, guaranteePct };
          const client = decideOffer(ctx, offer, gate, DEFAULT_STRUCTURE);
          const server = decideOffer(serverSession.ctx, offer, serverSession.gate, DEFAULT_STRUCTURE);
          comparisons++;
          gridPoints++;
          const diff = sameDecision(client, server);
          if (diff) fail(`${p.firstName} ${p.lastName} @ ${formatMoney(apy)}/${years}yr/${Math.round(guaranteePct * 100)}% — ${diff}`);

          // Model invariants the UI promises just by being a slider.
          if (client.evaluation.interest < lastInterest) {
            fail(`${p.firstName} ${p.lastName}: interest went DOWN as salary went up (${lastInterest} -> ${client.evaluation.interest} at ${formatMoney(apy)})`);
          }
          lastInterest = client.evaluation.interest;
          if (client.evaluation.accepted) seenAccept = true;
          else if (seenAccept) {
            fail(`${p.firstName} ${p.lastName}: accept region not upward-closed in salary at ${formatMoney(apy)}`);
          }
          if (client.accepted) acceptedCount++;
        }

        // The bisection used by the Market Knowledge estimate has to land on
        // the same boundary the sweep walks past.
        const min = minimumAcceptableApy(ctx, years, guaranteePct);
        if (min == null) {
          // "No price closes this" has to mean exactly that on the grid too.
          if (seenAccept) fail(`${p.firstName} ${p.lastName}: minimumAcceptableApy(${years}yr) says never, but the grid found a signable offer`);
        } else {
          const below = decideOffer(ctx, { apy: Math.max(gate.minSalary, min - 100_000), years, guaranteePct }, gate, DEFAULT_STRUCTURE);
          const at = decideOffer(ctx, { apy: min, years, guaranteePct }, gate, DEFAULT_STRUCTURE);
          if (!at.evaluation.accepted) {
            fail(`${p.firstName} ${p.lastName}: minimumAcceptableApy(${years}yr) = ${formatMoney(min)} is not accepted`);
          }
          if (min > gate.minSalary && below.evaluation.accepted && min - 100_000 >= gate.minSalary) {
            fail(`${p.firstName} ${p.lastName}: ${formatMoney(min - 100_000)} accepted below minimumAcceptableApy ${formatMoney(min)}`);
          }
        }
      }
    }

    // --- Typed entry ------------------------------------------------------
    for (const raw of typedEntryProbes(gate)) {
      const offer = clampOffer(raw, gate);
      comparisons++;
      typedPoints++;
      if (!Number.isFinite(offer.apy) || offer.apy < gate.minSalary || offer.apy > gate.maxSalary) {
        fail(`${p.lastName}: clampOffer let a salary out of range (${JSON.stringify(raw)} -> ${offer.apy})`);
      }
      if (!Number.isInteger(offer.years) || offer.years < 1 || offer.years > gate.maxYears) {
        fail(`${p.lastName}: clampOffer let a term out of range (${JSON.stringify(raw)} -> ${offer.years})`);
      }
      if (!Number.isFinite(offer.guaranteePct) || offer.guaranteePct < 0 || offer.guaranteePct > 1) {
        fail(`${p.lastName}: clampOffer let a guarantee out of range (${JSON.stringify(raw)} -> ${offer.guaranteePct})`);
      }
      // The panel clamps, then the Server Action clamps what the panel sent.
      // If that second pass could move anything, the meter would be drawn for
      // one offer and the server would judge another.
      if (JSON.stringify(clampOffer(offer, gate)) !== JSON.stringify(offer)) {
        fail(`${p.lastName}: clampOffer is not idempotent at ${JSON.stringify(offer)}`);
      }
      const client = decideOffer(ctx, offer, gate, DEFAULT_STRUCTURE);
      const server = decideOffer(serverSession.ctx, offer, serverSession.gate, DEFAULT_STRUCTURE);
      const diff = sameDecision(client, server);
      if (diff) fail(`${p.lastName} typed ${JSON.stringify(raw)} -> ${JSON.stringify(offer)} — ${diff}`);
      if (!Number.isFinite(client.evaluation.interest) || !Number.isFinite(client.year1CapHit)) {
        fail(`${p.lastName}: a typed offer produced a non-finite figure (${JSON.stringify(raw)})`);
      }
    }

    // --- Deal shape -------------------------------------------------------
    // Front-load, back-load and void years, on every screen. They may never
    // move the meter (he does not judge your cap accounting) and they must
    // always move the ledger the same way on both sides.
    const shapeSalaries = [gate.minSalary, Math.round(ctx.reservationApy * 0.8), ctx.reservationApy, gate.maxSalary];
    const shapeTerms = [1, Math.min(4, gate.maxYears), gate.maxYears];
    for (const structure of STRUCTURES) {
      for (const apy of shapeSalaries) {
        for (const yrs of shapeTerms) {
          const offer = clampOffer({ apy, years: yrs, guaranteePct: 0.5 }, gate);
          const client = decideOffer(ctx, offer, gate, structure);
          const server = decideOffer(serverSession.ctx, offer, serverSession.gate, structure);
          comparisons++;
          shapePoints++;
          const diff = sameDecision(client, server);
          if (diff) fail(`${p.lastName} @ escalation ${structure.escalation}/void ${structure.voidYears} — ${diff}`);
          const flat = decideOffer(ctx, offer, gate, DEFAULT_STRUCTURE);
          if (client.evaluation.interest !== flat.evaluation.interest) {
            fail(`${p.lastName}: deal shape moved the INTEREST meter (${flat.evaluation.interest} -> ${client.evaluation.interest}) — he does not judge your cap accounting`);
          }
        }
      }
    }

    // --- The guarantee floor -----------------------------------------------
    //
    // Guaranteed money is no longer a luxury: under `ctx.guaranteeFloor` the
    // interest bar is capped below the band, which is a claim with teeth —
    // there is NO salary that signs him. Three things have to hold, and the
    // first is the one that would quietly turn the cap into a lie.
    {
      if (ctx.guaranteeFloor < 0 || ctx.guaranteeFloor > 0.5) {
        fail(`${p.lastName}: guarantee floor ${ctx.guaranteeFloor} is outside 0..0.5`);
      }
      if (ctx.guaranteeFloor > ctx.desiredGuarantee) {
        fail(`${p.lastName}: guarantee floor ${ctx.guaranteeFloor} is above what he ASKS for (${ctx.desiredGuarantee}) — the floor is where he stops listening, not where he is happy`);
      }
      if (ctx.guaranteeFloor !== guaranteeFloorFor(p.trueOvr, ctx.personality)) {
        fail(`${p.lastName}: context floor ${ctx.guaranteeFloor} is not what guaranteeFloorFor(${p.trueOvr}, ${ctx.personality}) produces`);
      }
      const years = Math.min(ctx.desiredYears, gate.maxYears, ctx.willingYears);
      let lastInterest = -1;
      for (let g = 0; g <= 100; g++) {
        const guaranteePct = g / 100;
        // The most money the panel can possibly offer. If HE will not sign at
        // the ceiling, no salary signs him — which is exactly what the cap is
        // claiming, so this is the claim, tested.
        const offer = clampOffer({ apy: gate.maxSalary, years, guaranteePct }, gate);
        const client = decideOffer(ctx, offer, gate, DEFAULT_STRUCTURE);
        const server = decideOffer(serverSession.ctx, offer, serverSession.gate, DEFAULT_STRUCTURE);
        comparisons++;
        guaranteePoints++;
        const diff = sameDecision(client, server);
        if (diff) fail(`${p.lastName} @ ${g}% guaranteed — ${diff}`);
        if (client.evaluation.underGuaranteed !== (guaranteePct < ctx.guaranteeFloor)) {
          fail(`${p.lastName}: underGuaranteed disagrees with the floor at ${g}%`);
        }
        if (client.evaluation.underGuaranteed && client.signBand !== 'NO') {
          fail(`${p.lastName}: an under-guaranteed offer at the salary ceiling still reads ${client.signBand} — the cap does not hold`);
        }
        if (client.evaluation.underGuaranteed && minimumAcceptableApy(ctx, years, guaranteePct) !== null) {
          fail(`${p.lastName}: minimumAcceptableApy quoted a price for an offer under his guarantee floor`);
        }
        // More guaranteed is never worse, exactly as more money is never worse.
        // The cap makes this the only place the meter could have gone
        // backwards, since it lifts in one step at the floor.
        if (client.evaluation.interest < lastInterest) {
          fail(`${p.lastName}: interest went DOWN as the guarantee went up (${lastInterest} -> ${client.evaluation.interest} at ${g}%)`);
        }
        lastInterest = client.evaluation.interest;
      }
    }

    const screen = mode === 'FREE_AGENT' ? 'free agent'
      : mode === 'EXTENSION' ? `extension/${ctx.controlYears}yr control`
      : `re-sign/${ctx.resignWindow}`;
    console.log(
      `  ${(p.firstName + ' ' + p.lastName).padEnd(22)} ${p.position.padEnd(4)} ${String(p.trueOvr).padStart(2)}ovr ` +
      `${screen.padEnd(22)} ${ctx.personality.padEnd(10)} ` +
      `asks ~${formatMoney(ctx.reservationApy)}/yr, patience ${ctx.patience}, ` +
      `term<=${ctx.willingYears} (won't play past ${ctx.intendedFinalAge}), band +-${ctx.bandHalfWidth}, ` +
      `suitor ${clientSession.suitor ? `${clientSession.suitor.teamAbbr} ${formatMoney(clientSession.suitor.apy)}` : 'none'}, ` +
      `guarantee floor ${Math.round(ctx.guaranteeFloor * 100)}%, ` +
      `${acceptedCount} signable offers on the grid`,
    );
  }

  console.log(
    `\nGrid: ${gridPoints.toLocaleString()} offers compared (salary x years x guarantee, client session vs server session)` +
    `\n      ${typedPoints.toLocaleString()} typed-entry probes (values no slider can produce, plus empty/negative/1e9/NaN)` +
    `\n      ${shapePoints.toLocaleString()} deal shapes (front-load, back-load, void years — on all three screens)` +
    `\n      ${guaranteePoints.toLocaleString()} guarantee points at the salary ceiling (the floor's "no price signs this" claim)\n`,
  );

  // --- 3. End to end -------------------------------------------------------
  // Real submissions against the real database. Each player is used once, so
  // an acceptance is a genuine signing and a refusal is a genuine refusal.
  console.log('End-to-end submissions (meter promise vs what the database did):\n');
  const rng = new Rng('nego-e2e');
  const e2eSubjects = freeAgents.slice(4, 20);
  let e2eSigned = 0, e2eRefused = 0, e2eLost = 0;

  for (const p of e2eSubjects) {
    const session = await resolveNegotiationSession({
      leagueId, playerId: p.id, teamId: team.id, seasonYear: league.seasonYear, settings, incumbent: false,
    });
    const { ctx, gate } = session;
    // A spread: hopeless lowballs, near-misses, fair deals and overpays.
    const factor = rng.pick([0.45, 0.7, 0.85, 0.95, 1.0, 1.15, 1.4]);
    const apy = Math.min(gate.maxSalary, Math.max(gate.minSalary, Math.round((ctx.reservationApy * factor) / 100_000) * 100_000));
    const offer: Offer = { apy, years: Math.min(ctx.desiredYears, gate.maxYears), guaranteePct: 0.5 };
    const predicted = decideOffer(ctx, offer, gate, DEFAULT_STRUCTURE);

    const outcome = await negotiateOffer({
      leagueId, playerId: p.id, teamId: team.id, seasonYear: league.seasonYear, week: league.week,
      settings, incumbent: false, offer, structure: DEFAULT_STRUCTURE,
      fingerprint: sessionFingerprint(session),
    });

    comparisons++;
    if (outcome.ok !== predicted.accepted) {
      fail(`${p.firstName} ${p.lastName}: meter said ${predicted.accepted ? 'ACCEPT' : 'no'} (${predicted.evaluation.interest}), server said ${outcome.ok ? 'signed' : 'no'} — "${outcome.message}"`);
    }

    // And the database has to agree with the outcome object, too.
    const after = await prisma.player.findUniqueOrThrow({ where: { id: p.id }, select: { teamId: true } });
    if (outcome.ok && after.teamId !== team.id) fail(`${p.firstName} ${p.lastName}: reported signed but is not on the roster`);
    if (!outcome.ok && !outcome.lostTo && after.teamId !== null) fail(`${p.firstName} ${p.lastName}: reported refused but left free agency`);
    if (outcome.lostTo && after.teamId === team.id) fail(`${p.firstName} ${p.lastName}: reported lost but signed with us`);
    if (!outcome.ok && !outcome.lostTo) {
      const expected = predicted.patienceCost;
      if (outcome.patienceSpent !== expected) {
        fail(`${p.firstName} ${p.lastName}: patience cost ${outcome.patienceSpent}, meter implied ${expected}`);
      }
      e2eRefused++;
    }
    if (outcome.ok) e2eSigned++;
    if (outcome.lostTo) e2eLost++;

    console.log(
      `  ${(p.firstName + ' ' + p.lastName).padEnd(22)} ${formatMoney(apy).padStart(7)}/yr vs ~${formatMoney(ctx.reservationApy)} ask ` +
      `— meter ${String(predicted.evaluation.interest).padStart(3)} ${predicted.evaluation.verdict.padEnd(11)} ` +
      `-> ${outcome.ok ? 'SIGNED' : outcome.lostTo ? 'LOST TO RIVAL' : 'refused'} (patience ${outcome.patienceSpent}/${ctx.patience})`,
    );
  }

  console.log(`\n${e2eSigned} signed, ${e2eRefused} refused, ${e2eLost} lost to a rival bid.`);

  // --- 4. Running out of patience with a rival at the table ----------------
  // The one consequence that outlives the page: when the pips are gone and
  // somebody else is bidding, he signs there and he is not coming back.
  console.log('\nPatience burn-down (a contested free agent, lowballed until his agent quits):\n');
  const contested: typeof freeAgents = [];
  for (const p of freeAgents.slice(20)) {
    const s = await resolveNegotiationSession({
      leagueId, playerId: p.id, teamId: team.id, seasonYear: league.seasonYear, settings, incumbent: false,
    });
    if (s.gate.rival) { contested.push(p); if (contested.length >= 2) break; }
  }
  for (const p of contested) {
    let spent = 0;
    let guard = 0;
    for (;;) {
      const session = await resolveNegotiationSession({
        leagueId, playerId: p.id, teamId: team.id, seasonYear: league.seasonYear, settings, incumbent: false,
      });
      const offer: Offer = {
        apy: Math.max(session.gate.minSalary, Math.round(session.ctx.reservationApy * 0.6 / 100_000) * 100_000),
        years: Math.min(session.ctx.desiredYears, session.gate.maxYears),
        guaranteePct: 0.5,
      };
      const predicted = decideOffer(session.ctx, offer, session.gate, DEFAULT_STRUCTURE);
      const outcome = await negotiateOffer({
        leagueId, playerId: p.id, teamId: team.id, seasonYear: league.seasonYear, week: league.week,
        settings, incumbent: false, offer, structure: DEFAULT_STRUCTURE,
        fingerprint: sessionFingerprint(session),
      });
      comparisons++;
      if (outcome.ok !== predicted.accepted) fail(`${p.lastName}: burn-down meter/server disagreement`);
      console.log(`  ${p.lastName.padEnd(14)} offer ${formatMoney(offer.apy)} vs ~${formatMoney(session.ctx.reservationApy)} — patience ${outcome.patienceSpent}/${session.ctx.patience}${outcome.lostTo ? ` — LOST to the ${outcome.lostTo.teamName} at ${formatMoney(outcome.lostTo.apy)}/yr` : ''}`);
      // Nothing is carried between iterations any more — each pass re-resolves
      // the session from scratch, exactly as a reloaded page does. If the count
      // did not persist, this loop would never terminate.
      if (outcome.patienceSpent <= spent) {
        fail(`${p.lastName}: patience did not advance across a fresh resolve (${spent} -> ${outcome.patienceSpent})`);
      }
      if (session.patienceSpent !== spent) {
        fail(`${p.lastName}: re-resolved session reported ${session.patienceSpent} spent, ${spent} was charged`);
      }
      spent = outcome.patienceSpent;
      if (outcome.walkedAway || outcome.lostTo) {
        const after = await prisma.player.findUniqueOrThrow({ where: { id: p.id }, select: { teamId: true } });
        if (outcome.lostTo && after.teamId === null) fail(`${p.lastName}: reported lost to a rival but is still a free agent`);
        if (!outcome.lostTo && after.teamId !== null) fail(`${p.lastName}: walked away but signed somewhere`);
        break;
      }
      if (++guard > 12) { fail(`${p.lastName}: patience never ran out`); break; }
    }
  }

  // --- 5. A cap-illegal offer is refused, and costs nothing ----------------
  //
  // THIS TEST HAD TO CHANGE SHAPE, and the reason is itself worth pinning. It
  // used to offer `capSpace + $20M`, which is above the slider ceiling — and
  // now that typed entry exists, both the panel and the Server Action clamp an
  // offer into the legal range before judging it, so such a number no longer
  // survives to be judged. Making the offer unaffordable therefore has to be
  // done by making the TEAM poor, not by naming an impossible figure. A dead
  // money charge does it, which is how a team gets poor in this game anyway.
  const poor = freeAgents[0];
  {
    const before = await teamCapSummary(team.id, league.seasonYear, settings.capMode);
    const squeeze = Math.max(0, before.capSpace - 1_000_000);
    const charge = await prisma.capCharge.create({
      data: { teamId: team.id, year: league.seasonYear, amount: squeeze, label: 'AGREEMENT CHECK — cap squeeze' },
    });

    const session = await resolveNegotiationSession({
      leagueId, playerId: poor.id, teamId: team.id, seasonYear: league.seasonYear, settings, incumbent: false,
    });
    // The most the panel could possibly ask for, against a team with a million
    // dollars of room.
    const offer = clampOffer({ apy: session.gate.maxSalary, years: 1, guaranteePct: 0.5 }, session.gate);
    const predicted = decideOffer(session.ctx, offer, session.gate, DEFAULT_STRUCTURE);
    const outcome = await negotiateOffer({
      leagueId, playerId: poor.id, teamId: team.id, seasonYear: league.seasonYear, week: league.week,
      settings, incumbent: false, offer, structure: DEFAULT_STRUCTURE,
      fingerprint: sessionFingerprint(session),
    });
    comparisons++;
    if (predicted.blocked !== 'CAP') fail(`a maximal offer against ${formatMoney(session.gate.capSpace)} of room was not cap-blocked by the meter`);
    if (outcome.ok) fail('the server signed a cap-illegal deal');
    if (outcome.patienceSpent !== 0) fail('a cap refusal cost patience');
    console.log(`\nCap gate: ${formatMoney(offer.apy)}/yr against ${formatMoney(session.gate.capSpace)} of room — meter blocked=${predicted.blocked}, server refused, patience ${outcome.patienceSpent}. "${outcome.message}"`);

    await prisma.capCharge.delete({ where: { id: charge.id } });
  }

  // --- 6. Patience survives a reload, and the ledger stays bounded ---------
  //
  // THE EXPLOIT THIS CLOSED. `patienceSpent` used to be a number the browser
  // handed to the Server Action. Pressing F5 sent zero, the server had nothing
  // to check it against, and the loss condition evaporated — you could lowball
  // one free agent forever. The whole point of the minigame is that a lowball
  // costs something, so this section is the guard on it.
  //
  // "Reload" is modelled honestly: every client object is thrown away and the
  // session is resolved fresh from the database, which is exactly what a new
  // page load does. Nothing is passed between the two halves.
  console.log('\nPatience across a reload (client state discarded between offers):\n');
  {
    const subject = freeAgents.slice(1, 4).find((p) => p.id !== poor.id)!;
    const key = { teamId_playerId_seasonYear: { teamId: team.id, playerId: subject.id, seasonYear: league.seasonYear } };

    // (a) OPENING TALKS IS FREE. A GM who opens forty negotiations and walks
    //     away from all forty must not leave forty rows behind, so a row is
    //     only ever written when patience is actually spent.
    const beforeOpen = await prisma.negotiationTalks.findUnique({ where: key });
    const opened = await resolveNegotiationSession({
      leagueId, playerId: subject.id, teamId: team.id, seasonYear: league.seasonYear, settings, incumbent: false,
    });
    const afterOpen = await prisma.negotiationTalks.findUnique({ where: key });
    comparisons++;
    if (beforeOpen !== null || afterOpen !== null) fail('opening talks wrote a NegotiationTalks row — abandoned negotiations would accumulate');
    if (opened.patienceSpent !== 0) fail(`fresh talks opened with ${opened.patienceSpent} patience already spent`);

    // (b) A REFUSAL IS CHARGED, AND IT IS IN THE DATABASE.
    const lowball: Offer = {
      apy: Math.max(opened.gate.minSalary, Math.round(opened.ctx.reservationApy * 0.5 / 100_000) * 100_000),
      years: Math.min(opened.ctx.desiredYears, opened.gate.maxYears),
      guaranteePct: 0.5,
    };
    const first = await negotiateOffer({
      leagueId, playerId: subject.id, teamId: team.id, seasonYear: league.seasonYear, week: league.week,
      settings, incumbent: false, offer: lowball, structure: DEFAULT_STRUCTURE,
      fingerprint: sessionFingerprint(opened),
    });
    const row = await prisma.negotiationTalks.findUnique({ where: key });
    comparisons++;
    if (!row) fail('a refused offer left no NegotiationTalks row');
    if (row && row.patienceSpent !== first.patienceSpent) {
      fail(`database says ${row.patienceSpent} spent, the outcome said ${first.patienceSpent}`);
    }

    // (c) THE RELOAD. Everything above is discarded; the session is resolved
    //     the way a cold page load resolves it. The count has to still be there.
    const reloaded = await resolveNegotiationSession({
      leagueId, playerId: subject.id, teamId: team.id, seasonYear: league.seasonYear, settings, incumbent: false,
    });
    comparisons++;
    if (reloaded.patienceSpent !== first.patienceSpent) {
      fail(`patience did not survive a reload: ${first.patienceSpent} spent, session reloaded with ${reloaded.patienceSpent}`);
    }
    console.log(`  ${subject.lastName}: lowballed once (cost ${first.patienceSpent}), session re-resolved from the database -> ${reloaded.patienceSpent}/${reloaded.ctx.patience} spent`);

    // (d) A SECOND OFFER CONTINUES THE COUNT rather than restarting it — the
    //     actual shape of the exploit, which was "reload, offer again, free".
    const second = await negotiateOffer({
      leagueId, playerId: subject.id, teamId: team.id, seasonYear: league.seasonYear, week: league.week,
      settings, incumbent: false, offer: lowball, structure: DEFAULT_STRUCTURE,
      fingerprint: sessionFingerprint(reloaded),
    });
    comparisons++;
    if (!second.lostTo && second.patienceSpent <= first.patienceSpent) {
      fail(`a post-reload offer restarted the count (${first.patienceSpent} -> ${second.patienceSpent})`);
    }
    console.log(`  ${subject.lastName}: offered again after the reload -> ${second.patienceSpent}/${reloaded.ctx.patience} spent${second.lostTo ? ` — LOST to the ${second.lostTo.teamName}` : ''}`);

    // (e) PRIOR LEAGUE YEARS ARE PRUNED. A new year is a new negotiation, so
    //     last year's rows can never be read again; leaving them would grow the
    //     table for the life of the save.
    await prisma.negotiationTalks.create({
      data: { leagueId, teamId: team.id, playerId: poor.id, seasonYear: league.seasonYear - 1, patienceSpent: 3 },
    });
    await negotiateOffer({
      leagueId, playerId: subject.id, teamId: team.id, seasonYear: league.seasonYear, week: league.week,
      settings, incumbent: false, offer: lowball, structure: DEFAULT_STRUCTURE,
    });
    const stale = await prisma.negotiationTalks.count({ where: { leagueId, seasonYear: { lt: league.seasonYear } } });
    comparisons++;
    if (stale !== 0) fail(`${stale} row(s) from a previous league year survived a charge — the ledger is unbounded`);
    console.log(`  Prior-year rows after a charge: ${stale} (pruned)`);

    // (f) SIGNING CLEARS THE ROW. He is no longer a negotiation, and if he is
    //     ever cut back onto the market that is a NEW one, with full pips.
    //     A different player, untouched so far, so there is patience left to
    //     burn before the closing offer — the point being that a row exists to
    //     be cleared.
    const signSubject = freeAgents.find((f) => f.id !== subject.id && f.id !== poor.id && f.teamId === null)!;
    const signKey = { teamId_playerId_seasonYear: { teamId: team.id, playerId: signSubject.id, seasonYear: league.seasonYear } };
    const openTalks = await resolveNegotiationSession({
      leagueId, playerId: signSubject.id, teamId: team.id, seasonYear: league.seasonYear, settings, incumbent: false,
    });
    await negotiateOffer({
      leagueId, playerId: signSubject.id, teamId: team.id, seasonYear: league.seasonYear, week: league.week,
      settings, incumbent: false, structure: DEFAULT_STRUCTURE,
      offer: { apy: openTalks.gate.minSalary, years: 1, guaranteePct: 0 },
    });
    const rowBeforeSigning = await prisma.negotiationTalks.findUnique({ where: signKey });
    const closing = await resolveNegotiationSession({
      leagueId, playerId: signSubject.id, teamId: team.id, seasonYear: league.seasonYear, settings, incumbent: false,
    });
    const generous = await negotiateOffer({
      leagueId, playerId: signSubject.id, teamId: team.id, seasonYear: league.seasonYear, week: league.week,
      settings, incumbent: false,
      offer: {
        apy: Math.min(closing.gate.maxSalary, Math.round(Math.max(closing.ctx.reservationApy * 1.4, (closing.gate.rival?.offer.apy ?? 0) * 1.25) / 100_000) * 100_000),
        years: Math.min(closing.ctx.desiredYears, closing.gate.maxYears),
        guaranteePct: 0.8,
      },
      structure: DEFAULT_STRUCTURE,
    });
    const afterSigning = await prisma.negotiationTalks.findUnique({ where: signKey });
    comparisons++;
    if (!rowBeforeSigning) fail(`${signSubject.lastName}: no row to clear — the refusal before the signing was not charged`);
    if (!generous.ok) fail(`${signSubject.lastName}: could not be signed to test that signing clears his row — "${generous.message}"`);
    if (generous.ok && afterSigning !== null) fail(`${signSubject.lastName}: signing him left his negotiation row behind`);
    console.log(
      `  ${signSubject.lastName}: ${rowBeforeSigning?.patienceSpent ?? 0} pip(s) on record, then signed -> ` +
      `row is ${afterSigning === null ? 'gone' : 'STILL THERE'}`,
    );
  }

  // --- 7. The rumoured suitor is a real club, not flavour text -------------
  //
  // The re-sign window names a team, prints its cap room and its need beside
  // the name, and quotes what it would pay. Every one of those is re-derived
  // here straight from the database, and then the claim is tested the only way
  // that really settles it: the player is put on the open market and the
  // actual AI free-agency wave is run.
  console.log('\nSuitor reality check (re-sign rumours, re-derived from the database):\n');
  {
    for (const p of finalCall) {
      const session = await resolveNegotiationSession({
        leagueId, playerId: p.id, teamId: team.id, seasonYear: league.seasonYear, settings, incumbent: true,
      });
      const suitor = session.suitor;
      comparisons++;
      if (!suitor) { console.log(`  ${p.lastName.padEnd(14)} ${p.position} — no suitor claimed`); continue; }

      // A re-sign is NOT an auction: a club that cannot legally sign him must
      // never appear as a bid the meter can make you lose.
      if (session.gate.rival) {
        fail(`${p.lastName}: a re-sign gate carried a competing bid of ${formatMoney(session.gate.rival.offer.apy)} — nobody may bid on a player under contract`);
      }

      const roster = await prisma.player.findMany({
        // The same roster `leadingCompetingBid` and the wave both read.
        where: { teamId: suitor.teamId, status: 'ACTIVE' },
        select: { id: true, position: true, trueOvr: true, age: true, potential: true },
      });
      const needs = teamNeeds(roster as RosterPlayer[]);
      const summary = await teamCapSummary(suitor.teamId, league.seasonYear, settings.capMode);
      const best = roster.filter((r) => r.position === p.position).sort((a, b) => b.trueOvr - a.trueOvr)[0] ?? null;
      const rng = new Rng(`fa-bid-${p.id}-${suitor.teamId}`);
      const gm = await prisma.team.findUniqueOrThrow({ where: { id: suitor.teamId } });
      const reBid = Math.round(maxOffer(p as unknown as RosterPlayer, {
        profile: parseGmProfile(gm.gmProfile, rng), needs,
        capSpace: Math.max(0, summary.capSpace - 4_000_000), rng,
      }));

      if (suitor.capSpace !== summary.capSpace) fail(`${p.lastName}: quoted ${formatMoney(suitor.capSpace)} of ${suitor.teamAbbr} room, the books say ${formatMoney(summary.capSpace)}`);
      if (Math.abs(suitor.need - (needs[p.position] ?? 0)) > 1e-9) fail(`${p.lastName}: quoted need ${suitor.need} at ${p.position}, teamNeeds says ${needs[p.position]}`);
      // A club may be named on either of the two grounds the wave bids on: a
      // need over the 0.15 bar, or — with no roster spot left — a free agent
      // who clearly upgrades the WORST man it has there, which is the man an
      // upgrade actually displaces. Anything else would be a club that never
      // bids at all.
      const worstAtPosition = roster.filter((r) => r.position === p.position).sort((a, b) => a.trueOvr - b.trueOvr)[0] ?? null;
      const upgradeCase = worstAtPosition === null || p.trueOvr - worstAtPosition.trueOvr >= FREE_AGENCY.MIN_UPGRADE_DELTA;
      if (suitor.need < 0.15 && !upgradeCase) {
        fail(`${p.lastName}: ${suitor.teamAbbr} was named with need ${suitor.need.toFixed(2)} and no upgrade case (their worst at ${p.position} is ${worstAtPosition?.trueOvr})`);
      }
      if (suitor.starterOvr !== (best?.trueOvr ?? null)) fail(`${p.lastName}: quoted best-at-position ${suitor.starterOvr}, roster says ${best?.trueOvr ?? null}`);
      if (suitor.apy !== reBid) fail(`${p.lastName}: quoted ${formatMoney(suitor.apy)} from ${suitor.teamAbbr}, their own maxOffer produces ${formatMoney(reBid)}`);

      console.log(
        `  ${p.lastName.padEnd(14)} ${p.position.padEnd(4)} — ${suitor.teamAbbr} would go ${formatMoney(suitor.apy)}/yr; ` +
        `room ${formatMoney(summary.capSpace)}, need ${(suitor.need * 100).toFixed(0)}%, best they have ${best?.trueOvr ?? 'nobody'}`,
      );
    }

    // AND HE IS ACTUALLY PURSUED. The strongest form of the claim: release the
    // most-wanted of them to free agency and run the real sealed-bid wave. If
    // the rumour were decoration, nobody would come.
    const wanted: { id: string; lastName: string; position: string; trueOvr: number; apy: number; abbr: string; teamId: string; need: number; starterOvr: number | null }[] = [];
    for (const p of finalCall) {
      const s = await resolveNegotiationSession({
        leagueId, playerId: p.id, teamId: team.id, seasonYear: league.seasonYear, settings, incumbent: true,
      });
      if (s.suitor) wanted.push({ id: p.id, lastName: p.lastName, position: p.position, trueOvr: p.trueOvr, apy: s.suitor.apy, abbr: s.suitor.teamAbbr, teamId: s.suitor.teamId, need: s.suitor.need, starterOvr: s.suitor.starterOvr });
    }
    const target = wanted.sort((a, b) => b.trueOvr - a.trueOvr)[0];
    if (!target) {
      console.log('  (no rumoured suitor among the re-sign subjects to market-test)');
    } else {
      const player = await prisma.player.findUniqueOrThrow({ where: { id: target.id } });
      const market = marketValue({ ovr: player.trueOvr, position: player.position as any, age: player.age, potential: player.potential });

      // WHAT THE PANEL ACTUALLY CLAIMS is that this club would go to this
      // number for him — not that he ends up there. An open market has other
      // bidders, and the highest one wins; a panel that promised the outcome
      // would be lying about a contest it does not run. So the claim is tested
      // as stated: does the named club clear both bars the wave itself uses —
      // enough need to bid at all, and a bid big enough to be resolved rather
      // than thrown out under the market floor?
      const targetWorst = (await prisma.player.findMany({
        where: { teamId: target.teamId, status: 'ACTIVE', position: target.position },
        orderBy: { trueOvr: 'asc' }, take: 1, select: { trueOvr: true },
      }))[0] ?? null;
      const qualifiesToBid = target.need >= 0.15
        || targetWorst === null
        || target.trueOvr - targetWorst.trueOvr >= FREE_AGENCY.MIN_UPGRADE_DELTA;
      const clearsFloor = target.apy >= market * MARKET_FLOOR;
      comparisons++;
      if (!qualifiesToBid) fail(`${target.lastName}: ${target.abbr} was named but its need would keep it out of the bidding entirely`);
      if (!clearsFloor) {
        fail(`${target.lastName}: ${target.abbr} was named at ${formatMoney(target.apy)}/yr, under the ${formatMoney(Math.round(market * MARKET_FLOOR))} floor a bid has to clear to count`);
      }

      await prisma.contract.deleteMany({ where: { playerId: target.id } });
      await prisma.player.update({ where: { id: target.id }, data: { teamId: null, status: 'FREE_AGENT' } });
      await runAiFreeAgencyWave(leagueId, league.seasonYear, league.week, settings, new Rng('suitor-reality'));
      const landed = await prisma.player.findUniqueOrThrow({
        where: { id: target.id }, include: { team: true, contract: true },
      });
      comparisons++;
      if (!landed.teamId) {
        fail(`${target.lastName}: the re-sign panel named ${target.abbr} as chasing him at ${formatMoney(target.apy)}/yr, but nobody signed him when he reached the market`);
      }
      console.log(
        `\n  Market test: ${target.lastName} (${target.position}, ${target.trueOvr}ovr) was rumoured to ${target.abbr} at ${formatMoney(target.apy)}/yr ` +
        `(need ${(target.need * 100).toFixed(0)}%, floor ${formatMoney(Math.round(market * MARKET_FLOOR))} — a qualifying bid).\n` +
        `  Released to free agency and ran the real AI wave -> ${landed.team ? `signed by ${landed.team.abbr}` : 'UNSIGNED'}` +
        `${landed.team && landed.team.abbr !== target.abbr ? ` (outbid; the rumour is a bid, not a promise)` : ''}.`,
      );
    }
  }

  // --- 8. The band: "he might sign here" is real, and it cannot be re-rolled
  //
  // The meter used to be an oracle — `accepted` flipped at exactly 82 interest
  // and the optimal play was to binary-search that number and pay it. There is
  // a band around the threshold now where the answer is genuinely uncertain,
  // and everything below is about the two ways that could have been a lie:
  // the band being cosmetic over a deterministic yes, or the hidden draw being
  // re-rollable by resubmitting until it lands.
  console.log('\nThe band (three regions across a real player\'s whole salary range):\n');
  {
    // The most expensive man still on the market whose band the HIDDEN DRAW
    // actually decides. A cheap player's band is two or three slider steps
    // wide, which demonstrates nothing — but there is a second filter now that
    // matters more, and it arrived with the market change: a rival bidding
    // above the band makes every offer in it a refusal for a reason that has
    // nothing to do with the draw (`outbid`), and a band that cannot land
    // because somebody else is higher is not evidence about the band at all.
    // So the subject is chosen as one where the draw is the thing being tested,
    // and the counting below ignores offers the ledger or the auction settled.
    const candidates = await prisma.player.findMany({
      where: { leagueId, status: 'FREE_AGENT', teamId: null, isDraftee: false },
      orderBy: { trueOvr: 'desc' },
      take: 12,
    });
    let subject = candidates[0];
    let session = await resolveNegotiationSession({
      leagueId, playerId: subject.id, teamId: team.id, seasonYear: league.seasonYear, settings, incumbent: false,
    });
    for (const c of candidates) {
      const s = await resolveNegotiationSession({
        leagueId, playerId: c.id, teamId: team.id, seasonYear: league.seasonYear, settings, incumbent: false,
      });
      const yrs = Math.min(s.ctx.desiredYears, s.gate.maxYears, s.ctx.willingYears);
      let decidable = 0;
      for (let apy = s.gate.minSalary; apy <= s.gate.maxSalary; apy += 100_000) {
        const d = decideOffer(s.ctx, { apy, years: yrs, guaranteePct: 0.5 }, s.gate, DEFAULT_STRUCTURE);
        if (d.signBand === 'MAYBE' && !d.blocked && !d.outbid) decidable++;
      }
      if (decidable > 8) { subject = c; session = s; break; }
    }
    const { ctx, gate } = session;
    const years = Math.min(ctx.desiredYears, gate.maxYears, ctx.willingYears);
    const base: Offer = { apy: gate.minSalary, years, guaranteePct: 0.5 };

    let firstMaybe: number | null = null;
    let firstYes: number | null = null;
    let maybeSigned = 0;
    let maybeRefused = 0;
    for (let apy = gate.minSalary; apy <= gate.maxSalary; apy += 100_000) {
      const offer = { ...base, apy };
      const d = decideOffer(ctx, offer, gate, DEFAULT_STRUCTURE);
      comparisons++;
      // The band the panel DRAWS has to be the band the decision USES.
      const drawn = signBandFor(ctx, d.evaluation.interest);
      if (drawn !== d.signBand) fail(`${subject.lastName}: the drawn band (${drawn}) and the decided band (${d.signBand}) disagree at ${formatMoney(apy)}`);
      if (d.signBand === 'YES' && !d.accepted && !d.blocked && !d.outbid) {
        fail(`${subject.lastName}: a certainty at ${formatMoney(apy)} was not accepted`);
      }
      if (d.signBand === 'NO' && d.accepted) fail(`${subject.lastName}: an offer below the band signed at ${formatMoney(apy)}`);
      // Only where the DRAW is what decides. An offer the cap refuses or a
      // rival outbids says nothing about whether the band is real.
      if (d.signBand === 'MAYBE') {
        if (!d.blocked && !d.outbid) { if (d.accepted) maybeSigned++; else maybeRefused++; }
        if (firstMaybe === null) firstMaybe = apy;
      }
      if (d.signBand === 'YES' && firstYes === null) firstYes = apy;
    }
    console.log(
      `  ${subject.firstName} ${subject.lastName} (${subject.position}, ${subject.trueOvr}ovr, asks ~${formatMoney(ctx.reservationApy)}/yr, ` +
      `scouting band +-${ctx.bandHalfWidth} interest points)\n` +
      `    he will NOT sign  below ${firstMaybe === null ? 'anywhere' : formatMoney(firstMaybe)}\n` +
      `    he MIGHT sign     ${firstMaybe === null ? '(no band)' : `${formatMoney(firstMaybe)} - ${firstYes === null ? 'the ceiling' : formatMoney(firstYes - 100_000)}`}` +
      `  (${maybeSigned} of ${maybeSigned + maybeRefused} of those offers actually land)\n` +
      `    he WILL sign      ${firstYes === null ? 'nowhere on the slider' : `${formatMoney(firstYes)} and up`}`,
    );
    // A band nobody can ever land, or one that always lands, is not a band.
    if (maybeSigned + maybeRefused > 8 && (maybeSigned === 0 || maybeRefused === 0)) {
      fail(`the "might sign" band is not uncertain at all: ${maybeSigned} signed, ${maybeRefused} refused`);
    }

    // NON-REROLL. The same offer, decided a hundred times, is the same answer;
    // and a hundred neighbouring offers $100K apart are not.
    const inBand: Offer[] = [];
    for (let apy = gate.minSalary; apy <= gate.maxSalary; apy += 100_000) {
      const offer = { ...base, apy };
      const d = decideOffer(ctx, offer, gate, DEFAULT_STRUCTURE);
      if (d.signBand === 'MAYBE' && !d.blocked && !d.outbid) inBand.push(offer);
    }
    if (inBand.length === 0) {
      console.log('  (no offer on this slider lands in the band — non-reroll checked on the grid instead)');
    } else {
      const probe = inBand[Math.floor(inBand.length / 2)];
      const first = decideOffer(ctx, probe, gate, DEFAULT_STRUCTURE);
      for (let i = 0; i < 50; i++) {
        const again = decideOffer(ctx, { ...probe }, gate, DEFAULT_STRUCTURE);
        comparisons++;
        if (again.accepted !== first.accepted) {
          fail(`${subject.lastName}: the identical offer gave two different answers — the hidden draw is re-rollable`);
          break;
        }
      }
      // And the server, which re-resolves its own session from the database,
      // has to reach that same answer — it is the same seed or it is nothing.
      const serverSide = await resolveNegotiationSession({
        leagueId, playerId: subject.id, teamId: team.id, seasonYear: league.seasonYear, settings, incumbent: false,
      });
      const serverDecision = decideOffer(serverSide.ctx, probe, serverSide.gate, DEFAULT_STRUCTURE);
      comparisons++;
      const diff = sameDecision(first, serverDecision);
      if (diff) fail(`${subject.lastName}: client and server disagree INSIDE the band — ${diff}`);

      // A CHANGED offer draws a fresh hidden value. If it did not, the band
      // would be a fixed hidden threshold and binary-searchable all over again.
      let flips = 0;
      for (const other of inBand) {
        if (other.apy === probe.apy) continue;
        if (decideOffer(ctx, other, gate, DEFAULT_STRUCTURE).accepted !== first.accepted) flips++;
      }
      comparisons++;
      if (inBand.length > 4 && flips === 0) {
        fail('every offer in the band gives the same answer — the hidden draw does not move with the offer');
      }
      console.log(
        `  Non-reroll: ${formatMoney(probe.apy)} decided 50 times -> always ${first.accepted ? 'SIGNS' : 'refuses'}; ` +
        `server re-resolved from the database -> ${serverDecision.accepted ? 'SIGNS' : 'refuses'} (agree). ` +
        `${flips} of the other ${inBand.length - 1} offers in the band answer differently.`,
      );
    }
  }

  // --- 9. Willingness: the term he refuses, in his own voice ---------------
  //
  // The age ladder is gone from the rulebook — 12 years for everybody — and
  // the refusal belongs to the player now, derived from the same retirement
  // model the sim rolls. Two things have to hold: the horizon is the same
  // number everywhere (a browser, a Server Action and this script are three
  // processes), and the refusal is a BLOCK rather than a surprise, so it costs
  // nothing and it is visible before anything is submitted.
  console.log('\nWillingness horizon (derived from retirementChance, seeded per player):\n');
  {
    const oldest = await prisma.player.findMany({
      where: { leagueId, status: { in: ['ACTIVE', 'FREE_AGENT'] } },
      orderBy: { age: 'desc' },
      take: 6,
    });
    for (const p of oldest) {
      const a = willingnessHorizon({ playerId: p.id, age: p.age, trueOvr: p.trueOvr, position: p.position });
      const b = willingnessHorizon({ playerId: p.id, age: p.age, trueOvr: p.trueOvr, position: p.position });
      comparisons++;
      if (a.years !== b.years || a.finalAge !== b.finalAge) fail(`${p.lastName}: willingnessHorizon is not deterministic`);
      if (a.years < 1 || a.years > maxYearsForAge(p.age)) fail(`${p.lastName}: horizon ${a.years} is outside 1..${maxYearsForAge(p.age)}`);
      if (a.finalAge < TERM.MIN_FINAL_AGE || a.finalAge > TERM.MAX_FINAL_AGE) {
        fail(`${p.lastName}: intended final age ${a.finalAge} is outside the ${TERM.MIN_FINAL_AGE}-${TERM.MAX_FINAL_AGE} band`);
      }
      console.log(`  ${(p.firstName + ' ' + p.lastName).padEnd(22)} ${p.position.padEnd(4)} age ${p.age} ${String(p.trueOvr).padStart(2)}ovr — will not play past ${a.finalAge}, so at most ${a.years} more year${a.years === 1 ? '' : 's'}`);
    }

    // And the refusal itself, on a real negotiation.
    const veteran = oldest[0];
    const session = await resolveNegotiationSession({
      leagueId, playerId: veteran.id, teamId: team.id, seasonYear: league.seasonYear, settings,
      incumbent: veteran.teamId === team.id,
    });
    const tooLong: Offer = {
      apy: Math.min(session.gate.maxSalary, session.ctx.reservationApy * 2),
      years: Math.min(session.gate.maxYears, session.ctx.willingYears + 1),
      guaranteePct: 1,
    };
    if (tooLong.years > session.ctx.willingYears) {
      const d = decideOffer(session.ctx, clampOffer(tooLong, session.gate), session.gate, DEFAULT_STRUCTURE);
      const outcome = await negotiateOffer({
        leagueId, playerId: veteran.id, teamId: team.id, seasonYear: league.seasonYear, week: league.week,
        settings, incumbent: veteran.teamId === team.id, offer: tooLong, structure: DEFAULT_STRUCTURE,
        fingerprint: sessionFingerprint(session),
      });
      comparisons++;
      if (d.blocked !== 'WILLING') fail(`${veteran.lastName}: ${tooLong.years} years past a ${session.ctx.willingYears}-year horizon was not refused on term`);
      if (outcome.ok) fail(`${veteran.lastName}: the server signed a deal longer than he will play`);
      if (outcome.patienceSpent !== 0) fail(`${veteran.lastName}: a term he will never sign cost him patience`);
      console.log(`\n  ${veteran.lastName} offered ${tooLong.years} years at double his asking price -> ${d.blocked}, patience ${outcome.patienceSpent}. "${d.reason}"`);
    }
  }

  // --- 10. Extensions: the third screen, and appending rather than replacing
  console.log('\nExtensions (years appended, new money vs full contract, same patience store):\n');
  {
    const subject = underContract[0];
    const before = await prisma.contract.findUniqueOrThrow({ where: { playerId: subject.id } });
    const session = await resolveNegotiationSession({
      leagueId, playerId: subject.id, teamId: team.id, seasonYear: league.seasonYear, settings,
      incumbent: true, mode: 'EXTENSION',
    });
    comparisons++;
    // Nobody may bid on a man under contract. If this were ever non-zero the
    // panel could make you lose an auction that cannot legally happen.
    if (session.gate.rival) fail('an extension gate carried a competing bid');
    if (session.ctx.controlYears !== before.yearsRemaining) fail('an extension context lost the years of control');
    if (session.gate.maxYears + before.yearsRemaining > TERM.MAX_CONTRACT_YEARS) {
      fail(`extension term ceiling ${session.gate.maxYears} + ${before.yearsRemaining} existing years exceeds the ${TERM.MAX_CONTRACT_YEARS}-year rule`);
    }

    // THE SAME LOWBALL ON TWO SCREENS. A player is one man: if the extension
    // panel and the re-sign panel disagree about the same offer for the same
    // player, the consolidation has failed at exactly the point it exists for.
    const resignSession = await resolveNegotiationSession({
      leagueId, playerId: subject.id, teamId: team.id, seasonYear: league.seasonYear, settings, incumbent: true,
    });
    const lowball: Offer = { apy: Math.round(session.ctx.reservationApy * 0.5), years: 1, guaranteePct: 0.5 };
    const onExtension = decideOffer(session.ctx, lowball, session.gate, DEFAULT_STRUCTURE);
    const onResign = decideOffer(resignSession.ctx, lowball, resignSession.gate, DEFAULT_STRUCTURE);
    comparisons++;
    if (onExtension.signBand !== 'NO' || onResign.signBand !== 'NO') {
      fail(`a half-price lowball was not refused on both screens (${onExtension.signBand}/${onResign.signBand})`);
    }
    console.log(
      `  ${subject.lastName}: half-price lowball reads ${onExtension.evaluation.verdict}/${onExtension.signBand} on the extension screen ` +
      `and ${onResign.evaluation.verdict}/${onResign.signBand} in the re-sign window — one man, one evaluator.`,
    );

    // The append itself, end to end, against the database.
    const addYears = Math.min(3, session.gate.maxYears);
    const generous: Offer = {
      apy: Math.min(session.gate.maxSalary, Math.round(session.ctx.reservationApy * 1.6)),
      years: addYears,
      guaranteePct: 0.8,
    };
    const predicted = decideOffer(session.ctx, clampOffer(generous, session.gate), session.gate, DEFAULT_STRUCTURE);
    const outcome = await negotiateOffer({
      leagueId, playerId: subject.id, teamId: team.id, seasonYear: league.seasonYear, week: league.week,
      settings, incumbent: true, mode: 'EXTENSION', offer: generous, structure: DEFAULT_STRUCTURE,
      fingerprint: sessionFingerprint(session),
    });
    comparisons++;
    if (outcome.ok !== predicted.accepted) {
      fail(`${subject.lastName}: extension meter said ${predicted.accepted} but the server said ${outcome.ok} — "${outcome.message}"`);
    }
    if (outcome.ok) {
      const after = await prisma.contract.findUniqueOrThrow({ where: { playerId: subject.id } });
      const beforeBases = JSON.parse(before.baseSalaries) as number[];
      const afterBases = JSON.parse(after.baseSalaries) as number[];
      const kept = beforeBases.slice(before.years - before.yearsRemaining);
      comparisons++;
      if (after.years !== before.yearsRemaining + addYears) {
        fail(`${subject.lastName}: extension produced ${after.years} years, expected ${before.yearsRemaining} + ${addYears}`);
      }
      if (after.yearsRemaining !== after.years) fail(`${subject.lastName}: an appended deal is not fully remaining`);
      if (JSON.stringify(afterBases.slice(0, kept.length)) !== JSON.stringify(kept)) {
        fail(`${subject.lastName}: the years he was already owed did not keep their salaries`);
      }
      // capHit indexes with years - yearsRemaining, which the append rebases to
      // 0. If that ever slipped, the compliance gate would read the wrong year.
      const hitNow = capHit(after, settings.capMode);
      if (hitNow !== predicted.year1CapHit) {
        fail(`${subject.lastName}: the panel promised a ${formatMoney(predicted.year1CapHit)} year-1 hit, the contract charges ${formatMoney(hitNow)}`);
      }
      console.log(
        `  ${subject.lastName}: had ${before.yearsRemaining} yrs left, added ${addYears} at ${formatMoney(generous.apy)}/yr of NEW money -> ` +
        `${after.years} years, ${formatMoney(predicted.newMoneyValue)} new money inside a ${formatMoney(predicted.totalValue)} contract, ` +
        `year-1 cap hit ${formatMoney(hitNow)} (panel said ${formatMoney(predicted.year1CapHit)}), ` +
        `bases ${afterBases.map((b) => formatMoney(b)).join(' ')}`,
      );
    } else {
      console.log(`  ${subject.lastName}: extension refused as the meter predicted — "${outcome.message}"`);
    }
  }

  // --- 11. Leaving the table refunds nothing ------------------------------
  //
  // Cancel closes a panel. It is not an undo, and if it ever became one it
  // would be the page-reload exploit back again wearing a friendlier label:
  // lowball, cancel, re-open, lowball again, forever. Modelled exactly as the
  // UI does it — the client state is dropped and NOTHING is called — and then
  // checked against the row in the database.
  console.log('\nLeaving the table (patience is not refunded):\n');
  {
    const subject = underContract[2];
    const key = { teamId_playerId_seasonYear: { teamId: team.id, playerId: subject.id, seasonYear: league.seasonYear } };
    const opened = await resolveNegotiationSession({
      leagueId, playerId: subject.id, teamId: team.id, seasonYear: league.seasonYear, settings,
      incumbent: true, mode: 'EXTENSION',
    });
    const lowball: Offer = { apy: Math.max(opened.gate.minSalary, Math.round(opened.ctx.reservationApy * 0.55)), years: 1, guaranteePct: 0.3 };
    const refused = await negotiateOffer({
      leagueId, playerId: subject.id, teamId: team.id, seasonYear: league.seasonYear, week: league.week,
      settings, incumbent: true, mode: 'EXTENSION', offer: lowball, structure: DEFAULT_STRUCTURE,
      fingerprint: sessionFingerprint(opened),
    });
    const rowAfterOffer = await prisma.negotiationTalks.findUnique({ where: key });
    comparisons++;
    if (!refused.ok && (!rowAfterOffer || rowAfterOffer.patienceSpent === 0)) {
      fail(`${subject.lastName}: a refused offer on the extension screen charged no patience`);
    }

    // "Cancel" — every client object goes out of scope and no server call is
    // made. Then he comes back.
    const rowAfterCancel = await prisma.negotiationTalks.findUnique({ where: key });
    const reopened = await resolveNegotiationSession({
      leagueId, playerId: subject.id, teamId: team.id, seasonYear: league.seasonYear, settings,
      incumbent: true, mode: 'EXTENSION',
    });
    comparisons++;
    if (rowAfterCancel?.patienceSpent !== rowAfterOffer?.patienceSpent) {
      fail(`${subject.lastName}: leaving the table changed the stored patience count`);
    }
    if (reopened.patienceSpent !== (rowAfterOffer?.patienceSpent ?? 0)) {
      fail(`${subject.lastName}: re-opened talks did not carry the pips he had already spent`);
    }
    // And the identical offer, after the walk-out, is still the identical
    // answer — he said no and he meant it.
    const again = decideOffer(reopened.ctx, lowball, reopened.gate, DEFAULT_STRUCTURE);
    const beforeCancel = decideOffer(opened.ctx, lowball, opened.gate, DEFAULT_STRUCTURE);
    comparisons++;
    if (again.accepted !== beforeCancel.accepted || again.signBand !== beforeCancel.signBand) {
      fail(`${subject.lastName}: the same offer answered differently after leaving the table`);
    }
    console.log(
      `  ${subject.lastName}: lowballed (patience ${refused.patienceSpent}/${opened.ctx.patience}), left the table, came back -> ` +
      `database says ${rowAfterCancel?.patienceSpent ?? 0} spent, re-opened session says ${reopened.patienceSpent}. ` +
      `Same offer, same answer (${again.signBand}).`,
    );
  }

  // --- 12. "Nobody is circling" is falsifiable -----------------------------
  //
  // `leadingCompetingBid` used to scan 31 clubs and return the best offer from
  // any of them with a need over 0.15, which across 31 rosters is always
  // somebody: measured, 38 of the top 40 free agents in a real league carried a
  // rival, and both exceptions were punters. It now asks the wave's own
  // question — would this club actually GET to him, walking its own board on
  // its real roster slots and its real budget — so "nobody is circling" is a
  // state the panel can be in, and a state it can be WRONG about.
  //
  // The claim is tested in the direction that can be falsified. The panel never
  // promises a signing (an open market has other bidders and the highest one
  // wins), but it does promise that a man it calls unwanted is unwanted: so a
  // spread of free agents is resolved, the REAL sealed-bid wave is run, and any
  // player the panel said nobody was chasing who is then signed by a rival's
  // bid is a lie the meter told.
  console.log('\nMarket reality check (who the panel says is wanted vs who the wave actually bids on):\n');
  {
    const board = await prisma.player.findMany({
      where: { leagueId, status: 'FREE_AGENT', teamId: null, isDraftee: false },
      orderBy: [{ trueOvr: 'desc' }, { id: 'asc' }],
      take: 40,
    });
    const claimed = new Map<string, { name: string; ovr: number; position: string; suitor: string | null; apy: number }>();
    for (const p of board) {
      const s = await resolveNegotiationSession({
        leagueId, playerId: p.id, teamId: team.id, seasonYear: league.seasonYear, settings, incumbent: false,
      });
      comparisons++;
      // Every club NAMED has to clear both bars the wave resolves on, or the
      // rumour is about a bid that would have been thrown out.
      if (s.suitor) {
        const market = marketValue({ ovr: p.trueOvr, position: p.position as any, age: p.age, potential: p.potential });
        if (s.suitor.apy < market * MARKET_FLOOR) {
          fail(`${p.lastName}: ${s.suitor.teamAbbr} named at ${formatMoney(s.suitor.apy)}, under the ${formatMoney(Math.round(market * MARKET_FLOOR))} floor the wave throws bids out below`);
        }
        if (s.suitor.need < 0.15) {
          // Named on the upgrade case rather than on need — so the upgrade has
          // to be real, against the man it would actually displace.
          const worst = (await prisma.player.findMany({
            where: { teamId: s.suitor.teamId, status: 'ACTIVE', position: p.position },
            orderBy: { trueOvr: 'asc' }, take: 1, select: { trueOvr: true },
          }))[0] ?? null;
          if (worst !== null && p.trueOvr - worst.trueOvr < FREE_AGENCY.MIN_UPGRADE_DELTA) {
            fail(`${p.lastName}: ${s.suitor.teamAbbr} named with neither a need (${s.suitor.need.toFixed(2)}) nor an upgrade case (their worst at ${p.position} is ${worst.trueOvr})`);
          }
        }
        // The gate and the rumour are the SAME PACKAGE now, not just the same
        // headline. A panel that named a club at one term and scored it at
        // another would be back to two evaluators.
        if (s.gate.rival?.offer.apy !== s.suitor.apy
          || s.gate.rival?.offer.years !== s.suitor.years
          || s.gate.rival?.offer.guaranteePct !== s.suitor.guaranteePct) {
          fail(`${p.lastName}: the free-agency gate and the named suitor disagree about the package`);
        }
      } else if (s.gate.rival) {
        fail(`${p.lastName}: no suitor, but the gate carries a competing bid of ${formatMoney(s.gate.rival.offer.apy)}`);
      }
      claimed.set(p.id, { name: `${p.firstName} ${p.lastName}`, ovr: p.trueOvr, position: p.position, suitor: s.suitor?.teamAbbr ?? null, apy: s.suitor?.apy ?? 0 });
    }
    const wanted = [...claimed.values()].filter((c) => c.suitor).length;

    // THE WAVE, FOR REAL. Nothing here is a forecast of a forecast: this is the
    // function the Advance button runs.
    const before = new Map<string, string | null>();
    for (const p of board) before.set(p.id, null);
    await runAiFreeAgencyWave(leagueId, league.seasonYear, league.week, settings, new Rng('market-reality'));
    const after = await prisma.player.findMany({
      where: { id: { in: board.map((p) => p.id) } },
      select: { id: true, teamId: true, team: { select: { abbr: true } } },
    });
    let signedWithSuitor = 0;
    let signedWithout = 0;
    for (const row of after) {
      if (!row.teamId || !before.has(row.id)) continue;
      const c = claimed.get(row.id)!;
      comparisons++;
      if (c.suitor) signedWithSuitor++;
      else {
        signedWithout++;
        fail(`${c.name} (${c.position}, ${c.ovr}ovr): the panel said nobody was circling, and the wave signed him to ${row.team?.abbr}`);
      }
    }
    console.log(
      `  ${wanted} of ${board.length} of the top free agents carry a rival bid; ${board.length - wanted} are told, honestly, that nobody is circling.\n` +
      `  Ran the real AI wave -> ${signedWithSuitor + signedWithout} signed, ${signedWithout} of them from the "nobody is circling" list.`,
    );
  }

  // --- 13. Guaranteed money is a lever, not decoration ---------------------
  //
  // The measurement that started this: at his exact asking price with the term
  // matched, sweeping the guarantee 0 -> 100% moved interest by 18-30 points —
  // but the BASELINE at zero guaranteed was already 70-88, comfortably
  // signable. So guaranteeing nothing was optimal and the slider was
  // decoration. The floor is the mirror of the money insult, and what is
  // printed below is the same sweep, re-run.
  console.log('\nGuarantee sweep (his asking price, term matched, 0 -> 100% guaranteed):\n');
  {
    const subjects = [
      ...(await prisma.player.findMany({ where: { leagueId, status: 'FREE_AGENT', teamId: null, isDraftee: false }, orderBy: { trueOvr: 'desc' }, take: 1 })),
      ...(await prisma.player.findMany({ where: { leagueId, status: 'FREE_AGENT', teamId: null, isDraftee: false, trueOvr: { lte: 70 } }, orderBy: { trueOvr: 'desc' }, take: 1 })),
    ];
    for (const p of subjects) {
      const session = await resolveNegotiationSession({
        leagueId, playerId: p.id, teamId: team.id, seasonYear: league.seasonYear, settings, incumbent: false,
      });
      const { ctx, gate } = session;
      const years = Math.min(ctx.desiredYears, gate.maxYears, ctx.willingYears);
      const apy = Math.min(gate.maxSalary, Math.max(gate.minSalary, ctx.reservationApy));
      const cells = [0, 0.25, 0.5, 0.75, 1].map((g) => {
        const d = decideOffer(ctx, { apy, years, guaranteePct: g }, gate, DEFAULT_STRUCTURE);
        comparisons++;
        return `${String(d.evaluation.interest).padStart(4)}${d.signBand === 'YES' ? '*' : d.signBand === 'MAYBE' ? '?' : ' '}`;
      });
      console.log(
        `  ${(p.firstName + ' ' + p.lastName).padEnd(22)} ${p.position.padEnd(4)} ${String(p.trueOvr).padStart(2)}ovr ` +
        `${ctx.personality.padEnd(10)} floor ${String(Math.round(ctx.guaranteeFloor * 100)).padStart(2)}% | ${cells.join(' ')} ` +
        `(at ${formatMoney(apy)}/yr x ${years}yr)`,
      );
    }
    console.log('  * he will sign   ? he might sign   blank: no salary signs this');
  }

  // --- 14. Set aside is not a decision, and not a trap ---------------------
  //
  // The re-sign list can park a player — "not now" — and the column that
  // records it (NegotiationTalks.dismissedAt) shares a row with the patience
  // count. That is the right place for it (same key, expires with the league
  // year) and also the one place it could do damage, so both halves are checked
  // against the database: parking a man moves neither his pips nor his price,
  // and the Advance that would let him walk names him first.
  console.log('\nSet aside (parked on the re-sign list — costs nothing, and cannot be walked into):\n');
  {
    const subject = await prisma.player.findFirstOrThrow({
      where: { teamId: team.id, status: 'ACTIVE', contract: { isNot: null } },
      orderBy: { trueOvr: 'desc' },
    });
    const key = { teamId_playerId_seasonYear: { teamId: team.id, playerId: subject.id, seasonYear: league.seasonYear } };
    await prisma.contract.update({ where: { playerId: subject.id }, data: { yearsRemaining: 0 } });

    // Burn a pip first, so there is a real count for parking him to damage.
    const opened = await resolveNegotiationSession({
      leagueId, playerId: subject.id, teamId: team.id, seasonYear: league.seasonYear, settings, incumbent: true,
    });
    await negotiateOffer({
      leagueId, playerId: subject.id, teamId: team.id, seasonYear: league.seasonYear, week: league.week,
      settings, incumbent: true, structure: DEFAULT_STRUCTURE,
      offer: { apy: Math.max(opened.gate.minSalary, Math.round(opened.ctx.reservationApy * 0.5)), years: 1, guaranteePct: 0.5 },
    });
    const spentBefore = (await prisma.negotiationTalks.findUnique({ where: key }))?.patienceSpent ?? 0;
    const priceBefore = sessionFingerprint(opened);

    await setResignSetAside({ leagueId, teamId: team.id, playerId: subject.id, seasonYear: league.seasonYear, aside: true });
    const parkedRow = await prisma.negotiationTalks.findUnique({ where: key });
    const parkedSession = await resolveNegotiationSession({
      leagueId, playerId: subject.id, teamId: team.id, seasonYear: league.seasonYear, settings, incumbent: true,
    });
    comparisons++;
    if (!parkedRow?.dismissedAt) fail('setting a player aside did not record it');
    if (parkedRow?.patienceSpent !== spentBefore) fail(`setting a player aside moved his patience (${spentBefore} -> ${parkedRow?.patienceSpent})`);
    if (parkedSession.patienceSpent !== spentBefore) fail(`a parked player's session reports ${parkedSession.patienceSpent} pips spent, the database says ${spentBefore}`);
    if (sessionFingerprint(parkedSession) !== priceBefore) fail('setting a player aside changed the terms of his negotiation');

    await setResignSetAside({ leagueId, teamId: team.id, playerId: subject.id, seasonYear: league.seasonYear, aside: false });
    const backRow = await prisma.negotiationTalks.findUnique({ where: key });
    const backSession = await resolveNegotiationSession({
      leagueId, playerId: subject.id, teamId: team.id, seasonYear: league.seasonYear, settings, incumbent: true,
    });
    comparisons++;
    if (backRow?.dismissedAt !== null) fail('bringing a player back left him marked as set aside');
    if (backRow?.patienceSpent !== spentBefore) fail(`bringing a player back moved his patience (${spentBefore} -> ${backRow?.patienceSpent})`);
    if (sessionFingerprint(backSession) !== priceBefore) fail('bringing a player back changed the terms of his negotiation');
    console.log(`  ${subject.lastName}: ${spentBefore} pip(s) spent, set aside -> ${parkedRow?.patienceSpent} spent, brought back -> ${backRow?.patienceSpent} spent. Same terms throughout.`);

    // AND THE TRAP, CLOSED. Park him again, put the league on the last screen
    // before free agency, and press Advance. It has to refuse, once, and it has
    // to say his name — a warning that counted him without naming him would
    // still let a GM lose a starter he thought was safe.
    await setResignSetAside({ leagueId, teamId: team.id, playerId: subject.id, seasonYear: league.seasonYear, aside: true });
    await prisma.league.update({
      where: { id: leagueId },
      data: { phase: 'RESIGN', week: 1, resignWarnedYear: null },
    });
    const advance = await advanceWeek(leagueId);
    const still = await prisma.player.findUniqueOrThrow({ where: { id: subject.id }, select: { teamId: true } });
    comparisons++;
    if (!advance.blocked) fail('advancing past the re-sign window with a player set aside was not stopped');
    if (!advance.summary.includes(subject.lastName)) fail(`the advance warning did not name ${subject.lastName}, who was set aside and about to walk`);
    if (still.teamId !== team.id) fail(`${subject.lastName} was released by the very advance that was supposed to warn about him`);
    console.log(`  Advance out of RESIGN with him parked -> blocked=${advance.blocked}, and it names him:\n    "${advance.summary}"`);
  }

  // =========================================================================
  // 15. THE CONTEST — the panel may not contradict itself
  // =========================================================================
  // The app owner, on a live screen: *"this also contradicts itself as a bug.
  // it says he WILL SIGN for X amount, but because another team is bidding, he
  // wont. that should talk with each other"*. The cause was that they did not:
  // the meter scored the whole package and `outbid` compared two APY numbers.
  //
  // Three claims are checked here, and the first is the bug itself.
  //
  //   A. ONE ANSWER. Across the whole grid, "he will sign this" and "he is
  //      signing elsewhere" may never both be true of the same offer. This is
  //      the assertion that would have failed before this pass.
  //   B. THE RIVAL'S PACKAGE IS THE SIMULATION'S. Term and guarantee are
  //      re-derived from the functions the wave signs with, so a rival scored
  //      at 4 years / 45% is a rival who would really sign him at 4 years and
  //      45%.
  //   C. IT IS NOT JUST RAW SALARY. There has to exist an offer that loses the
  //      contest on salary alone and wins it by adding guaranteed money or
  //      years — otherwise the model is the old dollar comparison wearing a
  //      score.
  //
  // And the distribution, because a rival who never wins is as wrong as a
  // panel that always contradicts itself.
  console.log('\nThe contest (a rival is a package the player scores, not a number to beat):\n');
  {
    let contests = 0;
    let rivalWins = 0;
    const beatCosts: { name: string; rival: number; you: number; apy: number | null; gtd: number | null; yrs: number | null; cheapest: string }[] = [];

    for (const p of freeAgents.slice(0, 40)) {
      const s = await resolveNegotiationSession({
        leagueId, playerId: p.id, teamId: team.id, seasonYear: league.seasonYear, settings, incumbent: false,
      });
      if (!s.gate.rival) continue;
      contests++;

      // --- B. the package is the one the wave would actually write ---------
      comparisons++;
      const honestYears = suggestedYears(p.trueOvr, p.age);
      if (s.gate.rival.offer.years !== honestYears) {
        fail(`${p.lastName}: rival quoted ${s.gate.rival.offer.years} years, the wave would sign him for ${honestYears}`);
      }
      if (s.gate.rival.offer.guaranteePct !== AI_GUARANTEE_PCT) {
        fail(`${p.lastName}: rival quoted ${s.gate.rival.offer.guaranteePct} guaranteed, AI deals lock in ${AI_GUARANTEE_PCT}`);
      }

      // --- A. one answer, everywhere on the grid ---------------------------
      // The full salary x years x guarantee grid, checked for the one thing
      // the screenshot showed: a certain yes printed over a lost auction.
      const { ctx, gate } = s;
      let anyOutbid = 0;
      let gridPoints = 0;
      for (let years = 1; years <= gate.maxYears; years += 2) {
        for (let g = 0; g <= 100; g += 10) {
          for (let apy = gate.minSalary; apy <= gate.maxSalary; apy += 500_000) {
            const d = decideOffer(ctx, { apy, years, guaranteePct: g / 100 }, gate, DEFAULT_STRUCTURE);
            comparisons++;
            gridPoints++;
            if (d.outbid) anyOutbid++;
            // THE BUG. A band of YES means "he signs this"; `outbid` means "he
            // signs there". They are the same computation now, so they cannot
            // both fire.
            if (d.signBand === 'YES' && d.outbid) {
              fail(`${p.lastName} @ ${formatMoney(apy)}/${years}yr/${g}%: band says he will sign AND he is outbid`);
            }
            if (d.outbid && d.signBand !== 'LOSING') {
              fail(`${p.lastName} @ ${formatMoney(apy)}/${years}yr/${g}%: outbid but the band reads ${d.signBand}`);
            }
            if (d.outbid && d.accepted) {
              fail(`${p.lastName} @ ${formatMoney(apy)}/${years}yr/${g}%: outbid and accepted at the same time`);
            }
            // The rival's score is a fact about the session, so it is the same
            // number at every point of the grid. If it moved with the user's
            // offer the mark on the meter would slide under the slider.
            if (d.rivalInterest !== decideOffer(ctx, { apy: gate.minSalary, years: 1, guaranteePct: 0 }, gate, DEFAULT_STRUCTURE).rivalInterest) {
              fail(`${p.lastName}: the rival's interest moved with the user's own offer`);
            }
          }
        }
      }
      if (anyOutbid > 0) rivalWins++;

      // --- C. the package route --------------------------------------------
      // Open at a salary that loses, then try to win without touching it.
      const rivalScore = decideOffer(ctx, { apy: gate.minSalary, years: 1, guaranteePct: 0 }, gate, DEFAULT_STRUCTURE).rivalInterest ?? 0;
      const opening: Offer = {
        apy: Math.min(gate.maxSalary, Math.max(gate.minSalary, Math.round(ctx.reservationApy / 100_000) * 100_000)),
        years: Math.min(ctx.desiredYears, gate.maxYears, ctx.willingYears),
        guaranteePct: 0.5,
      };
      const at = decideOffer(ctx, opening, gate, DEFAULT_STRUCTURE);
      const plan = beatRival(ctx, opening, gate);
      comparisons++;
      if (at.outbid && plan) {
        // Every chip the panel would draw has to actually work when pressed.
        for (const [label, moved] of [
          ['salary', plan.apy === null ? null : { ...opening, apy: plan.apy }],
          ['guarantee', plan.guaranteePct === null ? null : { ...opening, guaranteePct: plan.guaranteePct }],
          ['term', plan.years === null ? null : { ...opening, years: plan.years }],
        ] as [string, Offer | null][]) {
          if (!moved) continue;
          const after = decideOffer(ctx, moved, gate, DEFAULT_STRUCTURE);
          comparisons++;
          if (after.outbid) fail(`${p.lastName}: the ${label} chip does not win the contest`);
          if (after.signBand !== 'YES') fail(`${p.lastName}: the ${label} chip wins the auction but he still will not sign (${after.signBand})`);
        }
        beatCosts.push({
          name: p.lastName, rival: rivalScore, you: at.evaluation.interest,
          apy: plan.apy, gtd: plan.guaranteePct, yrs: plan.years, cheapest: plan.cheapest ?? 'none',
        });
      }
      console.log(
        `  ${p.lastName.padEnd(14)} ${p.position.padEnd(3)} rival ${s.gate.rival.teamName.split(' ').pop()?.padEnd(11)} `
        + `${formatMoney(s.gate.rival.offer.apy)}/${s.gate.rival.offer.years}yr/${Math.round(s.gate.rival.offer.guaranteePct * 100)}% `
        + `scores ${String(rivalScore).padStart(3)} — ${anyOutbid} of ${gridPoints} grid offers lose to it`,
      );
    }

    console.log(`\n  ${contests} of the top 40 free agents have a live rival; ${rivalWins} of those can actually lose the man.`);

    // NOT JUST RAW SALARY, stated as a measurement rather than a hope. At
    // least one player in the sample has to be winnable by adding guaranteed
    // money or a year at a salary that loses on its own, or the package route
    // the app owner asked for does not exist in practice.
    const packageWins = beatCosts.filter((b) => b.gtd !== null || b.yrs !== null);
    comparisons++;
    if (contests > 0 && packageWins.length === 0) {
      fail('no contested free agent could be won by anything except salary — the package route does not exist');
    }
    console.log(`  Of ${beatCosts.length} losing openings, ${packageWins.length} can be won without touching salary.`);
    for (const b of beatCosts.slice(0, 8)) {
      console.log(
        `    ${b.name.padEnd(14)} you ${String(b.you).padStart(3)} vs rival ${String(b.rival).padStart(3)} — `
        + `salary ${b.apy === null ? 'no' : formatMoney(b.apy)}, guarantee ${b.gtd === null ? 'no' : `${Math.round(b.gtd * 100)}%`}, `
        + `term ${b.yrs === null ? 'no' : `${b.yrs}yr`} (cheapest: ${b.cheapest})`,
      );
    }
  }

  console.log(`\n${comparisons.toLocaleString()} comparisons, ${failures} disagreement${failures === 1 ? '' : 's'}.`);

  await prisma.league.delete({ where: { id: leagueId } });
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
