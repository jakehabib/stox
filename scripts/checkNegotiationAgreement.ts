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
 * Run: npx tsx scripts/checkNegotiationAgreement.ts
 * ===========================================================================
 */

import { prisma } from '../lib/db';
import { createLeague } from '../lib/gen/league';
import { parseSettings } from '../lib/settings';
import { resolveNegotiationSession, negotiateOffer } from '../lib/freeagency';
import {
  decideOffer, minimumAcceptableApy, sessionFingerprint,
  DEFAULT_STRUCTURE, type NegotiationSession, type Offer, type OfferDecision,
} from '../lib/negotiation';
import { formatMoney } from '../lib/cap';
import { Rng } from '../lib/rng';

let failures = 0;
let comparisons = 0;

function fail(msg: string) {
  failures++;
  if (failures <= 20) console.error(`  FAIL: ${msg}`);
}

/** Every field of the answer, not just the yes/no. */
function sameDecision(a: OfferDecision, b: OfferDecision): string | null {
  const keys: (keyof OfferDecision)[] = [
    'accepted', 'blocked', 'outbid', 'costsPatience', 'year1CapHit',
    'totalValue', 'guaranteedMoney', 'deadMoneyIfCut', 'reason',
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
    orderBy: { trueOvr: 'desc' },
    take: 6,
  });

  // A spread of the market, not just the top of it: the model's shape changes
  // with age (term limits), rating (patience) and rival interest.
  const sweepSubjects = [
    ...freeAgents.slice(0, 4).map((p) => ({ p, incumbent: false })),
    ...freeAgents.slice(20, 23).map((p) => ({ p, incumbent: false })),
    ...own.slice(0, 3).map((p) => ({ p, incumbent: true })),
  ];

  console.log(`\nLeague ${leagueId} — ${sweepSubjects.length} negotiations under test\n`);

  let gridPoints = 0;

  for (const { p, incumbent } of sweepSubjects) {
    // What the browser was handed when talks opened...
    const clientSession: NegotiationSession = await resolveNegotiationSession({
      leagueId, playerId: p.id, teamId: team.id, seasonYear: league.seasonYear, settings, incumbent,
    });
    // ...and what the Server Action resolves for itself on submit.
    const serverSession: NegotiationSession = await resolveNegotiationSession({
      leagueId, playerId: p.id, teamId: team.id, seasonYear: league.seasonYear, settings, incumbent,
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
        const below = decideOffer(ctx, { apy: Math.max(gate.minSalary, min - 100_000), years, guaranteePct }, gate, DEFAULT_STRUCTURE);
        const at = decideOffer(ctx, { apy: min, years, guaranteePct }, gate, DEFAULT_STRUCTURE);
        if (min <= gate.maxSalary && !at.evaluation.accepted) {
          fail(`${p.firstName} ${p.lastName}: minimumAcceptableApy(${years}yr) = ${formatMoney(min)} is not accepted`);
        }
        if (min > gate.minSalary && below.evaluation.accepted && min - 100_000 >= gate.minSalary) {
          fail(`${p.firstName} ${p.lastName}: ${formatMoney(min - 100_000)} accepted below minimumAcceptableApy ${formatMoney(min)}`);
        }
      }
    }

    console.log(
      `  ${(p.firstName + ' ' + p.lastName).padEnd(22)} ${p.position.padEnd(4)} ${String(p.trueOvr).padStart(2)}ovr ` +
      `${incumbent ? 're-sign' : 'free agent'} — ${ctx.personality.padEnd(10)} ` +
      `asks ~${formatMoney(ctx.reservationApy)}/yr, patience ${ctx.patience}, ` +
      `rival ${gate.competingApy ? formatMoney(gate.competingApy) : 'none'}, ` +
      `${acceptedCount} signable offers on the grid`,
    );
  }

  console.log(`\nGrid: ${gridPoints.toLocaleString()} offers compared (salary x years x guarantee, client session vs server session)\n`);

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
      settings, incumbent: false, offer, structure: DEFAULT_STRUCTURE, patienceSpent: 0,
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
      const expected = predicted.costsPatience ? (predicted.evaluation.insulting ? 2 : 1) : 0;
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
  console.log(`\n${comparisons.toLocaleString()} comparisons, ${failures} disagreement${failures === 1 ? '' : 's'}.`);

  await prisma.league.delete({ where: { id: leagueId } });
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
