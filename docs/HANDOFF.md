# Handoff — Dynasty GM Football

**Written so a fresh session can pick this up cold.** If the chat that built
this is gone, everything needed to continue is here or linked from here.

Read in this order:

1. **This file** — how to run it, what state it is in, what is in flight.
2. **`../README.md`** — §"Design principles (standing, not up for
   re-litigation)" is binding, §"Known simplifications" stops you reporting
   deliberate choices as bugs, and §"Changelog" is the full history with
   commit hashes for rollback.
3. **`deployment.md`** — how it goes live, environment variables, known
   launch risks.

---

## 1. Getting it running (from nothing)

```bash
service postgresql start            # a wall of 500s is almost always this
cd /home/user/stox
npm install                         # see the npm gotcha below
npx prisma migrate deploy           # applies all migrations
npx prisma generate
npm run dev                         # http://localhost:3001
```

`.env` needs two variables, both pointing at the same database locally:

```
DATABASE_URL="postgresql://…"
DIRECT_URL="postgresql://…"        # migrations; must NOT go through a pooler
```

**Verify it works** — expect a 200 and a landing page with 32 crests:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/
```

---

## 2. The five gotchas that have cost real time

1. **`npm run build` corrupts a running dev server.** They share `.next`. Stop
   the dev server first, or accept 500s everywhere until you restart it.
2. **Every page 500s → check Postgres first.** `service postgresql status`.
   This has looked like a code disaster twice and was the database both times.
3. **A schema change does not reach a running dev server.** `lib/db.ts` caches
   the client on `globalThis`. After `prisma generate`, restart the server.
   Symptom: `Cannot read properties of undefined (reading 'findUnique')`.
4. **`tsc --noEmit` can report clean while a real error exists.** Delete
   `tsconfig.tsbuildinfo` first, every time, before trusting it as a gate.
5. **Never `pkill -f "next dev"`** — it matches the shell running the command
   and kills it. Get the pid from `ps -eo pid,args | grep "next dev"`.

Relaunch the dev server so it survives the shell:

```bash
setsid nohup npx next dev -p 3001 > /tmp/nextdev.log 2>&1 < /dev/null &
```

---

## 3. How to verify anything (the standing recipes)

| What | Command | Expect |
|---|---|---|
| Types | `rm -f tsconfig.tsbuildinfo && npx tsc --noEmit` | 0 errors |
| Production build | `npm run build` *(dev server down!)* | exit 0, ~30 routes |
| Sim invariants | `npm run sim:health` | 0 errors; INV-19/INV-20 warnings are pre-existing |
| Contract meter vs server | `npx tsx scripts/checkNegotiationAgreement.ts` | ~974,000 comparisons, **0 disagreements** |
| Trade valuation | `npx tsx scripts/benchmarkTradeValue.ts` | scenario suite passes |
| Every screen loads | see §4 | all 200, no console errors |

**The negotiation agreement check is the most important one in the repo.** The
client interest meter and the server both call `decideOffer`; if they ever
disagree, the meter is lying to the player. Any change to `lib/negotiation.ts`,
`lib/freeagency.ts` or `lib/cap.ts` must re-run it.

---

## 4. Screenshot sweep (how the images in `screenshots/current/` were made)

Run from the repo root so `node_modules` resolves. Chromium is preinstalled —
**do not** run `playwright install`.

```js
// save as .pwdoc.js in the repo root, run `node .pwdoc.js`, then delete it
const { chromium } = require('playwright');
const fs = require('fs');
const L = '<a league id>';            // pick one from the database
const SHOTS = [['02-dashboard', `/league/${L}`], /* … */];
(async () => {
  const dir = fs.readdirSync('/opt/pw-browsers').find(d => d.startsWith('chromium-'));
  const b = await chromium.launch({ executablePath: `/opt/pw-browsers/${dir}/chrome-linux/chrome` });
  for (const [name, url] of SHOTS) {
    const p = await b.newPage({ viewport: { width: 1440, height: 1100 } });
    p.on('pageerror', e => console.log('JS ERROR', name, e.message));
    const r = await p.goto('http://localhost:3001' + url, { waitUntil: 'networkidle', timeout: 90000 });
    await p.waitForTimeout(700);
    await p.screenshot({ path: `docs/screenshots/current/${name}.png` });
    console.log(r.status(), name);
    await p.close();
  }
  await b.close();
})();
```

Find a usable league and player id:

```bash
node -e "const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();
p.league.findFirst({select:{id:true,name:true,seasonYear:true,week:true,phase:true}}).then(l=>{console.log(l);process.exit(0)})"
```

**Read your screenshots back.** Every visual defect this project has caught was
found by looking at the image, not by reasoning about the markup — a bolded
wrong column, a permanently-zero stat column, four rows sharing a sentence, a
description overflowing its panel by 83px.

---

## 5. What the screenshots show

`screenshots/current/` — all 19 at 1440px, captured after the contract,
power-rankings, lineup and player-seasons work landed.

| File | Screen | Worth noticing |
|---|---|---|
| `01-landing` | Front door | 32 hand-drawn crests; click one to start there |
| `02-dashboard` | Week hub | Strength band: overall/off/def/ST with league ranks |
| `03-roster` | Roster | TE is its own group, not folded in with receivers |
| `04-depth-chart` | Depth chart | Starting eleven per `lib/lineup.ts` |
| `05-player` | Player card | Contract at the top; per-year ledger with dead money; career stat line |
| `06-cap` | Cap sheet | Sortable, cap savings vs dead money |
| `07-free-agency` | Free agency | Negotiation with live interest meter |
| `08-resign` | Re-sign window | Rumoured suitor, loyalty discount on a clock |
| `09-draft` | Draft board | Consensus board with positional term shown |
| `10-scouting` | Scouting dept | Free public board; shortlist attention; workouts |
| `11-standings` | Standings | OVR + league rank per row |
| `12-power-rankings` | Power rankings | Allowed to disagree with the standings |
| `13-schedule` | Schedule | Game-shape sparkline and margin per row |
| `14-stats` | League stats | Leaders and team stats |
| `15-dynasty` | Dynasty | GM level, XP, three-branch skill tree |
| `16-gm-career` | GM career | Scoped to your tenure only |
| `17-trade` | Trade | Explainable valuation |
| `18-history` | Franchise history | Seeded backstory + real results |
| `19-leaderboard` | Public board | Opt-in, default off |

Older reference sets: `screenshots/` (auth flow), `design-research/*/mockup.html`
(the approved design direction), `design-directions/` (the pass that was
**reverted** — see the changelog before reviving anything from it).

---

## 6. State as of this handoff

- Branch: `claude/football-gm-simulator-ixeatl`. Everything is committed and
  pushed. `tsc` clean on all tracked files.
- Production build verified green earlier; re-run it after the in-flight work
  below lands.
- Live at **dynastygm.gg** (Vercel + Neon). Deploys are automatic on push.
- Accounts, save ownership, league import/export, leaderboard: all shipped.

### In flight when this was written (three agents killed by a container restart)

Their partial work is committed so nothing is lost. To resume, re-brief a
fresh agent with the goal and the constraints — the constraints are the part
that matters:

1. **Rating recalibration** — the owner's words: *"players feel very low
   rated"* and *"I want people coming from madden to have a familiar sense of
   who's good and who's not."* Measured baseline: 1,245 rostered players, mean
   67.8, median 69, max 95, and **22.2% below 60**. Diagnosis was that the
   floor and middle are wrong, not the ceiling. Constraints: overall drives
   contract prices, trade value, team ratings and the draft board, so measure
   market value and the 32-team rating spread before/after — raise everyone
   and the salary cap quietly stops meaning what it meant. Also: no rating tier
   may be named after an honour ("Pro Bowl" is now a real earned thing), and
   the colour ramp needs a non-colour redundant signal. Notes in
   `rating-distribution.md`.
2. ~~**Coach's Comments**~~ — **landed**, uncommitted, in the working tree.
   `lib/coachRoom.ts` (the coach-room policy: the week's yardstick, the units,
   the gates and the concerns), `components/ds/CoachComments.tsx` (the
   expandable section), `lib/weekReport.ts` (ships numbers, not prose).
   Ranking is `lib/performanceScore.ts` — imported, not forked. Measured over
   2,255 real user-team weeks the mentions are 17.3% RB / 17.2% WR / 14.1% DT
   / 13.0% CB / 10.8% S / 10.3% EDGE / 4.8% LB / 4.5% TE / 4.3% QB / 3.6% K.
   The one thing left open is the tackles problem below.
3. **All-Star selection** — from real season statistics, at the end of the
   regular season (**not** after the final: `seasonStats` keeps accumulating
   through the playoffs, so that is the only moment the stat line behind the
   honour is purely regular-season). The owner's ruling: count **distinct
   players**, not selections.

### Deliberately not done, with reasons

- **`tackles` is a depth-chart artefact, and the shared ranker weights it
  heaviest.** `allocateStats` (lib/sim/engine.ts:369) draws a flat
  `normal(62, 6)` tackles for the WHOLE defence and splits them by depth-chart
  share, so a club listing eight defenders gives each of them half again as
  many tackles as a club listing fourteen — for a reason that has nothing to do
  with playing well. `lib/statLabels.ts` quite reasonably ranks tackles
  `lead: 1` at linebacker and `lead: 2` on the line, so
  `lib/performanceScore.ts` weights them heaviest, and a 34-tackle month grades
  as a top-1% stretch. This affects **All-Star selection as much as Coach's
  Comments**, so it is not one feature's problem to solve alone and neither
  owner should quietly reweight it. Coach's Comments contains it rather than
  fixes it: `hasDistinguishingEvent()` stops tackle volume EARNING a mention
  (a defender needs a sack, a takeaway, a forced fumble or a multi-breakup
  game, scaled to the length of the stretch), and the grade printed beside a
  mention is still the shared ranker's, untouched. The real fix is either a
  per-snap tackle allocation in the engine or a `lead` demotion in
  `statLabels.ts`, and both change All-Star output.

- **Set-aside/dismiss on the re-sign list** — needs schema plus `lib/season.ts`;
  the trap to close is that setting twelve players aside and advancing loses
  them silently, so it must feed the existing advance warning.
- **Competing bids are effectively universal** — measured 83% of the top 40
  free agents, and the seven without were all fullbacks (now removed). Cause is
  structural: the function scans all 31 AI clubs and returns the best bid from
  anyone with a need, so it can only ever say yes.
- **Guaranteed money is a luxury, not a lever** — at his exact asking price
  with **zero** guaranteed, interest is already 70–88, comfortably signable.
  The fix has a template: lowball money already *caps* interest at 44.
- **`executeTrade` never adds the player to the acquiring club's depth chart**,
  and the sim sorts unnamed players behind everyone named — so a deadline
  acquisition records nothing for the rest of the season. Real gameplay bug,
  unowned.

---

## 7. How this project works (process, not code)

- **Measure before tuning.** Every balance change in the changelog has
  before/after numbers from a real league. "Feels wrong" is the start of an
  investigation, not a diff.
- **Verify claims, including agents' claims.** Several confident reports here
  were wrong on inspection. Check the artifact, not the summary.
- **Silence from a background job is not progress.** One agent sat dead for
  six hours and another for 69 minutes while appearing to work. Check the
  transcript's modification time.
- **The recurring bug class is lying metrics** — a number displayed that is not
  the number the system used. It has shipped at least six times: a ledger
  disagreeing with a tile, a rank that was not the rank of the grade shown, a
  twelve-man defence, dead money charged against a bonus never paid. When
  adding any figure, ask what would have to be true for it to be wrong.
