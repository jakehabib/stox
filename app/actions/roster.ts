'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { assertLeagueOwner, assertTeamOwner, assertPlayerOnUserTeam, assertPlayerInLeague, userTeamId } from '@/lib/owner';
import { actionFailureMessage } from '@/lib/actionError';
import { cutPlayer as cutPlayerLib, extendContract, restructureContract, applyFranchiseTag, fillRosterForTeam, planRosterFill, resolveNegotiationSession, negotiateOffer, fifthYearOptionQuote, exerciseFifthYearOption, declineFifthYearOption, type FillRosterPlan } from '@/lib/freeagency';
import { decideOffer, type DealStructure, type NegotiationOutcome, type NegotiationSession, type Offer } from '@/lib/negotiation';
import { parseSettings } from '@/lib/settings';
import { teamCapSummary } from '@/lib/cap-summary';
import { capHit, deadMoneyOnCut, capSavingsOnCut, formatMoney, unamortizedBonus, guaranteedSalaryOwed, franchiseTagValue, restructureContract as computeRestructure } from '@/lib/cap';
import { franchiseTagBlockReason } from '@/lib/franchiseTag';
import { PHASE_LABELS } from '@/lib/season';
import { autoDepthChart, reconcileDepthChart } from '@/lib/gen/league';
import { readJson, writeJson } from '@/lib/json';
import { AttrMap, positionMove, canChangePositionTo, relatedPositions } from '@/lib/ratings';
import { CAP, canonicalPosition, LEAGUE, Position } from '@/lib/tuning';

/**
 * Releasing a player is a foreseeable failure — he is already gone, somebody
 * clicked twice, a second tab got there first — and this used to let those
 * escape as a raw throw. Neither consumer showed anything: the Re-sign row
 * awaits it with no catch (an unhandled rejection), and CutButton's
 * ActionButton catches, returns to idle and says nothing at all, so the user
 * pressed Release, watched the button reset, and was told nothing. Its
 * neighbours applyFranchiseTagAction and restructureContractAction already
 * return {ok, message}; this now matches them.
 */
export async function cutPlayerAction(leagueId: string, playerId: string): Promise<{ ok: boolean; message: string }> {
  await assertLeagueOwner(leagueId);
  try {
    await assertPlayerOnUserTeam(leagueId, playerId);
    const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
    const settings = parseSettings(league.settings);
    await cutPlayerLib({ leagueId, playerId, capMode: settings.capMode, seasonYear: league.seasonYear, week: league.week });
  } catch (err) {
    // Two clicks on Release raced each other and the loser came back holding a
    // Prisma stack — `Invalid \`tx.contract.delete()\` invocation in
    // /home/…/lib/freeagency.ts … Record to delete does not exist.` — rendered
    // verbatim in the confirmation the GM reads. A refusal has to name what
    // blocked it in the game's own words, so a database-level failure is
    // answered here rather than repeated.
    return { ok: false, message: actionFailureMessage(err, 'He is not on the roster any more — that release has already gone through. Reload the page.') };
  }
  revalidatePath(`/league/${leagueId}`, 'layout');
  return { ok: true, message: 'Released.' };
}

export interface CutImpact {
  /** False in OFF mode — the UI then shows no dollar figures at all. */
  capEnabled: boolean;
  playerName: string;
  /** This year's cap hit that goes away. */
  currentHit: number;
  /** Everything that stays on the books: `deadBonus` + `deadGuaranteedSalary`. */
  deadMoney: number;
  /** Signing bonus already paid, whose remaining proration accelerates onto this year. */
  deadBonus: number;
  /** Base salary the club guaranteed him and still owes for seasons he will not play. */
  deadGuaranteedSalary: number;
  /** currentHit - deadMoney. NEGATIVE means the release costs you cap space. */
  savings: number;
  capSpaceBefore: number;
  capSpaceAfter: number;
  /** Release leaves the team over the ceiling. */
  leavesOverCap: boolean;
  /** Dead money exceeds the hit — the "restructured, now trapped" shape. */
  costsMoreThanKeeping: boolean;
}

/**
 * What releasing this player actually does, for the confirm step.
 *
 * A cut is the one move whose real cost is invisible at the point of
 * decision. In REALISTIC mode two separate bills land on THIS year's cap the
 * moment he's gone: every remaining dollar of prorated signing bonus (void
 * years included) accelerates, and any base salary the club guaranteed him
 * still has to be paid for seasons he will not play. Either one alone can
 * make a contract cost more to release than to keep, so both are returned
 * under their own names — the confirm step says which is doing the damage
 * rather than blaming the bonus for a bill the guarantee ran up.
 */
