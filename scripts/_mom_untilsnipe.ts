/** Advance a draft save until the LAST name called was one of ours. */
import { prisma } from '../lib/db';
import { draftOneAiPick } from '../lib/draft';
import { Rng } from '../lib/rng';

const L = process.argv[2];

(async () => {
  const league = await prisma.league.findUniqueOrThrow({ where: { id: L } });
  const team = await prisma.team.findFirstOrThrow({ where: { leagueId: L, isUser: true } });
  const rng = new Rng(`snipe-${L}`);
  for (let i = 0; i < 40; i++) {
    const last = await prisma.draftPick.findFirst({
      where: { leagueId: L, year: league.seasonYear, used: true, playerId: { not: null } },
      orderBy: [{ round: 'desc' }, { slot: 'desc' }],
      select: { playerId: true, ownerTeamId: true, round: true, slot: true },
    });
    if (last && last.ownerTeamId !== team.id) {
      const ours = await prisma.shortlistEntry.findFirst({ where: { teamId: team.id, playerId: last.playerId! } });
      if (ours) {
        const p = await prisma.player.findUniqueOrThrow({ where: { id: last.playerId! }, select: { firstName: true, lastName: true, position: true } });
        console.log(`last pick R${last.round}.${last.slot} is ours: ${p.firstName} ${p.lastName} ${p.position}`);
        process.exit(0);
      }
    }
    const r = await draftOneAiPick(L, team.id, rng, league.seasonYear);
    if (!r) { console.log('user is on the clock — stopped'); break; }
  }
  console.log('no sniped pick reached');
  process.exit(1);
})();
