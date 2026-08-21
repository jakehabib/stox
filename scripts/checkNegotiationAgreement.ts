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
 * Run: npx tsx scripts/checkNegotiationAgreement.ts
 * ===========================================================================
 */

import { prisma } from '../lib/db';
import { createLeague } from '../lib/gen/league';
import { parseSettings } from '../lib/settings';
import { resolveNegotiationSession, negotiateOffer, runAiFreeAgencyWave, MARKET_FLOOR } from '../lib/freeagency';
import {
  decideOffer, minimumAcceptableApy, sessionFingerprint, clampOffer,
  signBandFor, maybeChance, ACCEPT_INTEREST,
  DEFAULT_STRUCTURE, type DealStructure, type NegotiationMode,
  type NegotiationSession, type Offer, type OfferDecision,
} from '../lib/negotiation';
import { capHit, formatMoney, marketValue, willingnessHorizon, maxYearsForAge, TERM } from '../lib/cap';
import { teamCapSummary } from '../lib/cap-summary';
import { maxOffer, parseGmProfile, teamNeeds, type RosterPlayer } from '../lib/ai/gm';
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
    'accepted', 'signBand', 'blocked', 'outbid', 'costsPatience', 'patienceCost',
    'maxPatienceCost', 'year1CapHit',
    'totalValue', 'guaranteedMoney', 'deadMoneyIfCut', 'strandedVoidMoney', 'reason',
  ];
  for (const k of keys) if (a[k] !== b[k]) return `${String(k)}: client ${JSON.stringify(a[k])} vs server ${JSON.stringify(b[k])}`;
  if (a.evaluation.interest !== b.evaluation.interest) return `interest: ${a.evaluation.interest} vs ${b.evaluation.interest}`;
  if (a.evaluation.verdict !== b.evaluation.verdict) return `verdict: ${a.evaluation.verdict} vs ${b.evaluation.verdict}`;
  if (a.evaluation.insulting !== b.evaluation.insulting) return `insulting: ${a.evaluation.insulting} vs ${b.evaluation.insulting}`;
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

    const screen = mode === 'FREE_AGENT' ? 'free agent'
      : mode === 'EXTENSION' ? `extension/${ctx.controlYears}yr control`
      : `re-sign/${ctx.resignWindow}`;
    console.log(
      `  ${(p.firstName + ' ' + p.lastName).padEnd(22)} ${p.position.padEnd(4)} ${String(p.trueOvr).padStart(2)}ovr ` +
      `${screen.padEnd(22)} ${ctx.personality.padEnd(10)} ` +
      `asks ~${formatMoney(ctx.reservationApy)}/yr, patience ${ctx.patience}, ` +
      `term<=${ctx.willingYears} (won't play past ${ctx.intendedFinalAge}), band +-${ctx.bandHalfWidth}, ` +
      `suitor ${clientSession.suitor ? `${clientSession.suitor.teamAbbr} ${formatMoney(clientSession.suitor.apy)}` : 'none'}, ` +
      `${acceptedCount} signable offers on the grid`,
    );
  }

  console.log(
    `\nGrid: ${gridPoints.toLocaleString()} offers compared (salary x years x guarantee, client session vs server session)` +
    `\n      ${typedPoints.toLocaleString()} typed-entry probes (values no slider can produce, plus empty/negative/1e9/NaN)` +
    `\n      ${shapePoints.toLocaleString()} deal shapes (front-load, back-load, void years — on all three screens)\n`,
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
    if (s.gate.competingApy > 0) { contested.push(p); if (contested.length >= 2) break; }
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
        apy: Math.min(closing.gate.maxSalary, Math.round(Math.max(closing.ctx.reservationApy * 1.4, closing.gate.competingApy * 1.25) / 100_000) * 100_000),
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
      if (session.gate.competingApy !== 0) {
        fail(`${p.lastName}: a re-sign gate carried a competing bid of ${formatMoney(session.gate.competingApy)} — nobody may bid on a player under contract`);
      }

      const roster = await prisma.player.findMany({
        where: { teamId: suitor.teamId },
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
      if (suitor.need < 0.15) fail(`${p.lastName}: ${suitor.teamAbbr} was named as interested but scores below the threshold its own AI bids at`);
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
    const wanted: { id: string; lastName: string; position: string; trueOvr: number; apy: number; abbr: string; need: number }[] = [];
    for (const p of finalCall) {
      const s = await resolveNegotiationSession({
        leagueId, playerId: p.id, teamId: team.id, seasonYear: league.seasonYear, settings, incumbent: true,
      });
      if (s.suitor) wanted.push({ id: p.id, lastName: p.lastName, position: p.position, trueOvr: p.trueOvr, apy: s.suitor.apy, abbr: s.suitor.teamAbbr, need: s.suitor.need });
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
      const qualifiesToBid = target.need >= 0.15;
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
    // The most expensive man still on the market at this point in the script.
    // A cheap player's band is only two or three slider steps wide, which
    // demonstrates nothing; the point is to see the three regions.
    const subject = await prisma.player.findFirstOrThrow({
      where: { leagueId, status: 'FREE_AGENT', teamId: null, isDraftee: false },
      orderBy: { trueOvr: 'desc' },
    });
    const session = await resolveNegotiationSession({
      leagueId, playerId: subject.id, teamId: team.id, seasonYear: league.seasonYear, settings, incumbent: false,
    });
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
      if (d.signBand === 'MAYBE') { if (d.accepted) maybeSigned++; else maybeRefused++; if (firstMaybe === null) firstMaybe = apy; }
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
      if (decideOffer(ctx, offer, gate, DEFAULT_STRUCTURE).signBand === 'MAYBE') inBand.push(offer);
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
    if (session.gate.competingApy !== 0) fail('an extension gate carried a competing bid');
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

  console.log(`\n${comparisons.toLocaleString()} comparisons, ${failures} disagreement${failures === 1 ? '' : 's'}.`);

  await prisma.league.delete({ where: { id: leagueId } });
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
