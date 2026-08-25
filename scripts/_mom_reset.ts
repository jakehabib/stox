/** Puts the moments harness back to its pre-click state so a shot run repeats. */
import { prisma } from '../lib/db';
import fs from 'node:fs';

const IDS = process.argv[2];

(async () => {
  const ids = JSON.parse(fs.readFileSync(IDS, 'utf8'));
  await prisma.shortlistEntry.deleteMany({ where: { teamId: ids.scoutTeam, playerId: ids.scoutPlain } });
  await prisma.scoutingReport.updateMany({
    where: { teamId: ids.scoutTeam, playerId: ids.scoutPlain },
    data: { workoutYear: null, attrsRevealed: '[]', fullyRevealed: false, revealedYear: 0, confidence: 49, potConfidence: 37 },
  });
  // Workout slots and Full Scout charges both live on the club's DynastyProfile.
  const prof = await prisma.dynastyProfile.findFirst({ where: { leagueId: ids.scout }, select: { id: true } });
  if (prof) await prisma.dynastyProfile.update({ where: { id: prof.id }, data: { workoutUsed: 0, fullScoutUsed: 0 } });
  console.log('reset ok', prof ? 'profile cleared' : 'no profile row yet');
  process.exit(0);
})();
