/**
 * ===========================================================================
 * PERMANENT CHECK — MONEY IS NEITHER CREATED NOR DESTROYED BY A TRADE, A
 * RELEASE, OR ANY SEQUENCE OF MOVES A GM CAN ACTUALLY MAKE
 * ===========================================================================
 * INV-21 clause two, over the paths its siblings do not reach, and over the
 * COMPOSITIONS of all of them. Run with:
 *
 *   npm run check:money        (or: npx tsx scripts/checkMoneyConservation.ts)
 *
 * Exits non-zero on any failure, so it gates a release the way a real test
 * suite would. It is the last thing to run before sharing a build: every
 * defect it is built around silently corrupted a save that somebody had
 * already put seasons into.
 *
 * WHERE IT SITS IN THE FAMILY, and why it is a new file rather than a clause
 * in an old one. The existing checks each drive ONE mutation:
 *
 *   checkRestructure.ts       restructure + extension, pure arithmetic, 55k shapes
 *   checkRestructureWrite.ts  the restructure WRITE, against a database
 *   checkFranchiseTag.ts      the tag
 *   checkReSign.ts            the re-sign / extension write
 *   checkFifthYearOption.ts   the option year
 *
 * Nothing drove a TRADE, nothing drove a RELEASE, and — the gap that matters
 * most — nothing drove two moves in a row. Every defect in this area's history
 * was found in a single mutation examined on its own; a save is destroyed by
 * the SECOND one, because that is where a figure written in one frame is read
 * back in another. So this file's spine is sequences: restructure twice,
 * restructure then extend, extend then trade, tag then extend, trade a man in
 * the middle of his restructure year, then release him, and hold the whole
 * chain to one sum at the end of it.
 *
 * WHAT IT FOUND ON ITS FIRST RUN, and the reason the trade clauses lead:
 * `tradeCapEffect.takesOn` subtracted a flat year of proration from a cap hit
 * that, past the five-year bonus window, had never contained one. On a 7-year
 * deal in its seventh season the acquiring club's cap moved $7.90M while the
 * function told the cap gate, the trade screen and the AI's own refusal it was
 * taking on $4.76M; on a bigger bonus the same shape reported MINUS $80K —
 * acquiring a contract read as freeing money. `tradeCapDeltas` is what
 * `assertCapRoom` enforces, so this was a club being pushed over the ceiling
 * by a path that thought it had checked.
 *
 * THE CLAUSES.
 *
 *   M-1  A TRADE CONSERVES THE BONUS. Bonus billed to the seasons already
 *        played, plus what the trade books onto the selling club, plus what
 *        still prorates on the row that travels, equals the bonus the club
 *        actually handed over. Nothing appears; nothing evaporates.
 *
 *   M-2  BOTH LEDGERS MOVE BY EXACTLY `tradeCapEffect`. Read off
 *        `teamCapSummary` — the function the Cap page, the advance gate and
 *        every cap refusal run on — rather than recomputed. This is the
 *        clause the defect above failed, and it failed it on the BUYER's side,
 *        which is the side a cap gate has to protect.
 *
 *   M-3  THE GATE QUOTES THE FIGURE THE EXECUTOR WRITES. `tradeCapDeltas` is
 *        summed per club and held against the movement the ledger actually
 *        recorded. The gate, the executor, the trade screen's "space after"
 *        and `lib/tradeClosers.ts`'s AI refusal are all one call to
 *        `tradeCapEffect`; this is what says so out loud, every run.
 *
 *   M-4  A RELEASE COSTS `deadMoneyOnCut`, EXACTLY, ONCE. Driven through the
 *        real `cutPlayer` and read back off the `CapCharge` ledger — not the
 *        arithmetic, which was never the half that broke.
 *
 *   M-5  A SEQUENCE CONSERVES. Restructure, extend, tag, trade and release
 *        composed two and three deep: every dollar of every bonus ever paid on
 *        the man — original, converted, or newly signed — is charged to some
 *        club's cap in some year exactly once by the end of the chain.
 *
 *   M-6  THE LEDGER AND THE SUMMARY AGREE. `capSheet` column zero against
 *        `teamCapSummary`: same year, same ceiling, same active salary, same
 *        booked dead money. Two derivations of one number is how this app has
 *        repeatedly shipped a screen quoting a figure it was not using, and
 *        the Cap page's masthead tile and its outlook chart are that pair.
 *
 *   M-7  NO IMPOSSIBLE MONEY. Over every contract in the league after the
 *        whole sweep has run over it: no NaN, no Infinity, no negative cap
 *        hit, no negative dead money, no negative years, no proration over a
 *        window of zero, no guarantee below the bonus already handed over.
 *
 *   M-9  THE METER AND THE WRITE ARE THE SAME GATE, AND THE ROOM IT PROMISES
 *        IS THE ROOM THE LEDGER GIVES. `decideOffer` draws the
 *        negotiation panel in the browser; `assertCapRoom` refuses on the
 *        server. Asked behaviourally rather than by re-deriving the server's
 *        figure here: the club's room is squeezed to exactly what the panel
 *        says the deal adds, and the deal is then actually written. A walk-year
 *        re-sign is the one shape `extendContract` REPLACES rather than
 *        appends to, and the replaced deal's stranded void bonus accelerates in
 *        the same transaction — the panel priced only `newHit - oldHit`, so on
 *        a 3-year deal with two void years and $18.0M of bonus the meter said
 *        the re-sign added $833K while the server charged $8.03M, showed no cap
 *        block, and then refused on submit quoting a figure the screen had
 *        never shown.
 *
 *   M-8  EVERY CHARGE FILES IN THE BOOK YEAR. `capChargeYear()` answers which
 *        league year a charge booked right now belongs to, and the answer
 *        differs either side of the offseason roll — through OFFSEASON weeks
 *        1-2 the contract ledger has stepped and `League.seasonYear` has not.
 *        A charge filed a year early sits where compliance is not enforced and
 *        `expireStaleCapCharges` deletes it unbilled, which is how releases
 *        came to be free. Both sides of the roll are exercised, for the cut
 *        path and the trade path alike.
 *
 * AND THE HARNESS PROVES IT CAN FAIL, every run. A check that reads a field
 * which is not there compares `undefined` to `undefined`, reports a pass and
 * tests nothing — a mistake this repo has already made and paid for. So every
 * run fires `ok()` at a knowingly false statement, fires it again at the
 * undefined-vs-undefined trap, and puts `present()` on a deliberately
 * misspelled column. If those three do not produce exactly two failures the
 * run is failed outright, because its assertions do not work.
 *
 * IT BUILDS ITS OWN LEAGUE AND DESTROYS IT. The development database is shared
 * and holds real saves; nothing here reads, writes or deletes a league it did
 * not create, and the teardown deletes by COLLECTED ID. `CapCharge` cascades
 * from `Team` now (prisma/schema.prisma), but the rows are swept explicitly
 * first and the leftovers counted, because a check that leaks rows into a
 * shared database is a check nobody will run twice.
 *
 * SAMPLED BLIND. Subjects are taken in `id` order, never
 * `orderBy: { trueOvr: 'desc' }` — a sweep that only ever looks at the best
 * players measures the best players.
 * ===========================================================================
 */