export async function cutImpactAction(leagueId: string, playerId: string): Promise<CutImpact> {
  await assertLeagueOwner(leagueId);
  // The league check proves the SAVE is yours; it says nothing about the id
  // that followed. Without this line the panel looked the player up by primary
  // key alone and answered for anybody in the database — measured, a stranger's
  // save came back by name with his cap hit, his dead money and his club's
  // remaining cap space. See assertPlayerInLeague in lib/owner.ts.
  await assertPlayerInLeague(leagueId, playerId);
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const settings = parseSettings(league.settings);
  const player = await prisma.player.findUniqueOrThrow({ where: { id: playerId }, include: { contract: true } });
  const name = `${player.firstName} ${player.lastName}`;

  if (settings.capMode === 'OFF' || !player.contract || !player.teamId) {
    return {
      capEnabled: false, playerName: name, currentHit: 0, deadMoney: 0,
      deadBonus: 0, deadGuaranteedSalary: 0, savings: 0,
      capSpaceBefore: 0, capSpaceAfter: 0, leavesOverCap: false, costsMoreThanKeeping: false,
    };
  }

  const summary = await teamCapSummary(player.teamId, league.seasonYear, settings.capMode);
  const currentHit = capHit(player.contract, settings.capMode);
  const dead = deadMoneyOnCut(player.contract, settings.capMode);
  // The two halves of that same figure, from the same functions it is built
  // from — never re-derived here, or the panel could split a total it does
  // not actually add up to.
  const deadBonus = unamortizedBonus(player.contract, settings.capMode);
  const deadGuaranteedSalary = guaranteedSalaryOwed(player.contract, settings.capMode);
  const savings = capSavingsOnCut(player.contract, settings.capMode);
  const after = summary.capSpace + savings;

  return {
    capEnabled: true,
    playerName: name,
    currentHit,
    deadMoney: dead,
    deadBonus,
    deadGuaranteedSalary,
    savings,
    capSpaceBefore: summary.capSpace,
    capSpaceAfter: after,
    leavesOverCap: after < 0,
    costsMoreThanKeeping: dead > currentHit,
  };
}

/**
 * ===========================================================================
 * FILL ROSTER, IN TWO STEPS
 * ===========================================================================
 * It was one step, and the playtest audit and the pre-launch review both filed
 * the same complaint about it: *"One curiosity click deletes 80% of a new
 * player's cap in 3 seconds with no undo"* (docs/playtest-audit.md, Tier 1) and
 * *"`components/FillRosterButton.tsx` has no dialog, no preview, no undo —
 * `run()` calls the server action directly … Fill Roster shows who and for how
 * much before it commits"* (docs/prelaunch-design-review.md §9).
 *
 * So: `previewFillRosterAction` decides and prices without writing, and
 * `fillRosterAction` re-decides and writes. The commit deliberately does NOT
 * accept the plan it was shown — see fillRosterForTeam — so the sheet is a
 * courtesy to the user rather than a thing the server trusts.
 *
 * BOTH CHECK THE TEAM, not just the league. This took a `teamId` off the wire
 * and filled whatever roster it named, on the strength of owning some team in
 * that league; `assertTeamOwner` is the same guard its neighbours in this file
 * already use.
 * ===========================================================================
 */
export async function previewFillRosterAction(leagueId: string, teamId: string): Promise<FillRosterPlan> {
  await assertLeagueOwner(leagueId);
  await assertTeamOwner(teamId);
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const settings = parseSettings(league.settings);
  return planRosterFill({ leagueId, teamId, seasonYear: league.seasonYear, settings });
}

export async function fillRosterAction(leagueId: string, teamId: string) {
  await assertLeagueOwner(leagueId);
  await assertTeamOwner(teamId);
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const settings = parseSettings(league.settings);
  const result = await fillRosterForTeam({ leagueId, teamId, seasonYear: league.seasonYear, week: league.week, settings });
  revalidatePath(`/league/${leagueId}`, 'layout');
  return result;
}

/**
 * Open contract talks. Resolves the hidden half of the negotiation —
 * personality, reservation price, patience, who else is bidding, how much cap
 * room the deal has to fit inside — ONCE, so the client can re-run
 * `decideOffer` on every drag of a slider without a request per pixel.
 *
 * Nothing secret leaks: the reservation price is in the payload because the
 * meter is computed from it, but the panel never renders it. Hiding it from
 * the client entirely would mean a server round trip per frame, which is the
 * one thing that would kill the feel this feature exists for.
 */
export async function openNegotiationAction(
  leagueId: string, playerId: string, _teamId: string,
): Promise<NegotiationSession> {
  await assertLeagueOwner(leagueId);
  // WHICH CLUB IS SIGNING HIM IS NOT THE CLIENT'S TO SAY. This took a teamId
  // off the wire and opened talks on behalf of whatever club it named. The
  // parameter is kept so the call sites don't change, and ignored.
  const teamId = await userTeamId(leagueId);
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const settings = parseSettings(league.settings);
  return resolveNegotiationSession({
    leagueId, playerId, teamId, seasonYear: league.seasonYear, settings, incumbent: false,
  });
}

