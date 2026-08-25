/** How far does a first-round grade actually slide? Measured, not assumed. */
import { prisma } from '../lib/db';
import { draftOneAiPick } from '../lib/draft';
import { Rng } from '../lib/rng';
import { consensusBoardMap } from '../lib/consensus';
import { LEAGUE } from '../lib/tuning';
import { parseSettings } from '../lib/settings';

const L = process.argv[2];
const N = Number(process.argv[3] ?? 60);

(async () => {
  const league = await prisma.league.findUniqueOrThrow({ where: { id: L } });
  const team = await prisma.team.findFirstOrThrow({ where: { leagueId: L, isUser: true } });
  const rng = new Rng(`slide-${L}`);
  for (let i = 0; i < N; i++) {
    const r = await draftOneAiPick(L, team.id, rng, league.seasonYear);
    if (!r) break;
  }
  const cls = await prisma.player.findMany({
    where: { leagueId: L, OR: [{ isDraftee: true }, { draftYear: league.seasonYear, draftRound: { not: null } }] },
    select: { id: true, position: true, trueOvr: true, potential: true, trueAttrs: true, collegeStats: true, combineTesting: true, injuryWeeks: true, isDraftee: true, firstName: true, lastName: true },
  });
  const board = consensusBoardMap(cls as never, { teams: LEAGUE.TEAM_COUNT, rounds: parseSettings(league.settings).draftRounds });
  const picks = await prisma.draftPick.findMany({
    where: { leagueId: L, year: league.seasonYear, used: true, playerId: { not: null } },
    orderBy: [{ round: 'asc' }, { slot: 'asc' }], select: { playerId: true },
  });
  const made = picks.length;
  const taken = new Set(picks.map((p) => p.playerId!));
  const live = cls.filter((p) => !taken.has(p.id))
    .map((p) => ({ p, rank: board.get(p.id)?.rank ?? 9e9 }))
    .filter((x) => x.rank <= 64)
    .map((x) => ({ ...x, slid: made + 1 - x.rank }))
    .sort((a, b) => b.slid - a.slid);
  console.log(`picks made ${made}. Board top-64 still available, most-slid first:`);
  for (const x of live.slice(0, 6)) {
    console.log(`  board #${x.rank}  ${x.p.firstName} ${x.p.lastName} ${x.p.position}  slid ${x.slid}`);
  }
  process.exit(0);
})();
