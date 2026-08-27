'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { assertLeagueOwner, assertTradeAssetsInLeague, assertTeamInLeague } from '@/lib/owner';
import { evaluateTrade, executeTrade, rankTradePartners, isTradeDeadlinePassed, TradeAsset } from '@/lib/trade';
import { findTradeClosers } from '@/lib/tradeClosers';
import { parseSettings } from '@/lib/settings';
import { readJson } from '@/lib/json';

/**
 * Price a proposal. Read-only, and it runs on every change to the package
 * behind a debounce — so what it must never be is a way to price a package
 * made of somebody else's players.
 *
 * It was. `aiTeamId`, `give` and `get` were passed to `evaluateTrade`
 * unchecked, and it resolves every id by primary key: from a save the caller
 * owned, naming a foreign club and one of its players returned that club's own
 * internal read on the man, in words, with the number beside it. The two
 * guards below are the ones `tradeClosersAction` next door already had.
 */
export async function evaluateTradeAction(leagueId: string, aiTeamId: string, give: TradeAsset[], get: TradeAsset[]) {
  await assertLeagueOwner(leagueId);
  await assertTeamInLeague(leagueId, aiTeamId);
  await Promise.all([assertTradeAssetsInLeague(leagueId, give), assertTradeAssetsInLeague(leagueId, get)]);
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const settings = parseSettings(league.settings);
  return evaluateTrade({ aiTeamId, give, get, currentYear: league.seasonYear, settings: { aiAcceptsLopsided: settings.aiAcceptsLopsided } });
}

/**
 * WHAT WOULD CLOSE IT — the refusal turned into moves the GM can make.
 *
 * Deliberately NOT part of evaluateTradeAction. That one runs on every
 * selection change behind a 350ms debounce and has to stay one evaluation;
 * this one runs a candidate package through the whole engine a dozen or more
 * times, so it is only ever called after an explicit Propose came back
 * declined. See findTradeClosers for the narrowing that keeps that bounded,
 * and for why nothing it returns is an estimate.
 *
 * `userTeamId` is not taken from the client. The user's club in this league
 * is a fact the server already holds, and the closers read that roster to
 * decide what he could add — accepting it as an argument would let a request
 * enumerate somebody else's board.
 */
export async function tradeClosersAction(leagueId: string, aiTeamId: string, give: TradeAsset[], get: TradeAsset[]) {
  await assertLeagueOwner(leagueId);
  await Promise.all([assertTradeAssetsInLeague(leagueId, give), assertTradeAssetsInLeague(leagueId, get)]);
  const [userTeam, partner] = await Promise.all([
    prisma.team.findFirst({ where: { leagueId, isUser: true }, select: { id: true } }),
    prisma.team.findUnique({ where: { id: aiTeamId }, select: { leagueId: true, isUser: true } }),
  ]);
  if (!userTeam || !partner || partner.leagueId !== leagueId || partner.isUser) return null;
  return findTradeClosers({ leagueId, userTeamId: userTeam.id, aiTeamId, give, get });
}

// `ovr` is the rating of the man actually being shopped — see
// rankTradePartners: without it the list can only find clubs with a HOLE at
// the position, never the (far more common) club that simply would be
// upgraded by him.
export async function rankTradePartnersAction(leagueId: string, position: string, excludeTeamId: string, ovr?: number) {
  await assertLeagueOwner(leagueId);
  return rankTradePartners(leagueId, position, excludeTeamId, ovr);
}

export interface TradeActionResult { ok: boolean; message: string }

/**
 * Everything both trade buttons have to satisfy before a deal is written, in
 * one place so the forced path cannot quietly be missing one of them.
 *
 * WHAT `force` DOES AND DOES NOT SKIP. It skips every RULE that can refuse a
 * deal: the other club's willingness (the evaluateTrade gate below), the
 * trade deadline here, and the salary cap and roster limit inside
 * executeTrade. A forced trade goes through.
 *
 * What it does not skip is anything that keeps the save coherent. A club
 * still cannot trade a player it does not own, a retired man, a spent pick or
 * the same asset twice, and every dollar is still booked the ordinary way —
 * bonus accelerating onto the seller, base salary travelling, the charge
 * dated by capChargeYear. Suspending a rule leaves the league in a state the
 * player chose and can see on his own cap sheet; suspending an ownership
 * claim leaves contracts pointing at nobody, which is not an override.
 *
 * It reads as drastic because it is. It exists because a save can reach a
 * state the AI will not trade its way out of, and the only other remedy on
 * offer is releasing good players for nothing.
 *
 * AND THE AUTHORITY FOR "IS FORCING ALLOWED" IS THIS READ, not the request.
 * `force` says which button the browser pressed; `settings.forceTradeEnabled`,
 * re-read from the league row here, says whether that button was allowed to
 * exist. A server action is a public HTTP endpoint, so a flag arriving from
 * the client can only ever ask — it can never be the thing that answers. With
 * the setting off, a hand-rolled request naming forceTradeAction is refused
 * with the AI gate still standing behind it.
 */
