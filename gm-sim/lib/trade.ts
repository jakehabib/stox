import { prisma } from './db';
import { Rng } from './rng';
import { AI } from './tuning';
import { parseGmProfile, playerValue, pickValue, teamNeeds, RosterPlayer } from './ai/gm';

/**
 * ===========================================================================
 * TRADES (design doc section 11)
 * ===========================================================================
 * A trade offer is two lists of assets (players + picks) moving in opposite
 * directions. Value is computed with the SAME playerValue/pickValue functions
 * the AI uses for free agency and the draft, so a team's board is internally
 * consistent across every mode of acquiring talent.
 * ===========================================================================
 */

export interface TradeAsset {
  type: 'PLAYER' | 'PICK';
  id: string; // playerId or draftPickId
}

export interface TradeEvaluation {
  accepted: boolean;
  sendValue: number;
  receiveValue: number;
  ratio: number;
  counter?: { message: string };
}

async function assetValues(
  assets: TradeAsset[],
  forTeamId: string,
  profile: ReturnType<typeof parseGmProfile>,
  needs: Record<string, number>,
  currentYear: number,
  rng: Rng,
): Promise<number> {
  let total = 0;
  for (const a of assets) {
    if (a.type === 'PLAYER') {
      const p = await prisma.player.findUniqueOrThrow({ where: { id: a.id } });
      total += playerValue(p as unknown as RosterPlayer, { profile, needs, rng });
    } else {
      const pick = await prisma.draftPick.findUniqueOrThrow({ where: { id: a.id } });
      total += pickValue(pick.round, pick.slot, profile, pick.year, currentYear);
    }
  }
  return total;
}

/**
 * Evaluate a proposed trade from the perspective of `aiTeamId` (the team
 * being asked to accept). `give` = what the AI team sends away, `get` = what
 * it receives.
 */
export async function evaluateTrade(opts: {
  aiTeamId: string;
  give: TradeAsset[];
  get: TradeAsset[];
  currentYear: number;
  settings: { aiAcceptsLopsided: boolean };
}): Promise<TradeEvaluation> {
  const rng = new Rng(`trade-${opts.aiTeamId}-${Date.now()}`);
  const team = await prisma.team.findUniqueOrThrow({ where: { id: opts.aiTeamId } });
  const profile = parseGmProfile(team.gmProfile, rng);
  const roster = await prisma.player.findMany({
    where: { teamId: opts.aiTeamId },
    select: { id: true, position: true, trueOvr: true, age: true, potential: true },
  });
  const needs = teamNeeds(roster as RosterPlayer[]);

  const sendValue = await assetValues(opts.give, opts.aiTeamId, profile, needs, opts.currentYear, rng);
  const receiveValue = await assetValues(opts.get, opts.aiTeamId, profile, needs, opts.currentYear, rng);

  const requiredRatio = opts.settings.aiAcceptsLopsided ? 0.9 : AI.TRADE_ACCEPT_RATIO;
  const ratio = sendValue === 0 ? Infinity : receiveValue / sendValue;

  if (ratio >= requiredRatio) {
    return { accepted: true, sendValue, receiveValue, ratio };
  }
  if (ratio >= requiredRatio - AI.TRADE_COUNTER_WINDOW) {
    return {
      accepted: false, sendValue, receiveValue, ratio,
      counter: { message: `Close, but we need a bit more. Try sweetening the offer — we're about ${Math.round((requiredRatio - ratio) * 100)}% short on value.` },
    };
  }
  return {
    accepted: false, sendValue, receiveValue, ratio,
    counter: { message: `Not enough here for us to consider it.` },
  };
}

export async function executeTrade(opts: {
  leagueId: string; teamA: string; teamB: string; aToB: TradeAsset[]; bToA: TradeAsset[]; seasonYear: number; week: number;
}) {
  await prisma.$transaction(async (tx) => {
    const move = async (assets: TradeAsset[], toTeam: string) => {
      for (const a of assets) {
        if (a.type === 'PLAYER') {
          await tx.player.update({ where: { id: a.id }, data: { teamId: toTeam } });
          await tx.contract.updateMany({ where: { playerId: a.id }, data: { teamId: toTeam } });
        } else {
          await tx.draftPick.update({ where: { id: a.id }, data: { ownerTeamId: toTeam } });
        }
      }
    };
    await move(opts.aToB, opts.teamB);
    await move(opts.bToA, opts.teamA);

    const [teamA, teamB] = await Promise.all([
      tx.team.findUniqueOrThrow({ where: { id: opts.teamA } }),
      tx.team.findUniqueOrThrow({ where: { id: opts.teamB } }),
    ]);
    await tx.transaction.create({
      data: {
        leagueId: opts.leagueId, seasonYear: opts.seasonYear, week: opts.week, type: 'TRADE',
        headline: `Trade: ${teamA.abbr} <-> ${teamB.abbr}`,
        detail: `${teamA.abbr} sends ${opts.aToB.length} asset(s), receives ${opts.bToA.length} asset(s).`,
      },
    });
  });
}

/**
 * Occasionally an AI team proposes a trade to the user. [TUNE] Very simple:
 * pick a random AI team, pick one of its surplus positions, offer a mid-tier
 * player for a pick. Real depth would build many templates; this is a start.
 */
export async function maybeGenerateAiTradeOffer(leagueId: string, userTeamId: string, rng: Rng, frequency: number) {
  if (!rng.bool(frequency)) return null;
  const aiTeams = await prisma.team.findMany({ where: { leagueId, isUser: false } });
  if (aiTeams.length === 0) return null;
  const aiTeam = rng.pick(aiTeams);

  const roster = await prisma.player.findMany({ where: { teamId: aiTeam.id } });
  if (roster.length < 4) return null;
  const surplus = rng.pick(roster.filter((p) => p.trueOvr >= 60 && p.trueOvr <= 82));
  if (!surplus) return null;

  const userPicks = await prisma.draftPick.findMany({ where: { ownerTeamId: userTeamId, used: false }, orderBy: { round: 'asc' } });
  const askPick = userPicks.find((p) => p.round >= 3) ?? userPicks[0];
  if (!askPick) return null;

  return {
    fromTeamId: aiTeam.id,
    fromTeamName: `${aiTeam.city} ${aiTeam.nickname}`,
    offer: { give: [{ type: 'PLAYER' as const, id: surplus.id }], get: [{ type: 'PICK' as const, id: askPick.id }] },
    blurb: `${aiTeam.city} is offering ${surplus.firstName} ${surplus.lastName} (${surplus.position}, ${surplus.trueOvr} OVR) for your Round ${askPick.round} pick.`,
  };
}