import { prisma } from '../lib/db';
import { createLeague } from '../lib/gen/league';
import {
  buildContract, capChargeYear, capHit, capHitSchedule, deadMoneyOnCut, formatMoney,
  guaranteedMoney, guaranteedSalaryOwed, proration, prorationThisYear, prorationYears,
  restructureContract as computeRestructure,
  tradeCapEffect, unamortizedBonus, type ContractLike,
} from '../lib/cap';
import { capSheet, teamCapSummary, deadMoneyRunway } from '../lib/cap-summary';
import { CapViolationError, tradeCapDeltas } from '../lib/capEnforcement';
import { strandedVoidBonus } from '../lib/pendingCapChange';
import { executeTrade } from '../lib/trade';
import {
  cutPlayer, signExtension, applyFranchiseTag, restructureContract, extendContract,
  resolveNegotiationSession,
} from '../lib/freeagency';
import { DEFAULT_STRUCTURE, contractShapeFor, decideOffer } from '../lib/negotiation';
import { parseSettings } from '../lib/settings';
import { CAP } from '../lib/tuning';

/** Integer arithmetic rounds once per year; a few dollars is not a defect. */
const TOL = 5;
const M = formatMoney;

let checks = 0;
let failures = 0;
const shown = new Map<string, number>();

function ok(rule: string, pass: boolean, detail: string) {
  checks++;
  if (pass) return;
  failures++;
  const n = (shown.get(rule) ?? 0) + 1;
  shown.set(rule, n);
  if (n <= 4) console.log(`  FAIL ${rule}  ${detail}`);
}

/**
 * A figure read out of the database is only evidence if it is actually there.
 * `row.ammount === row.ammount` is true, costs nothing to write and tests
 * nothing at all; every database comparison below goes through here first.
 */
function present(label: string, v: unknown): boolean {
  if (v !== undefined && v !== null) return true;
  checks++;
  failures++;
  console.log(`  FAIL read  ${label} came back ${String(v)} — that comparison would have tested nothing`);
  return false;
}

/** Bonus already billed to the seasons this deal has played. */
function billedToPlayedSeasons(c: ContractLike): number {
  return proration(c) * Math.min(Math.max(0, c.years - c.yearsRemaining), prorationYears(c));
}

const shaped = (n: { baseSalaries: number[] }) => ({ ...n, baseSalaries: JSON.stringify(n.baseSalaries) } as ContractLike);

/** Write a contract of an exact shape onto a man, as if he had played `played` seasons of it. */
async function putContract(playerId: string, teamId: string, spec: {
  apy: number; years: number; bonusPct: number; voidYears: number; played: number; seasonYear: number;
}) {
  const fresh = buildContract({
    apy: spec.apy, years: spec.years, signedYear: spec.seasonYear - spec.played,
    bonusPct: spec.bonusPct, voidYears: spec.voidYears,
  });
  const row = {
    teamId,
    years: fresh.years,
    yearsRemaining: fresh.years - spec.played,
    signedYear: spec.seasonYear - spec.played,
    baseSalaries: JSON.stringify(fresh.baseSalaries),
    signingBonus: fresh.signingBonus,
    guaranteed: fresh.guaranteed,
    voidYears: fresh.voidYears,
    isRookieDeal: false,
    isFranchiseTag: false,
    fifthYearOption: null,
  };
  await prisma.contract.upsert({
    where: { playerId },
    update: row,
    create: { playerId, ...row },
  });
  await prisma.player.update({ where: { id: playerId }, data: { teamId, status: 'ACTIVE' } });
  return fresh;
}

/** Every cap charge on a club, whatever year it is filed against. */
async function charges(teamId: string) {
  return prisma.capCharge.findMany({
    where: { teamId }, select: { id: true, year: true, amount: true, label: true },
  });
}

const YEARS = [1, 2, 3, 5, 7];
const BONUS_PCTS = [0, 0.12, 0.28, 0.5];
const VOIDS = [0, 1, 2, 3];