/**
 * Put an offer on the table for real.
 *
 * The client already knows what this will say — it ran the same
 * `decideOffer` to draw the meter. It is re-run here anyway, against a
 * session re-resolved from the database, because a client-computed acceptance
 * is not evidence of anything.
 *
 * Note what is NOT in this signature: how much patience the user has spent.
 * It used to be an argument, and a reload set it back to zero, which handed
 * anyone with an F5 key an unlimited supply of lowballs. The count now lives
 * in the database and the server reads it for itself (see negotiateOffer);
 * there is deliberately no parameter here for a client to get wrong or to lie
 * about.
 */
export async function submitOfferAction(
  leagueId: string, playerId: string, _teamId: string,
  offer: Offer, structure: DealStructure, fingerprint: string,
): Promise<NegotiationOutcome> {
  await assertLeagueOwner(leagueId);
  // Derived, never accepted — see openNegotiationAction above.
  const teamId = await userTeamId(leagueId);
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const settings = parseSettings(league.settings);
  const outcome = await negotiateOffer({
    leagueId, playerId, teamId, seasonYear: league.seasonYear, week: league.week,
    settings, incumbent: false, offer, structure, fingerprint,
  });
  // A SIGNING REVALIDATES, like every other roster move in this file.
  //
  // It did not, for a long time, and the reason was real: a Server Action that
  // revalidates hands the client a fresh RSC payload for the current route as
  // part of its own response, and this action is called from the free agent's
  // own player card, which is gated on `player.status === 'FREE_AGENT'`. The
  // instant the deal closes that gate is false, `SignOfferForm` unmounts, and
  // the signing confirmation used to be rendered inside it — so the card the
  // app owner asked for died in the same frame as the answer arrived.
  //
  // The card is not in there any more. It is raised into
  // SigningMomentProvider, which sits in app/league/[id]/layout.tsx above the
  // whole page and cannot be unmounted by anything a signing does. That is
  // what frees this line, and this line is what makes the header honest: the
  // lineup-gap and cap banners are LAYOUT components, and Next reuses a cached
  // layout payload across client-side navigations. Without a revalidate here,
  // signing a healthy kicker left "No healthy K" sitting above a depth chart
  // that already read "every starting slot filled" — for as long as the user
  // went on navigating by the nav bar instead of pressing Done. A standing
  // warning that a starting spot has nobody healthy for it must not depend on
  // which control the user happens to press next.
  //
  // ONLY A SIGNING. Losing him to a rival changes the league too, but that
  // outcome is explained by the panel, in place, on the player card — and that
  // panel IS behind the FREE_AGENT gate. Revalidating there would re-render
  // him as another club's player and take the explanation with it, to fix
  // nothing about the user's own roster. The wire and the pool are correct at
  // their next navigation, a second later, after they have read the bad news.
  if (outcome.ok) revalidatePath(`/league/${leagueId}`, 'layout');
  return outcome;
}

/**
 * MID-DEAL EXTENSIONS MOVED, AND THE OLD ENDPOINT IS GONE.
 *
 * `extendContractAction` used to live here: cap check, then sign whatever it
 * was handed, at any number, no argument. It was the last rubber stamp in the
 * game — free agency and the re-sign window had run through `decideOffer` for
 * a while, and extending your own player, which is most of a GM's job, had no
 * negotiation on it at all.
 *
 * It is `app/actions/extension.ts` now, on the same evaluator as the other
 * two. The old function is DELETED rather than left unused, deliberately: a
 * Server Action is a POST endpoint whether or not any button still points at
 * it, so leaving it here would have left a live route that signs contracts
 * without a meter, a patience charge, or a refusal. Moving the UI off it and
 * leaving it exported would have closed the door and left the window open.
 */

export interface FranchiseTagImpact {
  /** False in OFF mode — the preview then shows no dollar figures at all, exactly as CutImpact does. */
  capEnabled: boolean;
  playerName: string;
  position: string;
  /** The league year the tag would be signed in, so the preview can date its own rows. */
  seasonYear: number;
  /** The 1-year, fully guaranteed salary the tag pays. `franchiseTagValue`, the function that writes the contract. */
  tagValue: number;
  /** The cap hits that average was taken over, biggest first — what the number is MADE of. */
  topSalaries: number[];
  /** What he counts against this year's cap on the deal the tag replaces, and which comes back off. */
  currentHit: number;
  /** Signing bonus from that old deal which has not finished amortising and accelerates the moment the tag is signed. */
  deadMoney: number;
  /** tagValue + deadMoney - currentHit. What the move really costs this year's books. */
  netCost: number;
  capSpaceBefore: number;
  capSpaceAfter: number;
  /** The tag would leave the club over the ceiling — which is also what the server would refuse on. */
  leavesOverCap: boolean;
  /** Non-null when the tag cannot be applied at all; the same sentence the greyed control carries. */
  blocked: string | null;
}

