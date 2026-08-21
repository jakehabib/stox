# Visual identity review — Dynasty GM Football

**The question:** full revamp, or a few optimizations?

**The answer:** optimizations — but more of them, and more centrally, than "a few" implies. The visual
language is not the problem. The problem is that the app has a good language, wrote it down, and then
applied it inconsistently across 20 pages. There is exactly **one** genuine art-direction error, and it
is not the colours or the type.

Three mockups of the same screen (the team dashboard, real Atlanta Blaze data from league
`cmt2h61470000qg99yktksa1o`) are in this folder. Open them side by side before reading further — that
comparison is the actual deliverable, this file is the argument.

| File | What it is |
|---|---|
| [`direction-a-refine.html`](direction-a-refine.html) | Current language, rules actually enforced |
| [`direction-b-evolve.html`](direction-b-evolve.html) | Newsroom reskin — serif, warm palette, rules not boxes |
| [`direction-c-revamp.html`](direction-c-revamp.html) | "Situation Room" — terminal-grade operations console |

Screenshots of the live app are in [`screens/`](screens/) — `dashboard.png`, `roster.png`, `cap.png`,
`draft.png`, `scouting.png`, `standings.png`, `player.png`, `design-system.png`, plus 10 others.
Rendered mockups: `screens/mock-a.png`, `mock-b.png`, `mock-c.png`.

---

## 1. Diagnosis

### The identity that exists is real

Barlow Condensed uppercase headings, tabular figures, near-black graphite, a single green accent,
hexagonal crests, team-tinted watermarks, and yard-line hashmarks at 0.028 opacity under everything.
It is **broadcast-editorial** — a Sunday pregame studio, not a SaaS dashboard. When it lands it is
genuinely good: `screens/standings.png` is FM-quality, `screens/player.png`'s small-first-name /
huge-surname lockup reads as a jersey back, and the cap page's contract table
(`screens/cap.png`) is a clean, dense, professional table with nothing wrong with it.

### The weakness is application, not language

Five pieces of evidence, in order of how much they should change your mind:

1. **The app already contains the "after" of its own redesign.** Compare `screens/cap.png` and
   `screens/roster.png` — one click apart, same players, same data. Cap: 37px rows, plain names, no
   avatars, one colour on OVR. Roster: 45px rows, a portrait on every row, OVR rendered in four
   different hues, and a green "Active" pill repeated 25 times. Two philosophies, one app. You do not
   need a new language when the good version already ships on the adjacent page.

2. **The codebase overwhelmingly followed the stated rule.** `globals.css` says section-based layout
   is the default and `.card` is only for "a genuinely distinct object." Actual usage across the tree:
   `.panel` **122×**, `.section` **86×**, `.card` **10×**. The rule was obeyed nearly everywhere. The
   dashboard — the screen the owner looks at most — is the outlier that ignored it and rendered seven
   equal-weight cards.

3. **The palette is measurably fine.** On the card surface: chalk 15.8:1, accent 10.2:1, warn 10.6:1,
   accent2 8.3:1, gold 9.2:1, bad 6.4:1, muted 5.8:1. Every base token clears AA, most clear AAA.
   Repainting solves nothing that is actually broken.

4. **Token discipline is high.** ~60 hardcoded hex values in the entire `app/` + `components/` tree,
   and nearly all are SVG illustration internals or the chart palette. Surfaces go through CSS
   component classes, not inline colour.

5. **A design system exists — and disqualifies itself.** `screens/design-system.png` is a thorough
   4-page system: tokens, type scale, surfaces, then 15 real composites. It also states, on the page:
   *"Nothing on this page is wired to real game data or reused in production yet."* Its own
   "PLAYER ROW — DESKTOP TABLE" example has no avatars. Production roster rows do. **A design system
   that is not the source of truth is a style guide**, and that gap is the whole diagnosis.

### Where it falls apart — five specific failures

**1. Uniform emphasis on the dashboard.** (`screens/dashboard.png`) Seven blocks, seven identical
bordered cards. Nothing is primary, nothing recedes. Worse, the most saturated element on the entire
page is *Roster Needs* — five identical full-width red bars, each labelled "Urgent." A meter pegged at
100% for every row carries zero bits. The loudest thing on the page is the least informative one.
Meanwhile the League Wire prose recaps — the best writing in the product — sit below 1,300px of fold.