async function tradePreflight(opts: {
  leagueId: string; teamA: string; teamB: string; aToB: TradeAsset[]; bToA: TradeAsset[]; force: boolean;
}) {
  const league = await prisma.league.findUniqueOrThrow({ where: { id: opts.leagueId } });
  const settings = parseSettings(league.settings);

  if (opts.force && !settings.forceTradeEnabled) {
    return { ok: false as const, error: 'Forcing a trade is switched off for this league — turn it on in League Settings.' };
  }
  if (!opts.force && settings.tradeDeadlineEnabled && isTradeDeadlinePassed(league.phase, league.week, settings.tradeDeadlineWeek)) {
    return { ok: false as const, error: 'The trade deadline has passed for this league year.' };
  }

  const [a, b] = await Promise.all([
    prisma.team.findUnique({ where: { id: opts.teamA }, select: { leagueId: true, isUser: true } }),
    prisma.team.findUnique({ where: { id: opts.teamB }, select: { leagueId: true, isUser: true } }),
  ]);
  if (!a || !b || a.leagueId !== opts.leagueId || b.leagueId !== opts.leagueId) {
    return { ok: false as const, error: 'That trade names a club from another league.' };
  }
  // Exactly one side must be the user's club. Two AI clubs here would mean
  // the user was arranging a trade between other people's teams — which stays
  // true when he is forcing it, since forcing is an escape hatch for HIS
  // roster, not a licence to rearrange the league.
  if (a.isUser === b.isUser) {
    return { ok: false as const, error: 'A trade has to be between your club and another one.' };
  }

  const [aiTeamId, give, get] = a.isUser ? [opts.teamB, opts.aToB, opts.bToA] : [opts.teamA, opts.bToA, opts.aToB];
  return { ok: true as const, league, settings, aiTeamId, give, get };
}

/** The write itself, identical for both buttons — see tradePreflight. */
async function commitTrade(opts: {
  leagueId: string; teamA: string; teamB: string; aToB: TradeAsset[]; bToA: TradeAsset[];
  seasonYear: number; week: number; message: string; force?: boolean;
}): Promise<TradeActionResult> {
  try {
    await executeTrade({
      leagueId: opts.leagueId, teamA: opts.teamA, teamB: opts.teamB,
      aToB: opts.aToB, bToA: opts.bToA, seasonYear: opts.seasonYear, week: opts.week,
      force: opts.force,
    });
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Trade failed.' };
  }
  revalidatePath(`/league/${opts.leagueId}`, 'layout');
  return { ok: true, message: opts.message };
}

/**
 * A rejected trade — deadline passed, or the salary cap won't take it on one
 * side or the other — is a foreseeable, user-recoverable outcome, not a bug.
 * It comes back as a message rather than escaping the Server Action as an
 * uncaught throw, which in Next blanks the whole page instead of explaining
 * what happened (same reasoning as offerContractAction in roster.ts).
 */
export async function executeTradeAction(
  leagueId: string, teamA: string, teamB: string, aToB: TradeAsset[], bToA: TradeAsset[],
): Promise<TradeActionResult> {
  await assertLeagueOwner(leagueId);
  await Promise.all([assertTradeAssetsInLeague(leagueId, aToB), assertTradeAssetsInLeague(leagueId, bToA)]);
  const pre = await tradePreflight({ leagueId, teamA, teamB, aToB, bToA, force: false });
  if (!pre.ok) return { ok: false, message: pre.error };

  /**
   * THE OTHER CLUB STILL HAS TO SAY YES.
   *
   * This action used to execute whatever it was handed. The AI's verdict was
   * rendered on the trade screen and the Confirm button was disabled until it
   * came back accepted — but that gate lived entirely in the browser, and a
   * server action is a public HTTP endpoint. Anything that reached this
   * function went through, so a request naming a club's best player against
   * nothing at all completed as a trade.
   *
   * NOTE WHAT THIS DOES NOT COVER. It stops a club being robbed, not a club
   * being handed a gift: an offer of a 91 receiver for nothing is one the AI
   * genuinely accepts, so it passes here and should. The partner-switch bug —
   * where a stale ACCEPTED verdict left Confirm live after the user stepped
   * to a different club, sending his players to a club that never saw the
   * offer — is a wrong-intent bug, not a wrong-verdict one, and it is fixed
   * where it lives, in TradeBuilder.
   *
   * Re-asking here is safe because evaluateTrade is deterministic — verified
   * at 50 identical evaluations per deal across the case set, zero flips — so
   * this can never refuse a deal the screen just showed as accepted. It is
   * the same call the screen made, with the same inputs.
   *
   * forceTradeAction below is the ONE door past this, and it is a door the
   * league has to have unlocked in its own settings before it opens.
   */
  const verdict = await evaluateTrade({
    aiTeamId: pre.aiTeamId, give: pre.give, get: pre.get, currentYear: pre.league.seasonYear,
    settings: { aiAcceptsLopsided: pre.settings.aiAcceptsLopsided },
  });
  if (!verdict.accepted) {
    return { ok: false, message: verdict.counter?.message ?? "They aren't interested in that offer." };
  }

  return commitTrade({
    leagueId, teamA, teamB, aToB, bToA,
    seasonYear: pre.league.seasonYear, week: pre.league.week, message: 'Trade completed.',
  });
}