/**
 * ===========================================================================
 * WHAT THE TAG WOULD DO, BEFORE IT IS SIGNED
 * ===========================================================================
 * The app owner, on the third pass over this control: *"clicking it should
 * show the cap implications just like a regular contract would and ask to
 * confirm instead of just 1-clicking into it"*. He is right, and the tag had
 * become the worst place in the game to be missing that: since it started
 * booking the old deal's unamortised bonus (applyFranchiseTag, INV-21) the
 * number on the button is no longer the number on the bill.
 *
 * So this is `cutImpactAction` for the tag, and it is deliberately built the
 * same way: resolved by the server when the confirm step opens, from the exact
 * functions the commit path uses — `franchiseTagValue` over the same position
 * rows, `unamortizedBonus` for the acceleration, `teamCapSummary` for the
 * room. A preview that quotes a figure the action does not charge is the
 * lying-metric bug this codebase treats as a class rather than a slip, and on
 * a once-a-year irreversible move it is the worst possible place for one.
 *
 * `capSpaceAfter` is the gate's own arithmetic, not a second opinion:
 * `assertCapRoom` is handed `delta: tagValue + accelerated` against
 * `creditBack: oldHit`, so the room after is the room now, plus the hit that
 * comes off, minus both halves of what goes on.
 *
 * It also returns `blocked`, from the shared rule (lib/franchiseTag.ts). The
 * button that opened this panel was greyed or not by a page render that may be
 * a navigation old — a tag used in another tab since then must not be found
 * out at the press.
 * ===========================================================================
 */
export async function franchiseTagImpactAction(leagueId: string, playerId: string): Promise<FranchiseTagImpact> {
  await assertLeagueOwner(leagueId);
  // Same reason as cutImpactAction: this preview reads a contract and a club's
  // cap sheet, and it was reading whichever ones the id named.
  await assertPlayerInLeague(leagueId, playerId);
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const settings = parseSettings(league.settings);
  const player = await prisma.player.findUniqueOrThrow({ where: { id: playerId }, include: { contract: true } });
  const name = `${player.firstName} ${player.lastName}`;

  const heldContract = player.teamId
    ? await prisma.contract.findFirst({
      where: { teamId: player.teamId, isFranchiseTag: true, signedYear: league.seasonYear, NOT: { playerId } },
      include: { player: { select: { lastName: true, position: true } } },
    })
    : null;
  const blocked = franchiseTagBlockReason({
    enabled: settings.franchiseTagEnabled,
    phase: league.phase,
    phaseLabel: PHASE_LABELS[league.phase] ?? league.phase,
    yearsRemaining: player.contract?.yearsRemaining ?? 0,
    heldBy: heldContract ? { position: heldContract.player.position, lastName: heldContract.player.lastName } : null,
  });

  // Priced even in OFF and SIMPLIFIED, because the tag's SALARY is a real
  // number in every mode — it is only the cap consequences that stop existing.
  const peers = await prisma.player.findMany({
    where: { leagueId, position: player.position, status: 'ACTIVE' },
    include: { contract: true },
  });
  const salaries = peers.map((p) => capHit(p.contract, settings.capMode)).filter((v) => v > 0).sort((a, b) => b - a);
  const tagValue = franchiseTagValue(salaries);

  if (settings.capMode === 'OFF' || !player.contract || !player.teamId) {
    return {
      capEnabled: false, playerName: name, position: player.position, seasonYear: league.seasonYear,
      tagValue, topSalaries: salaries.slice(0, 5),
      currentHit: 0, deadMoney: 0, netCost: 0, capSpaceBefore: 0, capSpaceAfter: 0, leavesOverCap: false, blocked,
    };
  }

  const summary = await teamCapSummary(player.teamId, league.seasonYear, settings.capMode);
  const currentHit = capHit(player.contract, settings.capMode);
  const deadMoney = unamortizedBonus(player.contract, settings.capMode);
  const netCost = tagValue + deadMoney - currentHit;
  const after = summary.capSpace - netCost;

  return {
    capEnabled: true,
    playerName: name,
    position: player.position,
    seasonYear: league.seasonYear,
    tagValue,
    topSalaries: salaries.slice(0, 5),
    currentHit,
    deadMoney,
    netCost,
    capSpaceBefore: summary.capSpace,
    capSpaceAfter: after,
    leavesOverCap: after < 0,
    blocked,
  };
}

