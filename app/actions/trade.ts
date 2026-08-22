'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { assertLeagueOwner } from '@/lib/owner';
import { evaluateTrade, executeTrade, rankTradePartners, isTradeDeadlinePassed, TradeAsset } from '@/lib/trade';
import { parseSettings } from '@/lib/settings';
import { readJson } from '@/lib/json';

export async function evaluateTradeAction(leagueId: string, aiTeamId: string, give: TradeAsset[], get: TradeAsset[]) {
  await assertLeagueOwner(leagueId);
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const settings = parseSettings(league.settings);
  return evaluateTrade({ aiTeamId, give, get, currentYear: league.seasonYear, settings: { aiAcceptsLopsided: settings.aiAcceptsLopsided } });
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
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const settings = parseSettings(league.settings);
  if (settings.tradeDeadlineEnabled && isTradeDeadlinePassed(league.phase, league.week, settings.tradeDeadlineWeek)) {
    return { ok: false, message: 'The trade deadline has passed for this league year.' };
  }
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
   */
  const [a, b] = await Promise.all([
    prisma.team.findUnique({ where: { id: teamA }, select: { leagueId: true, isUser: true } }),
    prisma.team.findUnique({ where: { id: teamB }, select: { leagueId: true, isUser: true } }),
  ]);
  if (!a || !b || a.leagueId !== leagueId || b.leagueId !== leagueId) {
    return { ok: false, message: 'That trade names a club from another league.' };
  }
  // Exactly one side must be the user's club. Two AI clubs here would mean
  // the user was arranging a trade between other people's teams.
  if (a.isUser === b.isUser) {
    return { ok: false, message: 'A trade has to be between your club and another one.' };
  }
  const [aiTeamId, give, get] = a.isUser ? [teamB, aToB, bToA] : [teamA, bToA, aToB];
  const verdict = await evaluateTrade({
    aiTeamId, give, get, currentYear: league.seasonYear,
    settings: { aiAcceptsLopsided: settings.aiAcceptsLopsided },
  });
  if (!verdict.accepted) {
    return { ok: false, message: verdict.counter?.message ?? "They aren't interested in that offer." };
  }

  try {
    await executeTrade({ leagueId, teamA, teamB, aToB, bToA, seasonYear: league.seasonYear, week: league.week });
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Trade failed.' };
  }
  revalidatePath(`/league/${leagueId}`, 'layout');
  return { ok: true, message: 'Trade completed.' };
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
