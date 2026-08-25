/**
 * A second draft save for the moments harness, shortlisted WIDE.
 *
 * The first one starred eight men, which is a realistic board and a poor test:
 * a rival taking one of yours inside the window a screenshot run can watch is
 * then a coin flip. Forty of the room's own top names makes the loss certain
 * within a round, which is what a verification pass needs. The rule the code
 * fires on is unchanged — this only guarantees the case occurs.
 */
import { prisma } from '../lib/db';
import { createLeague } from '../lib/gen/league';
import { advanceWeek } from '../lib/season';
import { observe } from '../lib/scouting';
import { readJson, writeJson } from '../lib/json';
import type { AttrMap } from '../lib/ratings';
import type { Position } from '../lib/tuning';
import { Rng } from '../lib/rng';
import { consensusBoardMap } from '../lib/consensus';
import { LEAGUE } from '../lib/tuning';
import { parseSettings } from '../lib/settings';
import fs from 'node:fs';

const IDS = process.argv[2];

(async () => {
  const ids = JSON.parse(fs.readFileSync(IDS, 'utf8'));
  const id = await createLeague({ name: 'MOMENTS draft wide', userTeamAbbr: 'BOS', seed: 'moments-draft-wide' });
  for (let i = 0; i < 80; i++) {
    const lg = await prisma.league.findUniqueOrThrow({ where: { id }, select: { phase: true } });
    if (lg.phase === 'DRAFT') break;
    await advanceWeek(id);
  }
  const league = await prisma.league.findUniqueOrThrow({ where: { id } });
  const team = await prisma.team.findFirstOrThrow({ where: { leagueId: id, isUser: true }, select: { id: true } });
  const cls = await prisma.player.findMany({
    where: { leagueId: id, isDraftee: true, teamId: null },
    select: { id: true, position: true, trueOvr: true, potential: true, trueAttrs: true, collegeStats: true, combineTesting: true, injuryWeeks: true },
  });
  const settings = parseSettings(league.settings);
  const board = consensusBoardMap(cls, { teams: LEAGUE.TEAM_COUNT, rounds: settings.draftRounds });
  const ranked = [...cls].sort((a, b) => (board.get(a.id)?.rank ?? 9e9) - (board.get(b.id)?.rank ?? 9e9));

  const rng = new Rng(`moments-wide-${id}`);
  for (let i = 0; i < Math.min(160, ranked.length); i++) {
    const p = ranked[i];
    const conf = i < 24 ? 46 + Math.round(rng.next() * 24) : 22 + Math.round(rng.next() * 26);
    const observed = observe(new Rng(`mw-${id}-${p.id}`), p.position as Position, readJson<AttrMap>(p.trueAttrs, {}), conf, 62, 0, p.potential);
    await prisma.scoutingReport.upsert({
      where: { playerId_teamId: { playerId: p.id, teamId: team.id } },
      create: { playerId: p.id, teamId: team.id, confidence: conf, potConfidence: Math.max(0, conf - 12), observed: writeJson(observed), lastWeek: 17 },
      update: { confidence: conf, potConfidence: Math.max(0, conf - 12), observed: writeJson(observed), lastWeek: 17 },
    });
  }
  await prisma.shortlistEntry.createMany({
    data: ranked.slice(0, 40).map((p) => ({ teamId: team.id, playerId: p.id })), skipDuplicates: true,
  });
  await prisma.league.update({ where: { id }, data: { ownerKey: 'moments-owner' } });

  ids.wide = id;
  ids.wideTeam = team.id;
  fs.writeFileSync(IDS, JSON.stringify(ids, null, 1));
  console.log('wide draft save', id, 'class', cls.length);
  process.exit(0);
})();