**2. Chrome tax.** Every page opens with the same band: eyebrow, huge team name, watermark, 4–6 stat
tiles. On the draft board (`screens/draft.png`) that band plus ticker, header, nav, sub-nav, class
outlook and filter row consume **512px before the first of 400 rows**. You see 18 rows on a 1400px
screen. Football Manager's community explicitly asks for high-density layouts because
["the central philosophy of Football Manager is information"](https://community.sports-interactive.com/bugtracker/1644_football-manager-26-bugs-tracker/user-interface/2166_advanced-access-betas-ui-issues/2074_general-user-interface-issues/a-passionate-plea-rethinking-ui-scaling-for-high-resolution-4k-displays-3840x2160-r37910/).
This is the genre's defining metric and the app is spending it on furniture.

**3. Categorical colour on continuous data.** OVR renders in four hues — 65 red, 74 blue, 82 green,
92 gold. Nothing tells a new player whether blue outranks green. The same pattern recurs on scouting
ranges (`screens/draft.png`) and player attributes (`screens/player.png`). Linear's dark UI is
premium precisely because density is managed
["through subtle gradations of white opacity rather than color variation"](https://linear.app/now/how-we-redesigned-the-linear-ui);
this does the inverse. It also spends the colour budget on a scale, leaving nothing left to spend on
things that genuinely need attention.

**4. Constant columns rendered at full weight.** "Active" on 27 of 28 roster rows. "Unevaluated" on
300 of 300 draft rows. A "Negotiate" button on all 100 free-agency rows (`screens/free-agency.png`).
A column whose value never varies carries no information and should be blank-unless-notable.

**5. The portraits are the one real art-direction error.** `components/PlayerAvatar.tsx` is careful,
well-documented generative SVG — and it is wrong here, in 13 call sites. At 20px in a table it is a
coloured smudge costing 28px of row width and conveying nothing. At 145px on the player card, a
cartoon bust sits directly beside a jersey-back name lockup and a genuinely excellent piece of scouting
prose, and drags the page from "front office" toward "mobile freemium." This is the single biggest
premium-versus-generic tell in the product.

**Plus, still shipping:** the League Wire ticker paints its scrolling text over its own label. It is
the first thing the eye hits on all 20 pages. `docs/design-audit.md` §A2 has it marked done; it is not.

---

## 2. The three directions

### A — Refine

Same tokens, same Barlow Condensed, same green, same yard lines. A returning user recognises it
instantly. What changes: sections and rules replace the grid of equal cards; three stacked summary
bands collapse into one hero; one sequential ramp replaces the four-hue rainbow, with tier also carried
by a glyph so colour never works alone; 30px rows and no avatars in tables; constant columns go blank;
Roster Needs becomes ranked and differentiated ("LB — none rostered", "QB — −13.9 ovr") instead of five
identical red bars.

**Cost: ~1 week.** Most of the work is central, not per-page:
- `tailwind.config.ts` and the palette: **untouched**.
- The rainbow dies in one place — `ratingColor()` / `ds/RatingBadge` are already centralised.
- `PageMasthead` gets a compact variant; **14 of 20 pages** import it and get it for free.
- Avatar removal is 13 call sites, about half of them tables.
- Dashboard `.card` → `.section` is one file.
- The ticker fix is one component.

### B — Evolve

The front office as a **newsroom** — the league's paper of record rather than a broadcast overlay.
Newsreader serif masthead and headlines, IBM Plex Sans for UI, IBM Plex Mono for every figure. Warm
charcoal-and-bone replaces cool graphite-and-green; ember orange and steel blue replace green and cyan.
Depth comes from hairline rules and a typographic scale — no rounded corners, no shadows, no bordered
cards anywhere. This is close to what Fox Sports did for its
[2025 NFL graphics package](https://www.newscaststudio.com/2025/09/25/fox-sports-nfl-score-bug-2025-season/):
a "typography-centric look that swaps traditional boxed elements in favor of a cleaner" treatment.

**Cost: ~2.5–3 weeks.** Colour and type are token-level, so roughly 70% cascades from
`tailwind.config.ts` + `globals.css`. The other 30% is real: a serif headline face resets vertical
rhythm on every page, and the **6 pages that opted out of `PageMasthead`** have to be done by hand.

### C — Revamp ("Situation Room")

The front office as a live operations desk. Persistent left rail carrying every unit with its own
alert count, a command bar with a `/` prompt, monospaced data throughout, a visible modular grid,
24px rows, and a terminal status line with keyboard hints. Bloomberg's semantics — dense, functional
colour, predictable — applied to roster and cap accounting, which is genuinely what a GM does.
[Bloomberg's own position](https://lollypop.design/blog/2026/june/trading-app-design/) is that
users "expect maximum data density, sacrificing whitespace."

It wins the density argument outright: **the entire dashboard fits in 1,214px** versus the production
page's 1,989px, with more information shown. A 53-man roster or a 400-row board is a different
experience here.

**Cost: ~6–8 weeks, plus ongoing.** The left rail replaces the top nav, which means `LeagueNav`,
`app/league/[id]/layout.tsx`, and every page's assumed content width. 24px rows means re-tuning every
table in the app. And the keyboard-first affordances the design promises (`/` command palette, `J`/`K`
row navigation, `⏎` to open) do not exist — drawing them is a day, building them is a month.

**The cost model behind these numbers:** 800 inline `className` occurrences live in `app/league/**`
page files versus 906 in `components/` — about 47% of the visual surface is per-page inline markup.
But of that inline usage, only 8 `rounded-lg`, 2 `rounded-md` and 48 `border-line` are structural;
the bulk is `text-muted` (184) and `text-accent` (55), which are token-level. **Recolouring and
retyping is cheap here. Relayout is expensive.** That is why B costs 3× A and C costs 7×.

---

## 3. Recommendation

**Ship Direction A. Steal exactly two things from B. Reject C.**

### Why A

Because the diagnosis says the language is fine and the application is not, and A is the only option
that treats the actual disease. Every failure in §1 — uniform emphasis, chrome tax, the rainbow,
constant columns, the portraits — is fixed by A without touching a single token. If you ship A and are
still unhappy, *then* you have evidence that the language itself is wrong, and B is waiting. Do not
buy that evidence for three weeks when one week produces it.

There is also a sequencing argument you should not ignore. `docs/playtest-audit.md` reports that
seasons after the first play **zero games**, that the draft can permanently deadlock, and that no AI
contract offer is ever refused. All five playtesters said they would not start a fifth season. A
one-week visual pass can run alongside that work. A six-week one cannot, and should not try.

### The two things to take from B

1. **Monospaced, tabular figures for every number in the app.** Compare the roster tables in
   `mock-a.png` and `mock-b.png` — B's columns align without help and read instantly as data rather
   than text. This is a ~1-day token change with a disproportionate payoff in perceived quality, and
   it is the single most consistent trait across every product cited here: PFF, FBref, Bloomberg,
   Linear. Proportional figures in a numeric column
   [simply look wrong](https://book.webtypography.net/Web-Typography_Numerals-and-tables.pdf).
2. **Rule-based section heads instead of bordered card heads.** B's `border-bottom: 2px` does the same
   framing job as a card border for a quarter of the ink, and it is already what `.section-head` in
   `globals.css` is trying to be.

**Do not take B's serif or its warm palette.** Newsreader buys you The Athletic and sells you NFL
RedZone, and this app's broadcast voice is worth more than its newsroom voice.

### Why I reject C

Not because it is bad. It is the densest of the three, it is the one I would most enjoy using, and if
you were starting from nothing I would argue for it.

Reject it for two reasons:

1. **It costs 6–8 weeks against a backlog where the game does not currently simulate its second
   season.** No visual work is worth that queue position.
2. **It discards the only thing this app has that its competitors don't.** Football Manager and OOTP
   already own "dense spreadsheet with a left rail" — and OOTP is
   [criticised for exactly that](https://gazettely.com/2024/04/games/out-of-the-park-baseball-25-review/):
   reviewers ask the devs to "streamline the information in a much more visually pleasing way."
   C would move Dynasty GM *toward* the thing its competitors are being told to move away from, and
   away from the jersey-back name lockup, the prose recaps, the on-the-clock hero and the yard-line
   ground — which are the parts of this product that feel like nobody else's.

C wins the density argument and loses the identity argument. The owner asked an identity question.

**One idea from C is worth keeping regardless:** the left rail's per-item alert counts
(`Depth Chart · 3`, `Re-sign · 7`, `Trade Center · 2`). That is routing, which the playtest audit
names as the app's central failure, and it does not require adopting the rail.

---

## 4. Preserve regardless of direction

Several systems here are genuinely good and a redesign is the most likely way to break them. This list
is a constraint, not a compliment.

**Components**
- **`ds/FrontOfficeBrief`** — kicker, real headline, a consequence sentence, and a *concrete action
  button per row* rather than a chevron. The only block in the app that answers "what should I do
  next." All three mockups keep its structure exactly.
- **The standings page** — playoff picture with seed chips, bye/division/wild-card banding, an explicit
  CUT LINE row, games-back, and a five-game streak strip. Best page in the app; touch only the crests.
- **The player name lockup** — small first name over huge uppercase surname. The most on-brand object
  in the product.
- **`ds/ScoutingRange`'s fixed 40–99 scale** — every other rating display should be corrected *toward*
  this, not away from it.
- **`ds/RosterGroupHeader`** — `5 players · avg 80.2 OVR · $48.4M · thin` answers the question before
  you read a row. All three mockups keep it.
- **`ds/MetricTiles`' `tip` slot** — every derived metric carries its own baseline and a plain-English
  reading. Rare and valuable.
- **The cap page's contract table** — it is already the target state. Do not "redesign" it; copy it.

**Content and logic**
- **The prose recaps and scouting reports.** Per-attribute *ranges* instead of fake precision, combine
  numbers with class percentiles, and an honest *"Essentially unscouted. Anything we say right now is
  a guess."* This is the best writing in the product and it should be promoted up the page, not
  restyled.
- **The asymmetric trade cap math** and its separate *"Dead money you'd eat"* figure.
- **Confirm-then-act** on cuts, non-re-signs and bulk AI actions.
- **`heroFacts` branching on `capMode`**, and `RosterGroupHeader` omitting cap rather than faking `$0`.

**System**
- **The token palette.** Measured AA-clear across the board. Direction A changes none of it.
- **The body's yard-line hashmarks** at 0.028 opacity. They do more for the broadcast feel than
  anything else in `globals.css` and cost nothing.
- **`RatingBadge`'s deliberate `tierHex()` duplication** — documented and correct. Do not "fix" it.

---

## 5. Accessibility

Every foreground colour proposed in all three mockups was measured against its own background.

| Direction | Ground | Body | Muted | Accent | Warning | Danger |
|---|---|---|---|---|---|---|
| A (unchanged) | `#18181b` | 15.80 | 5.82 | 10.17 | 10.61 | 6.40 |
| B (new) | `#1d1916` | 15.51 | 6.36 | 7.44 | 7.44 | 5.98 |
| C (new) | `#0f1214` | 14.52 | 5.54 | 9.21 | 9.21 | 6.32 |

All body and secondary text clears WCAG AA (4.5:1); most clears AAA. Hairline rules (B `--rule`
1.49:1, C `--grid`) are decorative separators, not text or control boundaries, and are exempt — but
no direction uses them to carry meaning.

**Colour never works alone in any of the three:**
- Ratings pair the hue with a *value* plus a redundant non-colour cue — a glyph in A, an underline
  rule in B, a five-step bar in C.
- Streak strips pair colour with position and order, and the record is stated numerically alongside.
- The cap-allocation chart pairs fill colour with an explicit league-average tick mark and a signed
  numeric deviation, so over/under is readable without hue.
- Status flags are words ("Expiring", "Out 2w", "Need"), not coloured dots.

The one thing to fix in production regardless of direction: the roster's four-hue OVR ramp is the only
place in the app where a value's meaning is carried by hue with no redundant encoding at all.

---

## Sources

- [How we redesigned the Linear UI](https://linear.app/now/how-we-redesigned-the-linear-ui)
- [Football Manager — community request for a high-density layout](https://community.sports-interactive.com/bugtracker/1644_football-manager-26-bugs-tracker/user-interface/2166_advanced-access-betas-ui-issues/2074_general-user-interface-issues/a-passionate-plea-rethinking-ui-scaling-for-high-resolution-4k-displays-3840x2160-r37910/)
- [Out of the Park Baseball 25 review — Gazettely](https://gazettely.com/2024/04/games/out-of-the-park-baseball-25-review/)
- [Out of the Park Baseball 25 review — Operation Sports](https://www.operationsports.com/out-of-the-park-baseball-25-review-an-impressively-deep-managerial-experience/)
- [Fox Sports' 2025 NFL score bug and graphics package — NewscastStudio](https://www.newscaststudio.com/2025/09/25/fox-sports-nfl-score-bug-2025-season/)
- [ESPN CFP 2025 broadcast design](https://www.behance.net/gallery/216914581/ESPN-CFP-2025)
- [Trading app design — density, dark mode and colour semantics](https://lollypop.design/blog/2026/june/trading-app-design/)
- [Bloomberg — designing the Terminal for colour accessibility](https://www.bloomberg.com/company/stories/designing-the-terminal-for-color-accessibility/)
- [Numerals and tables — The Elements of Typographic Style Applied to the Web](https://book.webtypography.net/Web-Typography_Numerals-and-tables.pdf)
- [Sports lower thirds — design, animation and best practices](https://wasp3d.com/blogs/sports-lower-thirds-for-broadcasts-design-animation-and-best-practices)
