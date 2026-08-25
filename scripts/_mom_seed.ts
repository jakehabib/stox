/**
 * Scratch harness for the draft/scouting moments pass. Two saves, both stamped
 * with a known ownerKey so a headless browser can be let in:
 *
 *   scout — stopped in FREE_AGENCY, where the workout window is open and Full
 *           Scout charges are unspent, with a thin file on a starred prospect
 *           so a spend has somewhere to move the numbers FROM.
 *   draft — stopped in DRAFT with a real scouting book and a shortlist, so the
 *           feed, the run watch and both best-available boards have data.
 *
 * Ids are written to a json file and deleted BY ID afterwards; nothing here
 * sweeps by name.
 */
import { prisma } from '../lib/db';
import { createLeague } from '../lib/gen/league';
import { advanceWeek } from '../lib/season';
import { observe } from '../lib/scouting';
import { readJson, writeJson } from '../lib/json';
import type { AttrMap } from '../lib/ratings';
import type { Position } from '../lib/tuning';
import { Rng } from '../lib/rng';
import fs from 'node:fs';

const OUT = process.argv[2];
const OWNER = 'moments-owner';

async function stopAt(id: string, phase: string) {
  for (let i = 0; i < 80; i++) {
    const lg = await prisma.league.findUniqueOrThrow({ where: { id }, select: { phase: true } });
    if (lg.phase === phase) return;
    await advanceWeek(id);
  }
  throw new Error(`never reached ${phase}`);
}

async function book(id: string, teamId: string, depth: number) {
  const cls = await prisma.player.findMany({
    where: { leagueId: id, isDraftee: true, teamId: null },
    select: { id: true, position: true, trueAttrs: true, potential: true },
    orderBy: { trueOvr: 'desc' },
  });
  const rng = new Rng(`moments-${id}`);
  let n = 0;
  for (let i = 0; i < Math.min(depth, cls.length); i++) {
    const p = cls[i];
    // Thin at the top and thinner going down, the shape a real department's
    // book has — and never so high that a workout has nothing left to buy.
    const conf = i < 20 ? 40 + Math.round(rng.next() * 22) : 20 + Math.round(rng.next() * 25);
    const observed = observe(new Rng(`moments-${id}-${p.id}`), p.position as Position, readJson<AttrMap>(p.trueAttrs, {}), conf, 62, 0, p.potential);
    await prisma.scoutingReport.upsert({
      where: { playerId_teamId: { playerId: p.id, teamId } },
      create: { playerId: p.id, teamId, confidence: conf, potConfidence: Math.max(0, conf - 12), observed: writeJson(observed), lastWeek: 17 },
      update: { confidence: conf, potConfidence: Math.max(0, conf - 12), observed: writeJson(observed), lastWeek: 17 },
    });
    n++;
  }
  const stars = [0, 2, 5, 9, 14, 22, 33, 47].map((i) => cls[i]).filter(Boolean);
  await prisma.shortlistEntry.createMany({
    data: stars.map((p) => ({ teamId, playerId: p.id })), skipDuplicates: true,
  });
  return { filed: n, starred: stars.map((s) => s.id) };
}

(async () => {
  const ids: Record<string, string> = {};

  const scout = await createLeague({ name: 'MOMENTS scout', userTeamAbbr: 'BOS', seed: 'moments-scout' });
  ids.scout = scout;
  await stopAt(scout, 'FREE_AGENCY');
  const scoutTeam = await prisma.team.findFirstOrThrow({ where: { leagueId: scout, isUser: true }, select: { id: true } });
  const sBook = await book(scout, scoutTeam.id, 60);
  ids.scoutTeam = scoutTeam.id;
  ids.scoutStar = sBook.starred[0];

  const draft = await createLeague({ name: 'MOMENTS draft', userTeamAbbr: 'BOS', seed: 'moments-draft' });
  ids.draft = draft;
  await stopAt(draft, 'DRAFT');
  const draftTeam = await prisma.team.findFirstOrThrow({ where: { leagueId: draft, isUser: true }, select: { id: true } });
  const dBook = await book(draft, draftTeam.id, 140);
  ids.draftTeam = draftTeam.id;

  await prisma.league.updateMany({ where: { id: { in: [scout, draft] } }, data: { ownerKey: OWNER } });

  fs.writeFileSync(OUT, JSON.stringify(ids, null, 1));
  console.log(JSON.stringify(ids, null, 1), 'scoutFiled', sBook.filed, 'draftFiled', dBook.filed);
  process.exit(0);
})();