async function main() {
  let leagueId: string | null = null;
  let teamIds: string[] = [];
  try {
    leagueId = await createLeague({
      name: 'INV-21 money conservation check',
      userTeamAbbr: 'ZZZ',
      seed: 'check-money-conservation',
      // The deadline OFF on purpose: it is what makes the pre-roll offseason
      // window reachable by a trade at all, and M-8 is about exactly that
      // window. `executeTrade`'s own comment says the deadline is the only
      // reason the year-roll boundary has never fired there — a setting is
      // not a guard, so the check plays the league that has it switched off.
      settings: { capMode: 'REALISTIC', tradeDeadlineEnabled: false, franchiseTagEnabled: true },
    });
    const teams = await prisma.team.findMany({
      where: { leagueId }, select: { id: true, abbr: true }, orderBy: { id: 'asc' },
    });
    teamIds = teams.map((t) => t.id);
    const league0 = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
    const seasonYear = league0.seasonYear;
    console.log(`league ${leagueId} — ${teams.length} clubs, ${league0.phase} wk ${league0.week}, season ${seasonYear}\n`);

    /**
     * SAMPLED BLIND — `id` order, never rating order. One subject per club,
     * reused across the sweep so his contract is OVERWRITTEN each round rather
     * than a new deal being added: the club's active salary starts each
     * measurement from the same place, and a sweep cannot slowly bankrupt the
     * league it is measuring.
     */
    const subject = new Map<string, { id: string; name: string }>();
    for (const t of teams) {
      const men = await prisma.player.findMany({
        where: { teamId: t.id, status: 'ACTIVE' }, orderBy: { id: 'asc' },
        select: { id: true, firstName: true, lastName: true }, take: 2,
      });
      subject.set(t.id, { id: men[0].id, name: `${men[0].firstName} ${men[0].lastName}` });
    }

    // =====================================================================
    // M-9 — THE METER AND THE WRITE ARE THE SAME GATE
    //
    // IT RUNS FIRST, before the sweeps below park expensive contracts all over
    // the league: the clause works by squeezing a club's room down to the exact
    // size of the deal, and a club already $28M over has nothing to squeeze.
    //
    // `decideOffer` draws the negotiation panel in the browser on every drag
    // of a slider; `assertCapRoom` refuses on submit, on the server. They are
    // the same decision and they must be the same arithmetic, or the panel is
    // a promise the game does not keep.
    //
    // ASKED BEHAVIOURALLY, never by re-deriving the server's figure here. The
    // club's room is squeezed to EXACTLY what the panel says the deal adds —
    // so the panel, by its own arithmetic, must allow it — and then the deal is
    // actually written. Any term the panel is missing shows up as a refusal.
    // A harness that computed the expected delta itself would be a third
    // implementation of the very rule it is checking.
    //
    // WHAT IT CAUGHT. A walk-year re-sign is the one shape `extendContract`
    // REPLACES rather than appends to, and the replaced deal's stranded void
    // bonus accelerates in the same transaction. The panel priced only
    // `newHit - oldHit`. On a 3-year deal with two void years and $18.0M of
    // bonus the meter said the re-sign added $833K and the server charged
    // $8.03M — the panel showed no cap block at all and the submit came back
    // "adds $7.97M against $4.43M of room", a refusal quoting a figure the
    // screen had never shown.
    // =====================================================================
    {
      const settings = parseSettings(league0.settings);
      const gateTeam = teams[8];
      await prisma.league.update({ where: { id: leagueId }, data: { phase: 'RESIGN', week: 1 } });
      let gateRounds = 0;
      for (const spec of [
        // The walk-year shapes — `yearsRemaining: 0`, the replace branch. Void
        // years are what make the stranded bonus non-zero, and a shape with
        // none is swept beside them so the clause cannot pass by only ever
        // looking at the case that breaks.
        { years: 3, bonusPct: 0.5, voidYears: 2, played: 3 },
        { years: 3, bonusPct: 0.28, voidYears: 3, played: 3 },
        { years: 2, bonusPct: 0.5, voidYears: 3, played: 2 },
        { years: 4, bonusPct: 0.28, voidYears: 0, played: 4 },
        // ...and the appending shapes, where the bonus is carried rather than
        // accelerated and the credit is the whole old hit.
        { years: 4, bonusPct: 0.28, voidYears: 0, played: 2 },
        { years: 3, bonusPct: 0.5, voidYears: 2, played: 1 },
      ]) {
        const man = subject.get(gateTeam.id)!;
        await putContract(man.id, gateTeam.id, { apy: 11_000_000, ...spec, seasonYear });
        const cur = await prisma.contract.findUniqueOrThrow({ where: { playerId: man.id } });
        const label = `${spec.years}yr+${cur.voidYears}v played ${spec.played}`;
        const offer = { apy: 7_000_000, years: 3, guaranteePct: 0.5 };

        // Clear anything a previous round soaked up, then read the panel.
        await prisma.capCharge.deleteMany({ where: { teamId: gateTeam.id, label: 'M-9 room squeeze' } });
        const open = await resolveNegotiationSession({
          leagueId, playerId: man.id, teamId: gateTeam.id, seasonYear,
          settings, incumbent: true, mode: cur.yearsRemaining > 0 ? 'EXTENSION' : 'RESIGN',
        });
        if (!present(`${label} gate.capAcceleratesOnReplace`, open.gate.capAcceleratesOnReplace)) continue;
        const first = decideOffer(open.ctx, offer, open.gate, DEFAULT_STRUCTURE);

        // The term the panel now carries is exactly the money the write path
        // accelerates, and only on the branch that accelerates any.
        ok('M-9 the panel carries the acceleration the write books',
          open.gate.capAcceleratesOnReplace
            === (cur.yearsRemaining <= 0 ? unamortizedBonus(cur, 'REALISTIC') : 0),
          `${label}: gate ${M(open.gate.capAcceleratesOnReplace)} vs ${M(cur.yearsRemaining <= 0 ? unamortizedBonus(cur, 'REALISTIC') : 0)}`);

        const panelDelta = first.year1CapHit - open.gate.capCreditBack + open.gate.capAcceleratesOnReplace;
        /*
         * TWO SHAPES, AND BOTH OF THEM HAVE BEEN BROKEN HERE BEFORE.
         *
         * A DEAL THAT ADDS MONEY is squeezed to EXACTLY the room the panel says
         * it needs. The panel's own test is `delta > space + tolerance`, so at
         * equality it must allow — and so, therefore, must the server. Anything
         * the panel is not counting turns up as a refusal.
         *
         * A DEAL THAT FREES MONEY — an extension that converts salary into
         * bonus routinely does — is pushed the other way: the club is put well
         * OVER the ceiling and the deal offered anyway. `assertCapRoom` lets any
         * move through that adds nothing (`if (delta <= 0) continue`) and the
         * meter has to agree, or a save that has gone wrong cannot be dug out.
         * That is the app owner's own report — "trying to extend someone and it
         * not allowing it. Even tho the game says it will reduce his cap hit" —
         * and 3,803 of 3,990 such offers were blocked before it was fixed.
         */
        const room = (await teamCapSummary(gateTeam.id, seasonYear, 'REALISTIC')).capSpace;
        const soak = panelDelta > 0
          ? Math.round(room - panelDelta)
          : Math.round(room + 20_000_000);
        if (soak > 0) {
          await prisma.capCharge.create({
            data: { teamId: gateTeam.id, year: capChargeYear({ phase: 'RESIGN', week: 1, seasonYear }), amount: soak, label: 'M-9 room squeeze' },
          });
        }
        const tight = await resolveNegotiationSession({
          leagueId, playerId: man.id, teamId: gateTeam.id, seasonYear,
          settings, incumbent: true, mode: cur.yearsRemaining > 0 ? 'EXTENSION' : 'RESIGN',
        });
        const drawn = decideOffer(tight.ctx, offer, tight.gate, DEFAULT_STRUCTURE);
        ok(panelDelta > 0
          ? 'M-9 the panel allows a deal it has exactly the room for'
          : 'M-9 the panel allows a deal that frees room, over the cap',
          drawn.blocked !== 'CAP',
          `${label}: squeezed to ${M(tight.gate.capSpace)} for a ${M(panelDelta)} deal and the meter blocked anyway`);

        const shape = contractShapeFor(offer);
        let refused: string | null = null;
        try {
          // The same call `negotiateOffer` makes on submit, with the same
          // structure the meter above was drawn from.
          await extendContract({
            leagueId, playerId: man.id, apy: offer.apy, years: offer.years, seasonYear,
            capMode: 'REALISTIC', week: 1,
            escalation: DEFAULT_STRUCTURE.escalation, voidYears: DEFAULT_STRUCTURE.voidYears,
            bonusPct: shape.bonusPct, guaranteedPct: shape.guaranteedPct,
            convertPct: DEFAULT_STRUCTURE.convertPct, reSign: cur.yearsRemaining <= 0,
          });
        } catch (err) {
          refused = err instanceof CapViolationError ? err.message : `(not a cap refusal) ${(err as Error).message}`;
        }
        ok('M-9 the write takes the deal the meter drew',
          refused === null,
          `${label}: meter allowed ${M(panelDelta)} against ${M(tight.gate.capSpace)} of room, server said — ${refused}`);

        /*
         * AND THE ROOM THE PANEL PROMISED IS THE ROOM THE CLUB ENDS UP WITH.
         * `useNegotiation` draws "Cap space after" as `capSpace - capDelta`;
         * the ledger is the oracle, read back after the deal is actually on the
         * books. It drew it as `capSpace - year1CapHit` instead — right only
         * while `capSpace` had the incumbent's hit folded into it, which it has
         * not since that credit was split into its own field — and charged the
         * club his whole cap hit twice: $61.2M promised against $84.0M
         * delivered on a $22.8M man, with an extension that FREES $11.3M
         * reading as one that spends $11.5M.
         */
        if (refused === null) {
          const landed = await teamCapSummary(gateTeam.id, seasonYear, 'REALISTIC');
          if (present(`${label} ledger capSpace after`, landed.capSpace)) {
            ok('M-9 the room the panel promises is the room the ledger gives',
              Math.abs((tight.gate.capSpace - drawn.capDelta) - landed.capSpace) <= TOL,
              `${label}: panel promised ${M(tight.gate.capSpace - drawn.capDelta)}, ledger gave ${M(landed.capSpace)}`);
          }
        }
        gateRounds++;
        await prisma.capCharge.deleteMany({ where: { teamId: gateTeam.id, label: 'M-9 room squeeze' } });
      }
      ok('M-9 actually ran', gateRounds >= 6, `only ${gateRounds} gate rounds reached the write`);
      await prisma.league.update({ where: { id: leagueId }, data: { phase: league0.phase, week: league0.week } });
    }

    // =====================================================================
    // M-1 / M-2 / M-3 — THE TRADE
    // =====================================================================
    let traded = 0;
    for (const years of YEARS) {
      for (const bonusPct of BONUS_PCTS) {
        for (const voidYears of VOIDS) {
          for (const played of [0, 1, years - 1]) {
            if (played < 0 || played >= years + 1) continue;
            const from = teams[traded % teams.length];
            const to = teams[(traded + 1) % teams.length];
            traded++;
            const man = subject.get(from.id)!;
            const fresh = await putContract(man.id, from.id, { apy: 8_000_000, years, bonusPct, voidYears, played, seasonYear });
            const label = `${from.abbr}->${to.abbr} ${years}yr+${fresh.voidYears}v bonus ${M(fresh.signingBonus)} played ${played}`;

            const before = await prisma.contract.findUniqueOrThrow({ where: { playerId: man.id } });
            if (!present(`${label} contract.signingBonus`, before.signingBonus)) continue;
            const paid = fresh.signingBonus;
            const billed = billedToPlayedSeasons(before);
            const effect = tradeCapEffect(before, 'REALISTIC');
            const deltas = await tradeCapDeltas([{ type: 'PLAYER', id: man.id }], from.id, to.id, 'REALISTIC');
            const gateFrom = deltas.filter((d) => d.teamId === from.id).reduce((a, d) => a + d.delta, 0);
            const gateTo = deltas.filter((d) => d.teamId === to.id).reduce((a, d) => a + d.delta, 0);

            const preFrom = await teamCapSummary(from.id, seasonYear, 'REALISTIC');
            const preTo = await teamCapSummary(to.id, seasonYear, 'REALISTIC');
            const idsBefore = new Set((await charges(from.id)).map((c) => c.id));

            // `force` skips the REFUSAL and nothing else — the money is booked
            // exactly as it is for an ordinary trade (executeTrade). Without it
            // the sweep would silently skip every shape a club could not afford,
            // which is a harness measuring the cheap half of its own space.
            await executeTrade({
              leagueId, teamA: from.id, teamB: to.id,
              aToB: [{ type: 'PLAYER', id: man.id }], bToA: [],
              seasonYear, week: league0.week, force: true,
            });

            const after = await prisma.contract.findUniqueOrThrow({ where: { playerId: man.id } });
            const postFrom = await teamCapSummary(from.id, seasonYear, 'REALISTIC');
            const postTo = await teamCapSummary(to.id, seasonYear, 'REALISTIC');
            const booked = (await charges(from.id)).filter((c) => !idsBefore.has(c.id));
            const bookedTotal = booked.reduce((a, c) => a + c.amount, 0);
            for (const c of booked) { present(`${label} CapCharge.amount`, c.amount); present(`${label} CapCharge.year`, c.year); }

            // M-1 — nothing paid goes uncharged, and nothing is charged twice.
            const everCharged = billed + bookedTotal + unamortizedBonus(after, 'REALISTIC');
            ok('M-1 a trade conserves the bonus', Math.abs(everCharged - paid) <= TOL * (years + 2),
              `${label}: charged ${M(everCharged)} against ${M(paid)} paid`);
            ok('M-1 the seller books the bonus a cut would accelerate',
              Math.abs(bookedTotal - unamortizedBonus(before, 'REALISTIC')) <= TOL,
              `${label}: booked ${M(bookedTotal)} vs unamortised ${M(unamortizedBonus(before, 'REALISTIC'))}`);
            ok('M-1 nothing is invented on a deal with nothing owing',
              unamortizedBonus(before, 'REALISTIC') > 0 || booked.length === 0,
              `${label}: ${booked.length} charge(s) worth ${M(bookedTotal)} against nothing unamortised`);
            ok('M-1 the contract that travels carries no bonus',
              after.signingBonus === 0 && after.voidYears === 0,
              `${label}: travelled with bonus ${M(after.signingBonus)} and ${after.voidYears} void years`);

            // M-2 — both ledgers moved by exactly what the shared function said.
            ok('M-2 seller ledger moves by tradeCapEffect.frees',
              Math.abs((preFrom.capUsed - postFrom.capUsed) - effect.frees) <= TOL,
              `${label}: freed ${M(preFrom.capUsed - postFrom.capUsed)} vs ${M(effect.frees)}`);
            ok('M-2 buyer ledger moves by tradeCapEffect.takesOn',
              Math.abs((postTo.capUsed - preTo.capUsed) - effect.takesOn) <= TOL,
              `${label}: took on ${M(postTo.capUsed - preTo.capUsed)} vs ${M(effect.takesOn)}`);
            // A contract is not a source of cap room for the club ACQUIRING it.
            ok('M-2 acquiring a contract never frees the buyer cap', effect.takesOn >= -TOL,
              `${label}: takesOn ${M(effect.takesOn)}`);

            // M-3 — the gate was quoting the movement the executor wrote.
            ok('M-3 gate and executor agree, seller',
              Math.abs(gateFrom - (postFrom.capUsed - preFrom.capUsed)) <= TOL,
              `${label}: gate ${M(gateFrom)} vs ledger ${M(postFrom.capUsed - preFrom.capUsed)}`);
            ok('M-3 gate and executor agree, buyer',
              Math.abs(gateTo - (postTo.capUsed - preTo.capUsed)) <= TOL,
              `${label}: gate ${M(gateTo)} vs ledger ${M(postTo.capUsed - preTo.capUsed)}`);
          }
        }
      }
    }
    console.log(`  M-1/M-2/M-3: ${traded} trades swept`);

    // =====================================================================
    // M-4 — THE RELEASE
    // =====================================================================
    let released = 0;
    for (const years of YEARS) {
      for (const bonusPct of [0, 0.28, 0.5]) {
        for (const voidYears of [0, 2, 3]) {
          for (const played of [0, years - 1]) {
            if (played < 0) continue;
            const team = teams[released % teams.length];
            released++;
            const man = subject.get(team.id)!;
            const fresh = await putContract(man.id, team.id, { apy: 6_000_000, years, bonusPct, voidYears, played, seasonYear });
            const label = `${team.abbr} ${years}yr+${fresh.voidYears}v bonus ${M(fresh.signingBonus)} played ${played}`;
            const before = await prisma.contract.findUniqueOrThrow({ where: { playerId: man.id } });
            const dead = deadMoneyOnCut(before, 'REALISTIC');
            const billed = billedToPlayedSeasons(before);
            const pre = await teamCapSummary(team.id, seasonYear, 'REALISTIC');
            const idsBefore = new Set((await charges(team.id)).map((c) => c.id));

            await cutPlayer({ leagueId, playerId: man.id, capMode: 'REALISTIC', seasonYear, week: league0.week });

            const booked = (await charges(team.id)).filter((c) => !idsBefore.has(c.id));
            const bookedTotal = booked.reduce((a, c) => a + c.amount, 0);
            const post = await teamCapSummary(team.id, seasonYear, 'REALISTIC');
            for (const c of booked) present(`${label} CapCharge.amount`, c.amount);

            ok('M-4 a release books exactly the dead money it quotes',
              Math.abs(bookedTotal - dead) <= TOL, `${label}: booked ${M(bookedTotal)} vs quoted ${M(dead)}`);
            ok('M-4 one charge, not two', booked.length <= 1,
              `${label}: ${booked.length} charges written for one release`);
            ok('M-4 the ledger moves by the hit less the dead money',
              Math.abs((pre.capUsed - post.capUsed) - (capHit(before, 'REALISTIC') - dead)) <= TOL,
              `${label}: freed ${M(pre.capUsed - post.capUsed)} vs ${M(capHit(before, 'REALISTIC') - dead)}`);
            // A release books TWO kinds of money — the unamortised bonus, whose
            // charge accelerates, and guaranteed salary the club has yet to pay
            // and now must. Only the first half is the bonus, so the second is
            // netted out and the clause stays a statement about the bonus and
            // nothing else. (That the two are never double-counted is what
            // `deadMoneyOnCut` is held to, and the clause above checks the
            // booked total against it.)
            const guaranteedHalf = guaranteedSalaryOwed(before, 'REALISTIC');
            ok('M-4 the bonus is conserved by a release',
              Math.abs((billed + bookedTotal - guaranteedHalf) - fresh.signingBonus) <= TOL * (years + 2),
              `${label}: billed ${M(billed)} + booked ${M(bookedTotal)} less ${M(guaranteedHalf)} of salary, against ${M(fresh.signingBonus)} of bonus`);
            ok('M-4 the release charge files in the book year',
              booked.every((c) => c.year === capChargeYear({ phase: league0.phase, week: league0.week, seasonYear })),
              `${label}: filed [${booked.map((c) => c.year).join(', ')}], expected ${capChargeYear({ phase: league0.phase, week: league0.week, seasonYear })}`);

            // Put him back where he was for the next round.
            await prisma.player.update({ where: { id: man.id }, data: { teamId: team.id, status: 'ACTIVE' } });
          }
        }
      }
    }
    console.log(`  M-4: ${released} releases swept`);

    // =====================================================================
    // M-5 — SEQUENCES. Every dollar of every bonus ever paid on this man is
    // charged to somebody's cap, in some year, exactly once.
    // =====================================================================
    type Step = 'RESTRUCTURE' | 'EXTEND' | 'TAG' | 'TRADE' | 'CUT';
    const SEQUENCES: Step[][] = [
      ['RESTRUCTURE', 'RESTRUCTURE'],
      ['RESTRUCTURE', 'RESTRUCTURE', 'CUT'],
      ['RESTRUCTURE', 'EXTEND'],
      ['RESTRUCTURE', 'EXTEND', 'CUT'],
      ['EXTEND', 'TRADE'],
      ['RESTRUCTURE', 'TRADE'],
      ['RESTRUCTURE', 'TRADE', 'CUT'],
      ['EXTEND', 'RESTRUCTURE', 'CUT'],
      ['TAG', 'EXTEND'],
      ['TAG', 'EXTEND', 'CUT'],
      ['TAG', 'CUT'],
      ['EXTEND', 'EXTEND', 'TRADE'],
    ];
    let sequences = 0;
    let stepsRun = 0;
    let seqBlocked = 0;
    /** A tag is one per club per league year, so each sequence gets its own. */
    let tagYear = seasonYear + 500;

    for (const seq of SEQUENCES) {
      for (const spec of [
        { years: 3, bonusPct: 0.28, voidYears: 0, played: 1 },
        { years: 5, bonusPct: 0.5, voidYears: 0, played: 2 },
        { years: 3, bonusPct: 0.28, voidYears: 2, played: 1 },
        { years: 7, bonusPct: 0.28, voidYears: 0, played: 5 },
        { years: 2, bonusPct: 0.12, voidYears: 3, played: 0 },
      ]) {
        const home = teams[sequences % teams.length];
        const away = teams[(sequences + 3) % teams.length];
        sequences++;
        const man = subject.get(home.id)!;
        // A year nobody else in this file has touched, so the tag's
        // one-per-club-per-year rule can never be what fails a sequence.
        const year = seq.includes('TAG') ? tagYear++ : seasonYear;
        const fresh = await putContract(man.id, home.id, { apy: 4_000_000, ...spec, seasonYear: year });
        const label = `${seq.join('>')} on ${spec.years}yr+${fresh.voidYears}v played ${spec.played}`;

        // Everything the club has ever handed this man in cash that has to
        // land on a cap somewhere: the original bonus, plus anything a later
        // move converted or newly promised.
        let paid = fresh.signingBonus;
        // Bonus already billed to seasons played BEFORE the sequence starts.
        const opening = await prisma.contract.findUniqueOrThrow({ where: { playerId: man.id } });
        let billedOut = billedToPlayedSeasons(opening);
        const ledgerBefore = new Map<string, number>();
        for (const t of [home, away]) {
          ledgerBefore.set(t.id, (await charges(t.id)).reduce((a, c) => a + c.amount, 0));
        }
        let owner = home;
        let alive = true;
        let failed: string | null = null;
        let guaranteedBookedOnCut = 0;

        for (const step of seq) {
          if (!alive) break;
          const cur = await prisma.contract.findUnique({ where: { playerId: man.id } });
          if (!cur) { alive = false; break; }
          try {
            if (step === 'RESTRUCTURE') {
              const bases: number[] = JSON.parse(cur.baseSalaries);
              const idx = Math.max(0, cur.years - cur.yearsRemaining);
              const room = Math.max(0, (bases[idx] ?? 0) - CAP.MIN_SALARY);
              if (room <= 0) continue;
              const want = Math.round(room / 2);
              const preview = computeRestructure(cur, want, { nowYear: year });
              await restructureContract({
                leagueId, playerId: man.id, convertAmount: want,
                seasonYear: year, capMode: 'REALISTIC', week: league0.week,
              });
              // Converted salary becomes cash in his pocket, so it joins the
              // pile of money that has to be charged to a cap.
              paid += preview.converted;
            } else if (step === 'EXTEND') {
              await signExtension({
                leagueId, playerId: man.id, newMoneyApy: 3_000_000, addYears: 2,
                seasonYear: year, capMode: 'REALISTIC', week: league0.week,
                bonusPct: 0.28, convertPct: 0,
              });
              const next = await prisma.contract.findUniqueOrThrow({ where: { playerId: man.id } });
              // The row now carries the OLD unamortised bonus plus a brand new
              // one. Only the new half is fresh cash; the carried half is
              // already inside `paid`.
              paid += next.signingBonus - unamortizedBonus(cur, 'REALISTIC');
            } else if (step === 'TAG') {
              // The tag replaces the deal and accelerates its bonus onto the
              // club as a charge — nothing new is paid to him in bonus.
              await applyFranchiseTag({ leagueId, playerId: man.id, seasonYear: year, capMode: 'REALISTIC', week: league0.week });
            } else if (step === 'TRADE') {
              const dest = owner.id === home.id ? away : home;
              await executeTrade({
                leagueId, teamA: owner.id, teamB: dest.id,
                aToB: [{ type: 'PLAYER', id: man.id }], bToA: [],
                seasonYear: year, week: league0.week, force: true,
              });
              owner = dest;
            } else if (step === 'CUT') {
              // Read BEFORE the write: a release books the unamortised bonus
              // and the guaranteed salary still owed in one row, and only the
              // first half is bonus. Captured here rather than inferred from
              // the ledger movement afterwards, which would be the harness
              // deriving the very figure it is meant to be checking.
              guaranteedBookedOnCut += guaranteedSalaryOwed(cur, 'REALISTIC');
              await cutPlayer({ leagueId, playerId: man.id, capMode: 'REALISTIC', seasonYear: year, week: league0.week });
              alive = false;
            }
            stepsRun++;
          } catch (err) {
            // A CLUB THAT GENUINELY CANNOT AFFORD THE NEXT STEP IS A LEGAL
            // OUTCOME, not a defect — the gate refusing is the gate working,
            // and by this point in the file the sweep above has deliberately
            // parked expensive contracts all over the league. It is counted
            // rather than shrugged at: a run where the cap ate most of the
            // sequences would be a green tick over compositions nobody ran,
            // so the count is asserted at the end.
            if (err instanceof CapViolationError) { seqBlocked++; alive = false; break; }
            failed = `${step}: ${(err as Error).message}`;
            break;
          }
        }
        // A step that legitimately refuses (nothing left to convert, a tag on a
        // shape the rules forbid) is a real outcome and not a failure — but a
        // sweep that skipped everything is a pass that means nothing, which the
        // step count below asserts.
        if (failed && !/convert|minimum|tag|Nothing left/i.test(failed)) {
          ok('M-5 a legal sequence runs to the end', false, `${label}: ${failed}`);
          continue;
        }

        let bookedDelta = 0;
        for (const t of [home, away]) {
          bookedDelta += (await charges(t.id)).reduce((a, c) => a + c.amount, 0) - (ledgerBefore.get(t.id) ?? 0);
        }
        const end = await prisma.contract.findUnique({ where: { playerId: man.id } });
        const stillPro = end ? unamortizedBonus(end, 'REALISTIC') : 0;
        // A release also books GUARANTEED SALARY, which is not bonus and is not
        // in `paid`; it is netted out so the clause stays a statement about the
        // bonus and nothing else.
        const everCharged = billedOut + (bookedDelta - guaranteedBookedOnCut) + stillPro;

        ok('M-5 a sequence conserves the bonus',
          everCharged <= paid + TOL * 12 && everCharged >= paid - TOL * 12,
          `${label}: charged ${M(everCharged)} against ${M(paid)} paid (booked ${M(bookedDelta)} of which ${M(guaranteedBookedOnCut)} was salary, still prorating ${M(stillPro)})`);
        if (end) {
          ok('M-5 no impossible row survives a sequence',
            Number.isFinite(end.signingBonus) && end.signingBonus >= 0 && end.guaranteed >= 0
            && end.years >= 1 && end.yearsRemaining >= 0 && capHit(end, 'REALISTIC') >= 0
            && deadMoneyOnCut(end, 'REALISTIC') >= 0,
            `${label}: years ${end.years}/${end.yearsRemaining} bonus ${end.signingBonus} guar ${end.guaranteed} hit ${capHit(end, 'REALISTIC')}`);
        }
        // Put him back on his club for the next sequence.
        await prisma.player.update({ where: { id: man.id }, data: { teamId: home.id, status: 'ACTIVE' } });
      }
    }
    ok('M-5 the cap did not eat the sequence sweep', seqBlocked <= sequences / 3,
      `${seqBlocked} of ${sequences} sequences were cut short by a cap refusal — too little is being composed to gate anything`);
    console.log(`  M-5: ${sequences} sequences, ${stepsRun} mutations composed, ${seqBlocked} cut short by the cap`);

    // =====================================================================
    // M-6 — THE LEDGER AND THE SUMMARY AGREE
    // =====================================================================
    const lgNow = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
    for (const t of teams) {
      const s = await teamCapSummary(t.id, lgNow.seasonYear, 'REALISTIC');
      const sheet = await capSheet(t.id, lgNow, 'REALISTIC');
      const runway = await deadMoneyRunway(t.id, lgNow, 'REALISTIC');
      if (!sheet) { ok('M-6 the cap sheet exists in REALISTIC', false, `${t.abbr}: capSheet returned null`); continue; }
      if (!present(`${t.abbr} capSheet.years[0].activeSalary`, sheet.years[0].activeSalary)) continue;
      if (!present(`${t.abbr} summary.activeSalary`, s.activeSalary)) continue;
      ok('M-6 same book year', sheet.years[0].year === s.capYear && sheet.ledgerYear === s.capYear,
        `${t.abbr}: sheet ${sheet.years[0].year}/${sheet.ledgerYear} vs summary ${s.capYear}`);
      ok('M-6 same ceiling', sheet.years[0].capTotal === s.capTotal,
        `${t.abbr}: ${M(sheet.years[0].capTotal)} vs ${M(s.capTotal)}`);
      ok('M-6 same active salary', Math.abs(sheet.years[0].activeSalary - s.activeSalary) <= TOL,
        `${t.abbr}: ${M(sheet.years[0].activeSalary)} vs ${M(s.activeSalary)}`);
      ok('M-6 same booked dead money', Math.abs(sheet.years[0].deadBooked - s.deadMoney) <= TOL,
        `${t.abbr}: ${M(sheet.years[0].deadBooked)} vs ${M(s.deadMoney)}`);
      // The runway is what the sheet's dead segment is MADE of; the summary
      // reads the same rows a year at a time. Two readings, one value.
      ok('M-6 the runway itemises the sheet',
        Math.abs(runway.years[0].booked - s.deadMoney) <= TOL,
        `${t.abbr}: runway ${M(runway.years[0].booked)} vs summary ${M(s.deadMoney)}`);
      ok('M-6 every runway item is inside its own total',
        runway.years.every((y) => Math.abs(y.items.reduce((a, i) => a + i.amount, 0) - y.total) <= TOL),
        `${t.abbr}: a runway column's items do not sum to the column`);
      ok('M-6 room is the ceiling less what is committed',
        sheet.years.every((y) => Math.abs(y.room - (y.capTotal - y.activeSalary - y.deadTotal)) <= TOL),
        `${t.abbr}: a cap-sheet column's room is not its own arithmetic`);
    }

    // =====================================================================
    // M-7 — NO IMPOSSIBLE MONEY, over every contract the sweep has touched
    // =====================================================================
    const allContracts = await prisma.contract.findMany({
      where: { player: { leagueId } },
      select: {
        playerId: true, years: true, yearsRemaining: true, signedYear: true, baseSalaries: true,
        signingBonus: true, guaranteed: true, voidYears: true, isRookieDeal: true, fifthYearOption: true,
      },
    });
    let sane = 0;
    for (const c of allContracts) {
      const hit = capHit(c, 'REALISTIC');
      const dead = deadMoneyOnCut(c, 'REALISTIC');
      const win = prorationYears(c);
      const sched = capHitSchedule(c, 'REALISTIC');
      const bad =
        !Number.isFinite(hit) || hit < 0
        || !Number.isFinite(dead) || dead < 0
        || c.years < 1 || c.yearsRemaining < 0 || c.yearsRemaining > c.years
        || c.signingBonus < 0 || c.guaranteed < 0 || c.voidYears < 0
        || win < 1 || !Number.isFinite(proration(c))
        || sched.some((v) => !Number.isFinite(v) || v < 0);
      if (!bad) sane++;
      ok('M-7 no impossible money', !bad,
        `player ${c.playerId}: ${c.years}/${c.yearsRemaining}yr +${c.voidYears}v bonus ${c.signingBonus} guar ${c.guaranteed} hit ${hit} dead ${dead} window ${win}`);
      ok('M-7 the guarantee is never below the cash already handed over',
        guaranteedMoney(c) >= c.signingBonus,
        `player ${c.playerId}: guaranteed ${M(guaranteedMoney(c))} vs bonus ${M(c.signingBonus)}`);
      ok('M-7 the bonus charged this season is the bonus in the hit',
        Math.abs(prorationThisYear(c, 'REALISTIC') - (Math.max(0, c.years - c.yearsRemaining) < win ? proration(c) : 0)) <= TOL,
        `player ${c.playerId}: ${M(prorationThisYear(c, 'REALISTIC'))}`);
      // A void year that survived onto a deal long enough to amortise without
      // it is a stored claim the ledger cannot honour — see usableVoidYears.
      ok('M-7 a stored void year still does work',
        c.voidYears === 0 || strandedVoidBonus(c) >= 0,
        `player ${c.playerId}: ${c.voidYears} void years stranding ${M(strandedVoidBonus(c))}`);
    }
    console.log(`  M-6/M-7: ${teams.length} clubs reconciled, ${sane}/${allContracts.length} contracts sane`);

    // =====================================================================
    // M-8 — EVERY CHARGE FILES IN THE BOOK YEAR, ON BOTH SIDES OF THE ROLL
    //
    // Through OFFSEASON weeks 1-2 `ageContractsForYear` has already stepped
    // every contract onto the new league year and `League.seasonYear` has not
    // moved. A charge filed against the year that is ending sits in a window
    // where compliance is deliberately not enforced and `expireStaleCapCharges`
    // then hard-deletes it, so nobody is ever billed. That is precisely how
    // releases came to be free, and the trade path has the same boundary with
    // nothing but the trade deadline standing in front of it.
    // =====================================================================
    for (const [phase, week] of [['OFFSEASON', 1], ['PRESEASON', 1]] as [string, number][]) {
      await prisma.league.update({ where: { id: leagueId }, data: { phase, week } });
      const want = capChargeYear({ phase, week, seasonYear });
      const other = phase === 'OFFSEASON' ? seasonYear : seasonYear + 1;

      // The release side.
      {
        const team = teams[4];
        const man = subject.get(team.id)!;
        await putContract(man.id, team.id, { apy: 12_000_000, years: 4, bonusPct: 0.5, voidYears: 0, played: 1, seasonYear });
        const before = await prisma.contract.findUniqueOrThrow({ where: { playerId: man.id } });
        const dead = deadMoneyOnCut(before, 'REALISTIC');
        const idsBefore = new Set((await charges(team.id)).map((c) => c.id));
        await cutPlayer({ leagueId, playerId: man.id, capMode: 'REALISTIC', seasonYear, week });
        const booked = (await charges(team.id)).filter((c) => !idsBefore.has(c.id));
        present(`${phase} release CapCharge.year`, booked[0]?.year);
        ok('M-8 a release files in the book year',
          dead > 0 && booked.length === 1 && booked[0].year === want,
          `${phase} wk${week}: ${M(dead)} filed [${booked.map((c) => c.year).join(', ')}], expected ${want}`);
        ok('M-8 a release files nothing in the other year',
          booked.every((c) => c.year !== other),
          `${phase} wk${week}: a charge landed in ${other}, which is not the year the club's books are in`);
        await prisma.player.update({ where: { id: man.id }, data: { teamId: team.id, status: 'ACTIVE' } });
      }

      // The trade side. The deadline is off in this league on purpose (see the
      // settings above), which is the only thing that makes OFFSEASON reachable.
      {
        const from = teams[5];
        const to = teams[6];
        const man = subject.get(from.id)!;
        await putContract(man.id, from.id, { apy: 12_000_000, years: 4, bonusPct: 0.5, voidYears: 0, played: 1, seasonYear });
        const before = await prisma.contract.findUniqueOrThrow({ where: { playerId: man.id } });
        const owed = unamortizedBonus(before, 'REALISTIC');
        const idsBefore = new Set((await charges(from.id)).map((c) => c.id));
        await executeTrade({
          leagueId, teamA: from.id, teamB: to.id,
          aToB: [{ type: 'PLAYER', id: man.id }], bToA: [],
          seasonYear, week, force: true,
        });
        const booked = (await charges(from.id)).filter((c) => !idsBefore.has(c.id));
        present(`${phase} trade CapCharge.year`, booked[0]?.year);
        ok('M-8 a trade files in the book year',
          owed > 0 && booked.length === 1 && booked[0].year === want,
          `${phase} wk${week}: ${M(owed)} filed [${booked.map((c) => c.year).join(', ')}], expected ${want}`);
        ok('M-8 a trade files nothing in the other year',
          booked.every((c) => c.year !== other),
          `${phase} wk${week}: a charge landed in ${other}`);
      }
    }
    await prisma.league.update({ where: { id: leagueId }, data: { phase: league0.phase, week: league0.week } });

    // =====================================================================
    // SELF-TEST — can this file report a failure at all?
    //
    // A harness whose assertions cannot fire is worse than no harness: it is a
    // green tick over untested code. `ok()` is pointed at a statement that is
    // knowingly false, then at the undefined-vs-undefined trap that reports a
    // pass while testing nothing, and `present()` at a column that does not
    // exist. Exactly two failures must come out of the three.
    // =====================================================================
    {
      const before = failures;
      // Through variables, not literals: tsc rejects `1_000_000 === 2_000_000`
      // outright, and a claim the compiler can fold is not a check.
      const oneMillion: number = 1_000_000;
      const twoMillion: number = 2_000_000;
      ok('SELF-TEST', oneMillion === twoMillion, 'a knowingly false claim — this line must appear');
      const row = { amount: 1 } as { amount: number; ammount?: number };
      ok('SELF-TEST undefined vs undefined', row.ammount === (undefined as never), 'reads a field that does not exist and passes');
      present('SELF-TEST CapCharge.ammount (misspelled on purpose)', row.ammount);
      const produced = failures - before;
      if (produced !== 2) {
        console.log(`  FAIL SELF-TEST  the harness produced ${produced} failures on two deliberately broken checks — its assertions do not fire`);
        failures = before + 99;
      } else {
        console.log(`  SELF-TEST: two deliberately broken checks reported ${produced} failures, as they must.`);
        failures = before;
        checks -= 3;
        shown.delete('SELF-TEST');
      }
    }

    // A sweep that skipped most of itself is a pass that means nothing.
    ok('the sweep actually swept', traded >= 100 && released >= 30 && stepsRun >= 80,
      `${traded} trades, ${released} releases, ${stepsRun} composed mutations`);
  } finally {
    if (leagueId) {
      // By collected id, never by name — the development database is shared and
      // holds real saves. CapCharge cascades from Team now, but it is swept
      // explicitly and the leftovers counted, because a check that leaks rows
      // into a shared database is one nobody runs twice.
      await prisma.capCharge.deleteMany({ where: { teamId: { in: teamIds } } });
      await prisma.league.delete({ where: { id: leagueId } });
      const leftovers = await prisma.capCharge.count({ where: { teamId: { in: teamIds } } })
        + await prisma.player.count({ where: { leagueId } })
        + await prisma.league.count({ where: { id: leagueId } });
      console.log(`  cleanup: ${leftovers} rows left behind by this run.`);
      if (leftovers > 0) failures++;
    }
    await prisma.$disconnect();
  }

  console.log('');
  console.log(`${checks - failures}/${checks} checks passed.`);
  if (failures > 0) {
    console.log(`${failures} FAILED. Rules hit: ${[...shown.entries()].map(([r, n]) => `${r} x${n}`).join(', ')}`);
    process.exit(1);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