/**
 * THE ESCAPE HATCH: a trade the other club would never agree to, written
 * anyway.
 *
 * It exists because a save can reach a state the AI will not trade its way
 * out of. The one that prompted it: an AI club spent a pick on a sixth
 * quarterback, nobody in the league values a fifth, and no offer at any ratio
 * clears the bar — so the roster stays unplayable and the only other remedy
 * is releasing men for nothing. This moves them instead.
 *
 * It is a SEPARATE action rather than a `force` argument on the one above on
 * purpose. A boolean the client passes to skip a server-side gate is not a
 * setting, it is a hole: whatever the screen sends, the endpoint is public.
 * Which action was called is only a request; tradePreflight re-reads
 * `forceTradeEnabled` off the league row and that read is what decides.
 *
 * With the league's permission, the deal is written whatever it looks like —
 * past the deadline, over the cap, over the roster limit, and against a club
 * that would never have said yes. The ownership claims still hold and the
 * money is still booked in full, so the cap sheet afterwards shows exactly
 * how far over he put himself. See tradePreflight for the full line between
 * the rules this suspends and the integrity it does not.
 */
export async function forceTradeAction(
  leagueId: string, teamA: string, teamB: string, aToB: TradeAsset[], bToA: TradeAsset[],
): Promise<TradeActionResult> {
  await assertLeagueOwner(leagueId);
  await Promise.all([assertTradeAssetsInLeague(leagueId, aToB), assertTradeAssetsInLeague(leagueId, bToA)]);
  const pre = await tradePreflight({ leagueId, teamA, teamB, aToB, bToA, force: true });
  if (!pre.ok) return { ok: false, message: pre.error };

  return commitTrade({
    leagueId, teamA, teamB, aToB, bToA,
    seasonYear: pre.league.seasonYear, week: pre.league.week, message: 'Trade forced through.',
  });
}

export async function respondToTradeOfferAction(leagueId: string, offerId: string, accept: boolean): Promise<TradeActionResult> {
  await assertLeagueOwner(leagueId);
  const offer = await prisma.tradeOffer.findUniqueOrThrow({ where: { id: offerId } });
  /*
   * assertLeagueOwner() above proves the caller owns THIS league. It says
   * nothing about the offer id, which arrives from the client and was looked
   * up by primary key alone — so an offer belonging to somebody else's league
   * was reachable by anyone who owned any league at all. Authorize on the
   * league, then check the thing you are about to act on is in it.
   */
  if (offer.leagueId !== leagueId) return { ok: false, message: 'That offer is not part of this league.' };
  if (offer.status !== 'PENDING') return { ok: false, message: 'That offer is no longer on the table.' };

  if (accept) {
    const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
    const settings = parseSettings(league.settings);
    if (settings.tradeDeadlineEnabled && isTradeDeadlinePassed(league.phase, league.week, settings.tradeDeadlineWeek)) {
      return { ok: false, message: 'The trade deadline has passed for this league year.' };
    }
    try {
      await executeTrade({
        leagueId, teamA: offer.fromTeamId, teamB: offer.toTeamId,
        aToB: readJson<TradeAsset[]>(offer.give, []),
        bToA: readJson<TradeAsset[]>(offer.request, []),
        seasonYear: league.seasonYear, week: league.week,
      });
    } catch (err) {
      // The offer stays PENDING so the user can clear cap room and accept it
      // before it expires, rather than losing it to a failed acceptance.
      return { ok: false, message: err instanceof Error ? err.message : 'Trade failed.' };
    }
  }

  await prisma.tradeOffer.update({ where: { id: offerId }, data: { status: accept ? 'ACCEPTED' : 'DECLINED' } });
  revalidatePath(`/league/${leagueId}`, 'layout');
  return { ok: true, message: accept ? 'Trade completed.' : 'Offer declined.' };
}