export async function applyFranchiseTagAction(leagueId: string, playerId: string) {
  await assertLeagueOwner(leagueId);
  try { await assertPlayerOnUserTeam(leagueId, playerId); }
  catch (err) { return { ok: false, message: err instanceof Error ? err.message : 'Not your player.' }; }
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const settings = parseSettings(league.settings);
  if (!settings.franchiseTagEnabled) return { ok: false, message: 'Franchise tags are disabled in league settings.' };
  if (league.phase !== 'RESIGN') return { ok: false, message: 'The franchise tag can only be used during the Re-sign window.' };
  /*
   * A TAG REPLACES A DEAL THAT IS UP — and nothing said so on this side.
   *
   * The re-sign row has always gated its button on `yearsRemaining === 0`, and
   * the player card now says the same thing in words where the control would
   * be. This is a POST endpoint, so a UI rule it does not share is not a rule:
   * handed a man with three years to run it would have torn up his contract
   * and written a one-year tag over it, which is a way to walk out of a long
   * deal that no other path in the game offers. `applyFranchiseTag` prices
   * that case correctly, but pricing a move is not permitting it.
   */
  const contract = await prisma.contract.findUnique({
    where: { playerId }, select: { yearsRemaining: true },
  });
  if (!contract) return { ok: false, message: 'He has no contract for the tag to replace.' };
  if (contract.yearsRemaining !== 0) {
    return {
      ok: false,
      message: `The tag is for a man whose deal is up. His has ${contract.yearsRemaining} season${contract.yearsRemaining === 1 ? '' : 's'} still to run.`,
    };
  }
  try {
    const result = await applyFranchiseTag({ leagueId, playerId, seasonYear: league.seasonYear, capMode: settings.capMode, week: league.week });
    revalidatePath(`/league/${leagueId}`, 'layout');
    // BOTH HALVES OF WHAT IT COST. The tag number was the whole message while
    // the old deal's unamortised bonus quietly evaporated; it is charged now
    // (applyFranchiseTag, INV-21's second clause) and a confirmation that
    // names only the cheaper half of a bill is a lying metric. The Re-sign row
    // already warns before the press — this is the receipt.
    return {
      ok: true,
      message: `Tagged — 1-yr, fully guaranteed at ${formatMoney(result.tagValue)}.`
        + (result.deadMoney > 0
          ? ` His old deal's remaining ${formatMoney(result.deadMoney)} of signing bonus accelerates onto this year's cap as dead money.`
          : ''),
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Franchise tag failed.' };
  }
}

/**
 * ===========================================================================
 * THE FIFTH-YEAR OPTION — THE PRICE BEFORE THE PRESS, AND THE TWO ANSWERS
 * ===========================================================================
 * `franchiseTagImpactAction` for the option, and built the same way for the
 * same reason: the preview is resolved by the server from the exact functions
 * the commit path writes with (`fifthYearOptionQuote`, lib/freeagency.ts), so
 * it cannot quote a figure the action does not charge. The tag learned that
 * the hard way — the number on its button stopped being the number on its bill
 * the day it started booking the old deal's bonus.
 *
 * There is deliberately no second computation in this file. The tag's impact
 * action re-derives its figures here because it predates having one place to
 * ask; this one asks once, and the AI wave (`decideFifthYearOptions`,
 * lib/season.ts) asks the same function. Three callers, one price.
 */
export type FifthYearOptionImpact = Awaited<ReturnType<typeof fifthYearOptionQuote>>;

export async function fifthYearOptionImpactAction(leagueId: string, playerId: string): Promise<FifthYearOptionImpact> {
  await assertLeagueOwner(leagueId);
  // `fifthYearOptionQuote` looks the player up by primary key and prices him
  // against THIS league's settings, so a foreign first-rounder would come back
  // fully quoted. The membership check belongs on this side of the call.
  await assertPlayerInLeague(leagueId, playerId);
  return fifthYearOptionQuote({ leagueId, playerId });
}

/**
 * Answer it. One action for both directions, because they are one decision and
 * a GM who could reach only half of it would be looking at a control that can
 * say yes and not no.
 *
 * THE GUARDS ARE HERE AND NOT ONLY IN THE UI. A Server Action is a POST
 * endpoint whether or not a button points at it, and this one appends a
 * guaranteed year to a contract. Ownership, then the library's own gate — which
 * is `fifthYearOptionQuote`'s `blocked`, the same sentence the greyed control
 * carries and in the same order — then the conditional write that makes a
 * double click impossible (`updateMany ... where fifthYearOption: null`).
 */
export async function fifthYearOptionAction(
  leagueId: string, playerId: string, decision: 'EXERCISE' | 'DECLINE',
): Promise<{ ok: boolean; message: string }> {
  await assertLeagueOwner(leagueId);
  // A TYPE IS NOT A CHECK. `decision` is typed as a two-value union and
  // arrives over the wire as whatever the caller sent; the branch below is
  // `=== 'EXERCISE'` with an else, so every string in the world that is not
  // exactly EXERCISE used to DECLINE the option — a once-per-career, one-way
  // door answered by a typo. Whitelisted, like the settings enums.
  if (decision !== 'EXERCISE' && decision !== 'DECLINE') {
    return { ok: false, message: 'That is not an answer to the option — it is picked up or turned down.' };
  }
  try { await assertPlayerOnUserTeam(leagueId, playerId); }
  catch (err) { return { ok: false, message: err instanceof Error ? err.message : 'Not your player.' }; }
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const settings = parseSettings(league.settings);
  try {
    if (decision === 'EXERCISE') {
      const r = await exerciseFifthYearOption({
        leagueId, playerId, seasonYear: league.seasonYear, capMode: settings.capMode, week: league.week,
      });
      revalidatePath(`/league/${leagueId}`, 'layout');
      return {
        ok: true,
        // The receipt names the year AND the guarantee, because the guarantee is
        // the half that costs money later: cutting him after this owes it.
        message: `Option picked up — he is under contract through ${r.optionYear} at ${formatMoney(r.optionSalary)}, fully guaranteed.`,
      };
    }
    const r = await declineFifthYearOption({ leagueId, playerId, seasonYear: league.seasonYear, week: league.week });
    revalidatePath(`/league/${leagueId}`, 'layout');
    return {
      ok: true,
      message: `Option turned down — you save ${formatMoney(r.optionSalary)} and he is a free agent when this deal runs out.`,
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'That option could not be answered.' };
  }
}

/**
 * ===========================================================================
 * RESTRUCTURE, AND THE TWO THINGS THE REBASE MADE THIS ACTION RESPONSIBLE FOR
 * ===========================================================================
 * A restructure rewrites the contract onto the years that are LEFT and carries
 * the UNAMORTISED signing bonus across (lib/cap.ts `restructureContract`, and
 * the block over it for why carrying the whole bonus billed the same money
 * twice). Two consequences land here rather than in the math.
 *
 * 1. A CONVERSION OF NOTHING IS NOT A RESTRUCTURE. No year of a deal may pay
 *    below the league minimum, so a request is clamped to the room above that
 *    floor and can come back as zero. The library refuses a request "too small
 *    to change anything" by checking whether the signing bonus moved — a test
 *    that only worked while the bonus was carried whole. The rebase moves it on
 *    its own now (a zero-dollar restructure drops it to the unamortised
 *    figure), so that test would wave through a move that converts nothing,
 *    write a rebased row and report cap relief that did not happen. The pure
 *    function reports what it actually converted; this refuses on that.
 *
 * 2. `guaranteed` USED TO BE RESTATED HERE, AND NO LONGER IS. It is stored
 *    bonus-inclusive, and everything that reads it subtracts the bonus back
 *    out to find the guaranteed BASE salary still owed (lib/cap.ts
 *    `guaranteedBaseByYear`), so a rebased bonus stored beside the OLD
 *    guarantee re-reads as salary the club still owes. The library dropped it
 *    from its write and this action patched it back in a SECOND write,
 *    outside the library's transaction — which fixed the symptom for the one
 *    caller that existed and left the defect fully armed for the next one, on
 *    top of a window where a failure between the two writes left a broken row
 *    behind. `restructureContract` writes it inside its own transaction now,
 *    from the same shaped figure, and the patch is gone.
 * ===========================================================================
 */
export async function restructureContractAction(leagueId: string, playerId: string, convertAmount: number, addVoidYears: number) {
  await assertLeagueOwner(leagueId);
  /*
   * THE TWO NUMBERS ARE CHECKED BEFORE THEY REACH THE MATH.
   *
   * Both arrive over the wire, and `NaN` went all the way through
   * `computeRestructure` to a Prisma write that reported `guaranteed: NaN,
   * signingBonus: Int is missing` — a database validation dump, absolute file
   * paths and all, returned as the sentence on the GM's screen. Infinity and a
   * negative conversion took the "nothing to convert" path by accident rather
   * than by rule, and a void-year count of 9,999 is not a contract.
   *
   * The ceiling is read off CAP.MAX_PRORATION_YEARS rather than typed here, so
   * it cannot drift from the number the proration math actually honours — a
   * bonus spreads over at most that many years however many void ones are
   * bolted on (lib/cap.ts, prorationYears). The slider on the panel stops
   * lower still; the point is that the rule is here, where the write is, and
   * not only on the control.
   */
  const VOID_YEARS_MAX = CAP.MAX_PRORATION_YEARS;
  if (!Number.isFinite(convertAmount) || convertAmount < 0) {
    return { ok: false, message: 'That is not an amount of money to convert.' };
  }
  if (!Number.isFinite(addVoidYears) || addVoidYears < 0 || addVoidYears > VOID_YEARS_MAX || !Number.isInteger(addVoidYears)) {
    return { ok: false, message: `Void years run from none to ${VOID_YEARS_MAX}.` };
  }
  try { await assertPlayerOnUserTeam(leagueId, playerId); }
  catch (err) { return { ok: false, message: err instanceof Error ? err.message : 'Not your player.' }; }
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const settings = parseSettings(league.settings);
  try {
    const before = await prisma.contract.findUnique({ where: { playerId } });
    // The same call, on the same row, with the same arguments the library is
    // about to make — so the figure refused on and the figure stored can never
    // be a different restructure from the one that actually ran.
    const shaped = before
      ? computeRestructure(before, convertAmount, { addVoidYears, nowYear: league.seasonYear })
      : null;
    if (shaped && shaped.converted <= 0) {
      return {
        ok: false,
        message: 'There is nothing to convert — his base salary this year is already at the league minimum, and no deal may pay below it.',
      };
    }

    const result = await restructureContract({
      leagueId, playerId, convertAmount, addVoidYears, seasonYear: league.seasonYear, capMode: settings.capMode, week: league.week,
    });
    revalidatePath(`/league/${leagueId}`, 'layout');
    return { ok: true, message: `Restructured — new cap hit this year: $${(result.newCapHit / 1_000_000).toFixed(2)}M.` };
  } catch (err) {
    return { ok: false, message: actionFailureMessage(err, 'That restructure could not be written — his deal changed underneath it. Reload the page.') };
  }
}

/**
 * ===========================================================================
 * MOVE A MAN TO A NEW POSITION
 * ===========================================================================
 * The app owner's hole, in his words: *"if someone has two solid RT and a
 * weak LT, they can't swap the spare RT over. we need to have that
 * functionality somehow being elegant"* — and his own answer to it: *"what if
 * we just allow you to change a player's position in the player card? so you
 * can make a new RT or LT as you need, and we don't have any wonkiness with
 * other tools."*
 *
 * He is right, and the reason it is this short is that nothing here invents a
 * penalty. `positionMove` (lib/ratings.ts) re-weights his attributes through
 * the new position's formula, which is what an overall already IS. The cost
 * of the move is the number that comes out, and it is the same number the
 * card previewed before the click — the preview and this write call the same
 * function, so they cannot disagree (README principle 6).
 *
 * WHY THIS NEEDS NO DEPTH-CHART SPECIAL CASE. `reconcileDepthChart` drops any
 * slot whose position no longer matches the player's — *"Trust the roster's
 * position, not the slot's: a slot written before a position change would
 * otherwise file him under the old one."* That line was written for exactly
 * this event and had never been reached, because nothing in the game changed
 * a position. It is now doing its real job: his old slot goes, and he is
 * placed at the new position on merit by the same insertion rule the sim,
 * the free-agency comparison and the chart itself all use. No new opinion
 * about who plays, and no schema change.
 *
 * NOT GATED, COOLED DOWN OR CHARGED FOR, deliberately. The rating drop is the
 * cost and it is an honest one; a camp-time gate or a once-per-season limit
 * would be invented friction on top of a mechanic that already prices itself.
 * What it is NOT is silent: it goes on the wire as a POSITION transaction
 * linked to the man, because a front office moving a tackle inside is a real
 * decision and this world is supposed to have a legible past (principle 0).
 */
export async function changePositionAction(leagueId: string, playerId: string, newPosition: string) {
  await assertLeagueOwner(leagueId);
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const player = await prisma.player.findUniqueOrThrow({
    where: { id: playerId },
    include: { team: true },
  });

  // Your own men only. A free agent is not yours to reassign, an opponent's
  // player obviously is not, and a draft prospect's position is what your
  // scouts filed him under — moving him would be editing a scouting report,
  // not making a coaching decision.
  if (!player.teamId || player.leagueId !== leagueId) return { ok: false as const, message: 'He is not on your roster.' };
  await assertTeamOwner(player.teamId);
  if (player.isDraftee) return { ok: false as const, message: 'Draft prospects keep the position they were scouted at.' };

  const from = canonicalPosition(player.position);
  const to = canonicalPosition(newPosition);
  if (from === to) return { ok: false as const, message: `He already plays ${to}.` };
  // Re-checked here rather than trusted from the client: a Server Action is a
  // POST endpoint, and the menu that hid `P` from a quarterback's card is a
  // rendering decision, not a security boundary. A move the engine cannot
  // price honestly (see RELATED_POSITIONS) must not be reachable by hand.
  if (!canChangePositionTo(from, to)) {
    const offered = relatedPositions(from);
    return {
      ok: false as const,
      message: offered.length === 0
        ? `A ${from} has no position to move to.`
        : `A ${from} can only move to ${offered.join(', ')}.`,
    };
  }

  const move = positionMove(
    { position: from, trueOvr: player.trueOvr, trueAttrs: readJson<AttrMap>(player.trueAttrs, {}), potential: player.potential },
    to as Position,
  );

  await prisma.$transaction(async (tx) => {
    await tx.player.update({
      where: { id: player.id },
      // `potential` travels with the rating, by the same signed delta — see
      // THE CEILING MOVES WITH THE FLOOR in lib/ratings.ts. It used to be
      // deliberately untouched, on the reading that a ceiling belongs to the
      // man rather than the job; measured, that refunded most of the move.
      // The trade market prices a blend of rating and ceiling, so leaving the
      // ceiling put handed back ~63% of the charge immediately, and
      // progressPlayer — which uses `potential` as an attractor over the NEW
      // position's attributes — handed back the rest within a couple of
      // seasons. His RUNWAY (potential - trueOvr) is untouched, so a young
      // man still has exactly as much growth left as he did.
      data: { position: to, trueAttrs: writeJson(move.attrs), trueOvr: move.ovr, potential: move.potential },
    });
    // His old slot is now stale by the roster's own reckoning and reconcile
    // drops it; he is re-placed at his new position in the same call.
    await reconcileDepthChart(player.teamId!, tx);
    await tx.transaction.create({
      data: {
        leagueId,
        seasonYear: league.seasonYear,
        week: league.week,
        type: 'POSITION',
        teamId: player.teamId,
        playerId: player.id,
        headline: `${player.firstName} ${player.lastName} moves from ${from} to ${to}`,
        detail: `${player.team?.city ?? ''} ${player.team?.nickname ?? ''}`.trim()
          + ` — ${player.trueOvr} OVR at ${from}, ${move.ovr} at ${to}.`
          + (move.potentialDelta ? ` Ceiling ${player.potential} to ${move.potential}.` : '')
          + (move.learned.length > 0 ? ` New to the job: ${move.learned.length} untested trait${move.learned.length === 1 ? '' : 's'}.` : ''),
      },
    });
  });

  revalidatePath(`/league/${leagueId}`, 'layout');
  return {
    ok: true as const,
    message: `${player.lastName} is a ${to} — ${move.ovr} OVR (${move.delta >= 0 ? '+' : ''}${move.delta}).`,
    ovr: move.ovr,
    delta: move.delta,
  };
}

/**
 * ===========================================================================
 * ONE POSITION'S ORDER, AND NOTHING ELSE THE REQUEST FANCIES
 * ===========================================================================
 * `assertTeamOwner` proves the CLUB is yours. Everything after it used to be
 * copied out of the request and into the table, which made this the loosest
 * write in the file. Measured, from a save the caller legitimately owned:
 *
 *   - a slot was written at position `NOT_A_POSITION`, which no reader has a
 *     name for, and one at a ten-megabyte position string;
 *   - one man sent 200 times produced 200 slots for one player at one
 *     position, off a single call;
 *   - a player id belonging to ANOTHER SAVE was accepted, so a depth chart
 *     row pointed across the league boundary at somebody else's roster;
 *   - an id of the wrong shape escaped as a raw `Foreign key constraint
 *     violated: DepthChartSlot_playerId_fkey` throw.
 *
 * The chart is a rendering of the roster, so the rules are the roster's: men
 * who are actually on this club, each of them once, each filed at the position
 * being ordered, and no more of them than a roster holds.
 * `reconcileDepthChart` already drops a slot whose position no longer matches
 * its player — this stops one being written that way in the first place.
 *
 * IT STILL RETURNS void AND STILL REFUSES SILENTLY. The editor fires this
 * inside a transition and reads no result, and none of the refusals above is
 * reachable by dragging a card — they are all shapes only a hand-rolled
 * request produces. A rejected write leaves the stored order exactly as it
 * was, which is what the screen will show on its next render.
 * ===========================================================================
 */
export async function setDepthChartAction(teamId: string, position: string, orderedPlayerIds: string[]) {
  await assertTeamOwner(teamId);
  // Bounded before it reaches a query — a ten-megabyte "position" is not one,
  // and there is no reason to hand the database a string that size to match on.
  if (typeof position !== 'string' || position.length === 0 || position.length > 8) return;
  if (!Array.isArray(orderedPlayerIds)) return;

  const team = await prisma.team.findUniqueOrThrow({ where: { id: teamId }, select: { id: true, leagueId: true } });
  // A repeated man, or more men than a roster holds, is not an order this club
  // could be in — so it is refused whole rather than quietly deduplicated into
  // some other order the GM did not ask for. The cap is what stops the length
  // of the array deciding how many rows this writes.
  const wanted = orderedPlayerIds;
  if (wanted.length > LEAGUE.ROSTER_MAX) return;
  if (wanted.some((id) => typeof id !== 'string')) return;
  if (new Set(wanted).size !== wanted.length) return;

  const onRoster = await prisma.player.findMany({
    where: { id: { in: wanted }, teamId, leagueId: team.leagueId },
    select: { id: true, position: true },
  });
  const byId = new Map(onRoster.map((p) => [p.id, p]));
  // Every man named has to be on THIS club and to be filed at THIS position —
  // the same comparison `reconcileDepthChart` makes when it decides a stored
  // slot is stale (`p.position !== slot.position`), so the two can never
  // disagree about what a valid row looks like. It is also what makes the
  // bucket name safe without a whitelist: a position no player on the roster
  // is filed under cannot get a row written at it.
  //
  // A partial write would silently drop whoever failed and reorder the rest,
  // which is a chart the GM did not ask for; refuse the whole thing instead.
  if (wanted.some((id) => byId.get(id)?.position !== position)) return;

  await prisma.$transaction([
    prisma.depthChartSlot.deleteMany({ where: { teamId, position } }),
    prisma.depthChartSlot.createMany({
      data: wanted.map((playerId, rank) => ({ teamId, playerId, position, rank })),
    }),
  ]);
  revalidatePath(`/league/${team.leagueId}/depth-chart`);
}

export async function autoSortDepthChartAction(teamId: string) {
  await assertTeamOwner(teamId);
  await autoDepthChart(teamId);
  const team = await prisma.team.findUniqueOrThrow({ where: { id: teamId } });
  revalidatePath(`/league/${team.leagueId}/depth-chart`);
}

