# Design Audit — Consolidated Engineering Plan

Merged from four independent audit lanes (**core** = dashboard/player/roster/depth-chart,
**transactions** = trade/FA/re-sign/cap/draft, **league** = standings/schedule/stats/news/history/gm/settings/shell,
**system** = tokens, `components/ds/`, contrast).

Where a finding appears in more than one lane it is stated **once** here, with the lanes noted.
Independent rediscovery is itself evidence of severity — a bug three auditors tripped over
without coordinating is a bug every player trips over.

Everything load-bearing below was re-verified against the source and the live database
(league `cmt1vj55h06ju10drk5nrdkfq`) before being ranked. Verified claims are marked ✅.

**Ranking rule:** (reader impact × breadth) ÷ effort. A one-line fix visible on 16 pages
outranks a rewrite that improves one. Effort is S (< 1h), M (a few hours), L (a day+).

---

## Sequencing — read this before the lists

There is one hard dependency chain. **A1 must land before A3, and A4 before either is durable.**

```
A1  --team-text derivation            ← nothing team-coloured is correct until this lands
 ├─ A3  team-colour-as-text contrast  ← its fix is "use var(--team-text)", which today
 │                                       resolves to house blue. Fixing A3 first ships a
 │                                       different wrong colour and hides A1.
 └─ A4  de-duplicate the four inline masthead copies
        ← A1 is a 1-line fix or a 12-site fix depending on whether A4 lands first.
```

Suggested order:

1. **A2** (ticker) and **B1.1** (wire `seasonYear`) — both trivial, both visible immediately.
2. **A1** → **A3**. Restores team identity across the whole app.
3. **A4** → **A5**. Stops A1 from regressing and closes the biggest consistency gap.
4. **The correctness cluster** — B2.1, B4.1, B5.1, B6.1, B7.1, B9.1, B9.2, B11.1. Eight
   verified wrong-number / wrong-link bugs, all S, spread across eight pages.
5. **A9** (dead-state discipline) — cheap, and the league is in an offseason phase most of
   the calendar, so this is what most sessions actually look at.
6. **A6, A7, A8, A11** — the primitive/token pass.
7. Structural per-page work: B1.2, B3, B5.4, B10, B12, B16.

---

# A. Systemic fixes — do these once, centrally

## A1 · `--team-text` never resolves to the team's colour ✅
**HIGH · S · `app/globals.css:13–22` + ~12 consumers · lane: system**

```css
:root {
  --team-accent: #38bdf8;
  --team-text: color-mix(in srgb, var(--team-accent) 60%, white 40%);
}
```

`var()` inside a custom property is substituted at computed-value time **on the element where
the property is declared**. `--team-text` is declared once on `:root`, so it bakes in `:root`'s
`--team-accent` — the house blue `#38bdf8` — and that *already-computed colour* inherits down.
Every component that does `style={{ '--team-accent': teamHex }}` recolours borders, gradients
and watermarks correctly and leaves `--team-text` at house blue.

Verified in the running app on `/`, `/gm`, `/cap`, `/depth-chart`, `/roster`, `/trade`,
`/free-agency`, `/resign`, `/draft`, `/history`: element `--team-accent = #0d3b24` (Atlanta pine),
computed `--team-text = color-mix(in srgb, #38bdf8 60%, white 40%)` → sky blue.

**What it costs the reader:** on seven mastheads the border and gradient are the team's colour
and the headline directly inside them is a different, unrelated blue. The team-identity idea the
entire visual system is built around is silently dead, and the comment in `globals.css` describes
behaviour that does not happen. `ds/MatchupCard.tsx:33` is the only site that gets it right, and
only because it bypasses the token and builds the `color-mix()` string inline from the hex.

**Fix:** derive on the same element that sets the accent. Export one helper and use it at every
call site:

```ts
export const teamVars = (hex: string) => ({
  '--team-accent': hex,
  '--team-text': `color-mix(in srgb, ${hex} 60%, white 40%)`,
} as React.CSSProperties);
```

Keep the `:root` pair as the no-team fallback. Consumers: `ds/PageMasthead.tsx:64`,
`ds/TeamHeader.tsx:42,72`, `ds/OnTheClock.tsx:36,46,48`, `ds/BottomNav.tsx:26`,
`gm/page.tsx:35`, `history/page.tsx:156`, `draft/page.tsx:257`. All 20 curated primaries in
`lib/gen/teamLogo.ts` pass AA as `--team-text` on ink (4.53–7.24:1), so the fix is safe.

---

## A2 · The League Wire ticker paints its scrolling text over its own label ✅
**HIGH · S · `components/ds/LeagueWireTicker.tsx:18–21` · lanes: core (X1), league (#1), system (#6)**

Found independently by three of four lanes — the only finding with that distinction.

The `League Wire` label and `.ticker-track` are siblings in one `overflow-hidden flex` box.
The track is ~7.5–7.9k px wide with `min-width:auto`; `translateX(-50%)` slides it far past the
label's right edge; the track comes later in DOM order with no stacking context, so headlines
paint **on top of** the label. Measured: label right edge x≈116, track left edge x≈54–63.

**What it costs the reader:** the first element on every screen in the product is an illegible
smear — `LTERAGDIE: WBIROSE`, `LEAGUE WIRSIGNING Extended Dominic Quarles`. Three separate
auditors' screenshots of unrelated pages all show it. It reads as "this app is broken" before
anything else is read.

**Fix:** give the track its own clip box and move the padding inside so the `-50%` loop seam is
exact (currently ~8px off, producing a visible jump every cycle):

```tsx
<div className="label-sm shrink-0 …">League Wire</div>
<div className="relative flex-1 min-w-0 overflow-hidden">
  <div className="ticker-track flex items-center whitespace-nowrap py-1.5">…</div>
</div>
```

---

## A3 · Raw team primaries used as small text — 1.57:1 measured ✅
**HIGH · S · `roster/page.tsx:196`, `components/DepthChartGroup.tsx` · lanes: core (R1, DC6), system (#2, #3)**

`roster/page.tsx:196` renders the "Starter" tag with `style={{ color: teamColor }}` where
`teamColor` is the raw fill primary. Computed: `rgb(13,59,36)` on `#0a0a0b` at 9px = **1.57:1**
(AA needs 4.5). This is not one unlucky team — computed across all 20 `COLOR_PAIRS` primaries:
**20/20 fail 4.5:1 on ink, 19/20 fail even 3:1.** Best is teal at 3.14:1; worst is midnight at 1.21:1.

The same raw hex is also used for a 5%-alpha row tint and a 3px left rule (both imperceptible),
and `DepthChartGroup` uses an 8%-alpha raw-accent tint as the *only* starter marker.

**What it costs the reader:** "who starts" is the primary scanning signal on both pages. The
derivation is correct — the roster's starter logic genuinely agrees with the depth chart — and
none of it is perceivable. On the one page whose entire purpose is designating a starter, there
is no hard visual break between slot 1 and slots 2+.

**Fix:** `color: var(--team-text)` for the tag and the rule, raise the row tint to ~14% alpha,
add an explicit `STARTER` label plus a divider on depth-chart row 1. **Blocked on A1** — landing
this first ships house blue instead of pine and masks the real bug.

Two more measured contrast failures in the same class, both one-liners:

- `components/ShortlistStar.tsx:27` — the un-shortlisted `☆` uses `text-line` (`#2d2d32`), a
  *border* token, at **1.44:1**. It is an interactive control that is effectively invisible.
  Use `text-muted/70` (3.68:1) and swap the text glyph for `ds/icons.tsx`'s `IconStar`, which
  has a `filled` prop and is already used correctly by `ds/ProspectRow.tsx:34`.
- `roster/page.tsx:157` — the OFFENSE / DEFENSE / SPECIAL TEAMS unit dividers use
  `text-muted/60` at 11px/700 = **2.99:1**. Use full-opacity `text-muted`; at 11px uppercase
  with `tracking-[0.18em]` they are already recessive without the opacity knock-down.
  (See also B3.3 — these dividers have a hierarchy problem as well as a contrast one.)

Everything else on 15 scanned league pages clears AA. Two edges worth a comment, not a change:
`viz6` (`#008300`) is 3.58:1 on card and should be marked fill-only in `tailwind.config.ts`;
`.input`'s `placeholder:text-muted/60` is 2.81:1 and would be fine at `text-muted/80`.

---

## A4 · Four inline copies of `PageMasthead`, two shadowed `ds/` components ✅
**HIGH · M · lanes: system (#7), league (#7), core (X2)**

The hero markup was copy-pasted rather than imported, and has already drifted:

| Site | What it duplicates | How it diverged |
|---|---|---|
| `player/[playerId]/page.tsx:272–280` | `PageMasthead`'s facts strip, class for class | — |
| `player/[playerId]/page.tsx:184–194` | `ds/PlayerHero` (never imported anywhere) | — |
| `draft/page.tsx:235–266` | `ds/OnTheClock` (never imported anywhere) | — |
| `gm/page.tsx:21–43` | masthead recipe | `text-2xl` not `3xl`; no hash overlay; gradient origin `at 0% 0%` |
| `history/page.tsx:145–162` | masthead recipe | `text-2xl`; no hash overlay; no facts strip |

The missing piece in the two partial copies is the stadium-light hash overlay
(`repeating-linear-gradient(115deg, …)` at `opacity-[0.05]`) — the exact device `PageMasthead`'s
own comment identifies as the family marker. So GM Career and History read as *almost* right,
which is worse than obviously different.

**What it costs the reader:** GM Career and History announce themselves one full type step
smaller than Cap and Roster, for no reason anyone chose. And engineering-wise, A1 is a 12-site
fix instead of a 1-site fix, and will regress the next time someone adds a page.

**Fix:** delete the inline copies and pass props. `PageMasthead` already accepts
`eyebrow / title / subtitle / action / facts`; the draft on-the-clock block needs one added
`variant="event"` for the `border-2 shadow-elevated` treatment. `PlayerHero` and `OnTheClock`
should become the real implementations, not stay as unused near-duplicates. `ds/TeamHeader`
(used only by the dashboard) should be **deleted** in favour of `PageMasthead` rather than
upgraded — see the note in section D.

---

## A5 · Half the app opted out of `PageMasthead` entirely ✅
**HIGH · M · lanes: league (#6, #33), system (#11)**

`PageMasthead` is used by cap, roster, free-agency, depth-chart, trade, resign, draft. It is used
by **none** of standings, schedule, stats, news, history, settings, gm. Those seven ship an
identical hand-typed line —
`<h1 className="font-display font-extrabold text-3xl uppercase tracking-wide">` — at
`standings:34`, `schedule:22`, `stats:178`, `news:48`, `history:45`, `settings:12`, plus the
cap-mode-OFF fallback at `cap:44`.

**What it costs the reader:** cross from Roster to Standings and the page stops introducing
itself. You lose the team tint, the crest watermark, the hash texture, and — most importantly —
the facts strip, the device that makes a page feel like a front-office screen rather than a
report. Every nav category in the League and System sections is affected.

**Fix,** with concrete facts for each strip (all of these already exist in the data layer):

- **Standings** — eyebrow `2026 Regular Season`; facts: your seed, games back, division rank,
  conference rank, clinch status (`computeClinchStatus` / `clinchScenarioTag` already exist and
  are already called by the dashboard).
- **Schedule** — facts: record, remaining games, next opponent, home/away split, PF–PA.
- **Stats** — title `League Stats` / `My Team Stats`; put the scope/depth controls in the
  `action` slot, exactly as `cap/page.tsx:206–211` already does with identical Basic/Advanced pills.
- **News** — facts: transactions this week, trades this season, injuries active.
- **History** — title `Ring of Honor`; facts: seasons on record, champions crowned, records held.
- **GM Career** — the four `.stat-tile` figures become the facts strip and the tile row is deleted
  (this also fixes B15.1).
- **Settings** — facts: cap mode, difficulty, season, teams.

---

## A6 · No page-title token, and two competing numeric type systems ✅
**MEDIUM · S · `app/globals.css` `@layer components` · lanes: system (#10, #11), league (#33)**

**(a) Titles.** `globals.css` defines `.section-title` and the `stat-*` scale but nothing for an
H1, so every page re-types the recipe: `text-3xl` × 8 sites, `text-2xl` × 5, plus one-off
`text-5xl` (player), `text-4xl` (`PlayerHero`), `text-6xl` (landing). **Fix:** add `.page-title`
(3xl) and `.hero-title` (5xl) next to `.section-title`, replace the ~15 inline recipes.

**(b) Numbers.** `.stat-value` + `text-stat-sm/md/lg/xl` exists for "big sports numbers — OVR,
records, cap space". Several places use `font-mono` at a body size instead, and the hierarchy
inverts as a result:

- `gm/page.tsx:59,64,69,74` — Record, Championships, Draft Hit Rate, Trades Made at
  `text-lg font-mono`; two blocks below, the *less* important "average dead money" figure at
  `stat-value text-stat-md`. On the one page whose purpose is "here is your career", the four
  headline numbers are the quietest figures on it.
- `layout.tsx:72,77` — **Cap Space**, the number the header exists to display, at
  `text-sm font-mono`. It is named in `.stat-value`'s own doc comment as a canonical use.
- `game/[gameId]/page.tsx:76` — the final score at `text-3xl font-mono` (see B17).

Keep `font-mono` only where the content is a code-like string (`R1·P12`, `Yr 2027 Wk 4`), which
is where `ds/RecentPicksFeed` and `ds/NewsRow` already use it correctly. `font-mono` for W-L
records is defensible for alignment, but `.stat-value` already sets `font-variant-numeric:
tabular-nums`, so it aligns too, in the display face.

**(c) Rhythm.** Root vertical spacing is `space-y-4` / `-5` / `-6` / `-8` across pages with no
rule. Pick `space-y-6` (already the plurality) and let a page opt out deliberately.

---

## A7 · The three most-repeated composites have no shared component ✅
**MEDIUM · M · lanes: system (#8), transactions (#14, #15), league (#18, #35)**

**(a) Sortable table header — 15 hand-written copies.**
`{sortKey === 'x' && (dir === -1 ? ' ▾' : ' ▴')}` appears at `roster:258–265`, `cap:350`,
`free-agency:146–150`, `draft:313–318`, while `components/TradeBuilder.tsx:325` has a private
`SortHeader` doing exactly this. Consequences, all reported independently by transactions and system:

- At rest, sortable headers are **indistinguishable from non-sortable ones** — `Pos`, `Age`,
  `Scouted`, `Est. Market` are links; `Name`, `Player`, `Status` are not; all render identically.
  The only column that looks sortable is the active one, because it's the only one with an arrow.
- The active column gets *no* treatment beyond an 8px glyph — no `text-chalk`, no accent — so on
  a 9-column roster table you cannot tell at a glance what it's sorted by.
- Behaviour has already diverged: free-agency and draft use raw `<a href>` → **full page reload**
  per sort click; cap and roster use `<Link>` → client nav; `TradeBuilder` uses local state with
  no URL, so a trade-panel sort is neither shareable nor restorable; re-sign has no sort at all.
- Direction semantics conflict: draft's `consensus` flips the sign because rank 1 is best, so its
  `▾` means "ascending rank" while the identical `▾` on the adjacent `age` column means descending.
- Glyph families are mixed: `▾`/`▴` in tables, `▲`/`▼` in `ds/StandingsTable:33` and `standings:52`.

**Fix:** promote `SortHeader` to `ds/SortableTh.tsx` — Link-based, persistent low-opacity caret
on every sortable header, `text-chalk` + full-opacity caret when active, and a `betterIsLower`
flag that flips the glyph so ▾ always means "best first". Use `ds/icons.tsx` chevrons. Move the
trade panel's sort into the URL alongside `?with=`.

**(b) Filter pill — 13 copies across 6 files.**
`pill ${active ? 'border-accent text-accent bg-accent/10' : 'border-line text-muted …'}` at
`free-agency:136,138`, `stats:183,185,189,190`, `cap:208,209`, `news:57`, `draft:297,299`,
`TradeBuilder:177,385`. `LiveDraftTicker.tsx:49` reuses the *active filter* styling for a
*status announcement* ("You are on the clock"), so one visual now carries two meanings.

Meanwhile `components/CreateLeagueForm.tsx:127` has a private `Segmented` that already does the
one-of-N job properly, with `aria-pressed`.

**Fix:** lift `Segmented` into `ds/Segmented.tsx`; build `ds/FilterBar` on top taking
`groups: {label, options, active}[]` so each axis renders as a labelled segmented control.
This fixes six pages at once and gives the Stats page its grouping for free (B12.2) and the
Settings page its enum controls (B16.1). Add a separate `ds/StatusPill` for announcements.

**(c) Titled data panel — 9 copies.** `panel overflow-hidden` + a hand-built
`px-4 py-2.5 border-b border-line/70 label-sm` header bar at `standings:39`, `stats:308,354,393`,
`history:77,93,113`, `gm:104`, `ds/StandingsTable:14`. **Fix:** one
`ds/DataPanel({ title, action, children })`. This is the app's second-most-used header shape
after the masthead and it has no component.

---

## A8 · Position-group colour means two contradictory things ✅
**MEDIUM · S · `cap/page.tsx:32–33`, `stats/page.tsx:132,143,168,169`, `ds/positionColor.ts` · lane: system**

`tailwind.config.ts` defines `viz1…viz8`, `vizGood`, `vizBad` with a comment saying they are
"fixed order, never cycled/reassigned per chart." Then `cap/page.tsx:32` re-types `viz1..viz8`
as literal hex under different names — and assigns them to different position groups than
`ds/positionColor.ts` does:

| group | `positionColor.ts` (roster/draft/FA/player/trade badges) | `cap` `GROUP_COLOR` (allocation & vs-league charts) |
|---|---|---|
| RB | viz1 blue | viz2 orange |
| WR/TE | viz1 blue | viz3 green |
| OL | viz3 green | viz4 amber |
| DL | viz2 orange | viz5 pink |
| LB | viz2 orange | viz6 green |
| DB | viz5 pink | viz7 violet |

**What it costs the reader:** colour carries the same *meaning* (position group) in both places
and gives contradictory answers. Learn "orange = front seven" from the roster badges, then read
an orange RB bar on the cap chart. `viz6/7/8/vizGood/vizBad` are never referenced by name
anywhere — the tokens exist and every consumer bypasses them. `cap:169` also hardcodes `#93939c`
(= `muted`) and `stats:143` hardcodes `#5a5a63`, which is not a token at all.

**Fix:** one exported `POSITION_GROUP_COLOR: Record<PositionGroup, {token, hex}>` in `lib`, keyed
by `POSITION_GROUPS`, with `positionColor.ts` deriving Tailwind classes from it and the chart
pages reading `.hex`. Charts genuinely need hex for SVG `fill` — the point is one source, not five.
Swap the ad-hoc two-way value scale (`#3987e5`/`#e66767`) for the existing `vizGood`/`vizBad`.

---

## A9 · Dead-state discipline — the app is broken for most of the calendar
**MEDIUM–HIGH · M · lanes: core (P6, R6, D6), league (#16, #21), transactions**

No lane named this as systemic, but it is: every lane reported instances, and the league sits in
an offseason phase (RESIGN / FREE_AGENCY / DRAFT / PRESEASON) for most of the game year.
Three distinct failure modes, one rule each:

**(a) Never reserve a panel to say nothing.**
- `player/[playerId]` renders a full ~100px `No stats recorded yet this season.` panel for
  **every** player all offseason. On a free agent, Season and Career sit side by side, both
  empty — ~120px of two boxes apologising.
- `stats/page.tsx` shows `No stats recorded yet this season` and then, immediately below, the
  full Team Stats table with 32 rows of `0-0 / 0 / 0 / +0 / 0`. The empty state is inside the
  `withStats.length === 0` ternary; the Team Stats block is outside it, gated only on `!myTeam`.
- `cap/page.tsx` — the empty "Worst Value Contracts" panel is stretched by `grid lg:grid-cols-2`
  to match its 6-row neighbour, making a ~400px box containing one grey sentence the largest
  single object on the advanced view.

**Fix:** fall back to last season's line labelled `2026`; where there is no fallback, collapse
the section rather than reserving it; `items-start` (or single-column) on grids where one side
can be empty.

**(b) Never render last season's derived data inside this season's frame.**
- Dashboard standings show `0-0 / .000` for every team (records reset at rollover) alongside
  **last season's** last-five W/L squares and trend arrows: `Tampa 0-0 .000 ▲1 [W W L L]`.
  A team with zero games played showing four wins and "moved up 1" is self-contradicting.
- `roster/page.tsx` `productionLine()` returns `null` when `!s.gp`, so all 37 rows lose their
  stat line for the whole offseason. The Player column is ~340px wide and mostly empty, and the
  roster becomes pure attributes with no on-field evidence — on the page whose job is evaluating
  players.
- `schedule/page.tsx:36–37` passes each team's *live* record onto cards for all 17 weeks, so the
  Week 1 card reads `DETROIT 3-13 @ CHICAGO 12-4` — records that did not exist when that game was
  played. A Week 1 upset looks like a formality.

**Fix:** in non-`REGULAR` phases either label the panel `2026 Final` and show the finished data,
or drop `lastFive`/`delta` entirely. Prefix fallback stat lines `2026 ·`. Compute pre-game
records from prior played games, or drop records from played matchup cards entirely and show
them only on `Upcoming`, where they are true.

**(c) Empty states should say why and where to go.** The History page already nails this
("No completed seasons yet — finish a full season to start the history book"). Schedule in the
offseason is `SCHEDULE` + "No games scheduled yet." on 900px of nothing, when `league.phase` is
right there: *"The 2027 schedule is released once the offseason ends. You're in the Re-sign
Window — 3 contracts still need decisions."*

---

## A10 · Full-colour emoji in a near-black editorial UI ✅
**HIGH (aesthetic) · S (cheap version) / M (proper) · `lib/gmCareer.ts:163–206` · lane: system**

Fourteen GM badges ship emoji as their icon — 👑 🏆 📈 🔨 🔍 🎯 🧮 💸 🦈 🤐 🏷️ ⭐ 🆕 📋 — rendered at
`gm/page.tsx:47` as `<span className="text-2xl">`. `history/page.tsx:169` and `gm/page.tsx:96`
render 🏆 inline in a pill.

**What it costs the reader:** these are the only saturated multi-colour objects on the screen —
a cartoon abacus and a zipper-mouth face next to "Cap Wizard" and "Quiet Front Office". Nothing
in the product reads less like ESPN or a stadium scoreboard. It directly contradicts the system's
own written rule at `components/ds/icons.tsx:1–11`: *"One consistent line-icon style… no icon font
or emoji… Add new icons here rather than reaching for an emoji anywhere in the product."*

**Fix:** change `GmBadge.icon` from `string` to an icon key and add ~8 line icons to `ds/icons.tsx`
(trophy exists; several badges can share one), rendered at `currentColor` and tinted by tone.
**Cheap version that fixes 80% of the damage in ten minutes:** drop the glyph entirely and lead
each badge with its title in the display face. The badges read fine without an icon.

---

## A11 · Counts must come from `count()`, not from the page slice ✅
**HIGH · S · `free-agency/page.tsx:31`, `draft/page.tsx:81` · lane: transactions**

Verified against the database for league `cmt1vj55h06ju10drk5nrdkfq`:
**140 free agents exist; the page renders `100 AVAILABLE` as its `<h1>`.
400 draftees exist; the draft page says `PROSPECTS 300 · on the board` and `WELL SCOUTED 0 of 300`.**

Both pages take a `take: N` slice and then report `slice.length` as a total. On FA it also
poisons `affordable` ("WITHIN BUDGET 98") and the position pill row, which is derived from the
truncated slice — so a position with nobody in the top 100 by OVR gets no filter pill at all and
appears to have zero players. During a live draft the draft slice narrows to `take: 80`, making
the same claim about 400 prospects off a sample of 80.

**Fix:** `prisma.player.count()` on the unfiltered predicate for the masthead value; derive
`positions` from `groupBy(['position'])`, not from the slice. If the row cap stays, state it in
the table footer ("showing top 100 of 140 by rating") — never in the headline number.

---

# B. Per-page fixes

Ordered by page priority. Severity and effort per item.

## B1 · Dashboard — `app/league/[id]/page.tsx`

**B1.1 · HIGH · XS — the wire sorts last season's recaps above this week's news** ✅
Line 178 stamps games with `seasonYear: league.seasonYear` (2027) instead of the year they were
played (2026). The wire sorts `b.seasonYear - a.seasonYear || b.week - a.week`, so 2027/WK17
outranks 2027/WK1. On a brand-new league year the top three stories are last season's Week 15–17
recaps while this week's actual signings are pushed to the bottom in small type.
`Game.seasonYear` already exists (`prisma/schema.prisma:343`). **Fix:** `seasonYear: g.seasonYear`.
One word.

**B1.2 · HIGH · M — the franchise is the third block down and the smallest thing on the page**
Render order is `OffseasonRoadmap` (a `.card`, ~160px) → re-sign banner (a `.card`, ~95px) →
`TeamHeader` (~90px). "ATLANTA BLAZE" first appears at y≈513 of a 2043px page. The eye lands on a
generic bordered card with a five-segment progress bar before it ever finds the team.

*Cost:* the dashboard never introduces itself. There is no "this is my franchise" moment — the
opposite of the broadcast open the aesthetic is going for — and it puts two `.card` boxes at the
top of a page that is otherwise correctly section/panel-based. (System lane independently counted
**four different box languages** stacked in the first screenful: `card card-pad`, `card card-pad`,
`TeamHeader`'s own rounded surface, `panel`.)

**Fix:** masthead first, unconditionally, via `PageMasthead` (A4/A5). Put `OffseasonRoadmap` as a
full-width sub-strip immediately under it — see section D for why folding it *into* the fact
strip is the wrong call.

**B1.3 · HIGH · S — "re-sign window" is stated four times above the fold**
Simultaneously visible: the nav chip `RE-SIGN WINDOW / 2027 · Wk 1`; the roadmap's current stage
with its own description; a warn banner `RE-SIGN WINDOW OPEN / 14 players on your roster are
about to hit free agency`; and a `FrontOfficeBrief` Contracts item. ~350px of vertical space,
four visual weights competing, and the reader still has to work out they're the same thing.
**Fix:** delete the standalone banner. `FrontOfficeBrief` is purpose-built for this — add a
Contracts item `14 players are about to hit free agency` with a `Re-sign 14 →` action button.

**B1.4 · MEDIUM–HIGH · S — `featured` doesn't differentiate the lead story**
`.map((w, i) => w.render(i === 0))` only bumps the headline 14→18px and the logo 28→36px, but
rows 2 and 3 are also GAME rows carrying full multi-sentence recaps in `detail`. All three read
as walls of prose at near-identical weight — three paragraphs followed by three one-liners, not a
front page with a lead. **Fix:** `line-clamp-1` on `detail` for non-featured rows.

**B1.5 · MEDIUM · S — the right rail collapses, leaving ~950px of empty column**
Since Storylines was added, the `lg:col-span-2` left column runs to y≈1990 while the rail ends at
y≈1030. **Fix:** move Standings + Roster Needs into a full-width band under the header (where
they read as scoreboard furniture), or move Storylines into the rail.

**B1.6 · MEDIUM · S — Roster Needs reads as five identical problems**
All five entries are O-line (`RG / LT / LG / C / RT`), four literally the word "Moderate" with
visually identical bar widths. The bar and the label encode the same value twice, with no
incumbent and no current OVR for context. It reads as a bug, not a finding.
**Fix (display):** collapse contiguous same-severity runs into `O-LINE · 4 spots at Moderate`,
and put the incumbent's name/OVR where the redundant severity word currently sits.
**Before doing that,** check whether the needs calculation is actually right — an entire O-line
flagged Moderate may be a sim issue, not a rendering one (see section D).

**B1.7 · LOW · XS — "Browse →" points at Free Agency during the re-sign phase.** Make it
phase-aware: `/resign` in RESIGN, `/free-agency` in FREE_AGENCY, `/draft` in DRAFT.

**B1.8 · LOW · S — three consecutive `RECORD WATCH` storylines** with identical gold eyebrow,
shape and sentence template read as a repeated stub. Cap same-category runs at two, or merge
them into one Record Watch block with three lines under a single kicker.

## B2 · Depth Chart — `app/league/[id]/depth-chart/page.tsx`

**B2.1 · HIGH · S — a departed player's stale slot deletes the starter and breaks the numbering** ✅
`orderByPosition` (line ~22) is built from `slots` **without checking the player is still on the
roster**. `DepthChartGroup` filters the missing player out at render but numbers by the
*unfiltered* index and applies starter styling to `idx === 0`.

Verified in the database: the user's team has two orphaned slots — `TE rank 0 → Isbell` and
`QB rank 2 → Verhoeven`, both with `teamId IS NULL`. The rendered TE group therefore shows rows
numbered **2, 3 with no #1 and no starter highlight** — the highlight went to the invisible row.
On a page whose subtitle is literally "Set who starts. The sim engine uses this order every game."

**Fix:** filter `ranked` to ids present in `byPosition[pos]` when building `orderByPosition`.
Worth a cleanup pass on orphaned `DepthChartSlot` rows too.

**B2.2 · HIGH · S — the metric strip raises alarms the page cannot resolve, one permanently false** ✅
- `UNMANNED 1` in red — but empty groups are filtered out of the grid
  (`POSITIONS.filter((pos) => byPosition[pos].length > 0)`), so there is **no way to discover
  which position it is**. It is FB, which most teams never roster. This red alarm will be lit for
  essentially every team forever, training the player to ignore the entire strip. Same class as
  the already-fixed K/P roster-needs bug (task #19).
- `NO BACKUP 7` — computed as `length === 1`, so it flags LT/LG/C/RG/RT/K/P, **none of which is
  marked in the grid**; you would have to count 16 cards to find them. Two of the seven (K, P)
  are structural singletons that can never have a backup.
- The sibling Roster page uses different logic for the same question
  (`groupRows.length <= startingSlots`) and gets a different answer. Two pages, same data,
  different verdicts.

**Fix:** exempt FB/K/P; render empty groups explicitly (`FB — nobody rostered`) so the count is
reachable; put a visible marker on the affected groups; share one depth-health helper between
Roster and Depth Chart. (The roster's own `thin={groupRows.length <= startingSlots}` false-positives
on Special Teams every time — K + P is always `2 <= 2` — same fix.)

**B2.3 · HIGH · L — sixteen boxed cards in a 3-column grid, the exact pattern the system rules out**
`grid md:grid-cols-2 xl:grid-cols-3` of `.panel p-4` blocks whose rows equalise to the tallest
member. Measured: the 2-row QB panel is stretched to the height of the 5-row WR panel; each of
LT/LG/C/RG/RT holds **one** row in a ~145px box; K holds one row in a 250px box. Roughly **40% of
the grid area is empty panel interior.** This is "boxes-in-boxes / a wall of rounded cards" verbatim.

Compounding it, the groups have no unit structure: raw `POSITIONS` order flowed into three columns
produces the reading order QB, RB, WR / TE, LT, LG / C, RG, RT — skill players and linemen
interleaved across rows — with **no Offense/Defense/Special Teams banners at all**, while the
Roster page showing the same 37 players *does* group by unit.

**Fix:** drop the per-position box. `.section` + `SectionHeading` per **unit**, each position a
bare labelled list separated by `.divider` rules. Rows sit at natural height, the page roughly
halves in length, and it matches the Roster page's spine. This is the largest single job in the
audit and the one that most changes whether the app reads as a broadcast product or an admin
dashboard.

**B2.4 · MEDIUM · S — `Starter OVR 82.4` includes the kicker and punter.** ✅ `starterOvrs` maps
over all `POSITIONS`, so the 96-OVR kicker and 81-OVR punter are averaged in with the eleven-on-eleven
starters. The detail line "average across the ones" is also insider jargon. **Fix:** exclude K/P;
say `average of your 22 starters`.

**B2.5 · MEDIUM · S — reorder controls are ~700px from the name they move.** The ▲▼ buttons sit at
the row's far right; in the wider XL columns that is a long empty span from a left-aligned name,
making it easy to nudge the wrong row. Move them adjacent to the rank number at the left edge.

**B2.6 · LOW · XS — the OVR is the smallest text in the row** (`stat-value text-xs`, ~10px, vs a
14px name). On a page built for comparing players, the number you compare on is the least legible
element. `text-stat-sm` minimum.

## B3 · Roster — `app/league/[id]/roster/page.tsx`

**B3.1 · HIGH · S — 37 identical green "Active" pills.** Every healthy player gets
`pill border-accent/30 text-accent bg-accent/10`, forming the brightest vertical stripe in the
table and carrying exactly zero information — the masthead already says `ROSTER SIZE 37 / all healthy`.
It out-shouts OVR and Potential, the two columns actually being scanned, and inflates every row's
height. **Fix:** render nothing when healthy; only injured players get a pill. Better, move injury
into the name cell as a red dot + weeks and reclaim the column for depth rank or an expiring flag.

**B3.2 · HIGH · S — during a re-sign window the 14 players who actually walk are indistinguishable** ✅
Verified: 14 players have `yearsRemaining = 0`; 28 have `<= 1`. The Roster masthead shows
`EXPIRING 28 / deals up within a year`; the dashboard banner one click away says
`14 players on your roster are about to hit free agency`. Two adjacent screens, two answers to
the same question. (The Re-sign page gets it right — it shows both `Decisions 28` and
`Already Expired 14`.) In the table, `Years Left = 0` renders as a plain muted digit visually
identical to `1`, so the most urgent cell on the page during the current phase is the flattest
thing in the row. **Fix:** match the re-sign page's two-number framing in the masthead; give
`Years Left 0` a `text-warn` treatment plus a re-sign affordance in the row.

**B3.3 · MEDIUM–HIGH · S — the unit banner is quieter than the group header beneath it.**
`OFFENSE` renders at 11px in 60%-opacity muted with no background (2.99:1 — see A3); `QUARTERBACK`
immediately beneath it renders bolder on a `bg-raised/40 border-y` band. **The parent level is
visually subordinate to its child**, so the offense/defense/special-teams spine — the thing that
makes 37 rows read as a squad rather than eight unrelated lists — is the first structure to
disappear when you scan. **Fix:** give the unit banner the heavier treatment (full-width rule,
display face, wide tracking, more space above) and lighten `RosterGroupHeader` to a text-only row,
so only one level carries a background.

**B3.4 · MEDIUM · XS — "Special Teams" prints twice, 35px apart.** `UNIT_FOR_GROUP.ST` and
`GROUP_LABEL.ST` are the same string, rendered stacked. Skip the unit banner when it is the only
group under it or when the strings match.

**B3.5 · MEDIUM · S — `Roster Size 37` has no baseline.** 37 out of what? The `Fill Roster` button
in the masthead's action slot implies a target the number never states. `37 / 53` with
`16 spots open` as the detail is what makes the button legible as an action rather than a debug tool.

**B3.6 · LOW · S — Potential is the flattest column on a dynasty page.** `text-muted font-mono`
renders an 85/99 the same as a 22-year-old's 52. Show upside as a delta (`85 → 99`, or `+14`) and
colour the *delta*, so growth room pops rather than the raw ceiling.

*(Roster's `productionLine()` offseason blackout is A9(b); the raw-team-colour "Starter" tag is A3;
the `thin` false positive on ST is B2.2.)*

## B4 · Draft — `app/league/[id]/draft/page.tsx`

**B4.1 · HIGH · S — consensus rank changes when you apply a position filter** ✅
`classForRank` (line ~105) reuses `rows` — the `take: 300` slice (or `take: 80` during a live
draft) — in the unfiltered branch, but re-queries with `take: 500` in the filtered branch. The
comment directly above promises the opposite: *"computed over the WHOLE class regardless of any
position/shortlist filter… so '#1 overall' means the same thing no matter which slice."*
Measured: Silas Castellanos 151 → 157; Carter Okafor 281 → 369; Trent Ingram 300 → 400.
*Cost:* the Rank column is the board's single most authoritative number and it silently renumbers
under you. **Fix:** always compute `classForRank` from the same full-class query. One query, one
ranking, both branches.

**B4.2 · HIGH · S — sorting by "Scouted" produces a visibly unsorted column** ✅
The column *displays* `ovrLow–ovrHigh` but `case 'ovr'` sorts by the hidden `view.scoutedOvr`
point estimate. At `?sort=ovr&dir=desc` the column reads `82-99, 82-98, 80-98, 79-99, 80-98,
77-98, 81-96…`. With `WELL SCOUTED 0 of 300`, every range is 16–30 points wide, so the mismatch is
the norm. Same pattern at `free-agency/page.tsx:70`. **Fix:** sort on the displayed value —
`ovrHigh` for "best upside first", or the midpoint — and label the header accordingly. If the
point estimate must drive it, put it on screen: `74 ±11` rather than `63-85`.

**B4.3 · HIGH · S — scouted ranges are colour-coded by that same hidden estimate** ✅
`ratingColor(view.scoutedOvr)` at `draft:318` and `free-agency:155`. On FA, `Wes Bledsoe 67-91`
renders **green** (elite tier) while `Elias Doyle 71-79` renders **blue**, because the midpoint
decides. A reader scanning by colour concludes Bledsoe is better, when the ranges say "we have no
idea about Bledsoe and a firm read on Doyle." Colour is the highest-bandwidth channel on a 100-row
table and here it asserts precision the number explicitly denies — worse than no colour.
**Fix:** when `!view.revealed`, drop to neutral `text-chalk/70`, or encode *confidence* (dim = low)
rather than tier. `ScoutingRange` already does this correctly in the Top Available panel; match it.

**B4.4 · LOW · S — rank badges duplicate the Rank column on 32 consecutive rows.** Row 11 reads
`11 … [Top 32]`; row 20 reads `20 … [Top 32]`. Only `#1 Consensus` says anything the rank column
doesn't. Keep the badge for rank 1 (or tint the rank number by tier) and reclaim the horizontal
space — the college name is currently crushed against it.

**B4.5 · LOW · S — the `Potential` column carries no signal at current confidence** (`79-99`,
`78-99`, `79-99`, `74-99` down nearly the whole board). Hide it until confidence crosses a
threshold, or show range *width* as an uncertainty bar instead of two numbers.

**B4.6 · LOW · XS — the `Class Outlook` banner renders above the masthead,** so the draft page is
the only one in its nav section that doesn't open with its own identity.

## B5 · Player Card — `app/league/[id]/player/[playerId]/page.tsx`

**B5.1 · HIGH · S — the attribute bars carry no information for a revealed player.**
`style={{ left: `${a.low}%`, width: `${Math.max(2, a.high - a.low)}%` }}` — for an own-roster
revealed player `low === high === actual`, so the range band renders as a 2%-wide nub plus a 2px
tick. Nothing is proportional to the value: Agility 66 and Stamina 98 produce visually identical
rows. *Cost:* the Attributes panel is the tallest block on the page and it is a number list
wearing a chart costume; you must read all thirteen digits to learn anything. **Fix:** when
`view.revealed`, render a solid fill from the scale floor to the value (reuse `ScoutingRange`'s
40–99 mapping); keep the low/high band only when there is a real range.

**B5.2 · HIGH · XS — colour is inverted for bad attributes** ✅
`lib/ratings.ts:149–155` — `ratingColor` returns `text-muted` (`#93939c`) below 58. On a free
agent's card, **Durability 21-31** — the single biggest red flag on a player you are about to hand
$39.4M — renders in the app's "ignore this" grey, while Zone Coverage 74-84 is bright green. On a
dark theme, muted grey means *de-emphasised*, not *bad*. Note that `gradeLabel` **twenty lines
above in the same file** correctly returns `text-bad` for the same band, so the file already
disagrees with itself. **Fix:** give sub-58 its own visible treatment (`text-bad`, or a red fill).
Reserve grey for *unknown/unscouted*, never for *terrible*.

**B5.3 · HIGH · S — a free agent's hero fact strip is four-fifths dead.** For
`status === 'FREE_AGENT'` the five tiles render `CAP HIT 2027 $0 / 0.0% of cap` · `MARKET VALUE
$9.80M/yr` · `YEARS LEFT — / no contract` · `GUARANTEED —` · `RELEASE COST $0 / clean cut`.
"Release Cost — clean cut" on a player you do not own is nonsense. *Cost:* the most prominent band
on the page — the one deliberately built to consolidate "the questions you came here to answer" —
answers none of them for a free agent. **Fix:** branch `heroFacts` a third way for
`FREE_AGENT && !isDraftee`: Market Value · Competing Offer · Your Cap Space · Your Depth Rank at
his position · Age.

**B5.4 · HIGH · S — the competing-offer alert is the whole decision and it's 1100px down.**
`components/SignOfferForm.tsx:72`'s `Dallas Wildcatters is in the mix at ~$12.2M/yr — you need to
beat that.` is the single most decision-relevant sentence on the page, and it sits at y≈1123
inside a panel, below two empty stat boxes. **Fix:** hoist it into the hero as a full-width
warn/bad band directly under the name, before Attributes.

**B5.5 · HIGH · S — contract numbers printed twice, ~900px apart.** The hero strip shows
`Cap Hit 2027 $11.6M (4.6%)`, `Years Left 1`, `Guaranteed $26.1M`, `Release Cost $1.74M`; the
Contract panel then repeats `$11.6M CAP HIT THIS YEAR` as a `stat-lg` (the second-largest number
on the page), `Guaranteed $26.1M`, and `1 yr remaining of 5`. Three of its four figures are
verbatim duplicates. The code comment says the strip exists so the money questions are "answered
together instead of scattered down the page" — but the old panel was never trimmed, so the page
now does both. **Fix:** reduce the Contract panel to what the strip can't carry: the year-by-year
bar, remaining value, void years, and the action buttons.

**B5.6 · MEDIUM · S — the two stacked range panels are indistinguishable, and meaningless when
revealed.** On a draftee, `SCOUTED OVR 80-98 / Confidence: LOW` sits directly above
`POTENTIAL 79-99 / Confidence: LOW` — same width, same bar colour, same word repeated; you cannot
tell at a glance which is which. On a revealed player it is worse: Potential renders as **`89–89`**
with a zero-width bar and `Confidence: HIGH`. That a player's OVR *equals* his potential — no
growth left, the most important dynasty fact about him — is disguised as a range widget that says
nothing. **Fix:** for revealed players show a single number with an explicit upside read
(`+0 · at ceiling`); for scouted players differentiate the two panels and state confidence once
for the card.

**B5.7 · MEDIUM · XS — a lineman's best stat is filtered out of his own headline.**
`collegeHeadline`'s `.filter(([, v]) => v > 0)` deletes `sacksAllowed: 0` — the best possible
outcome and the headline number for an OL — leaving a hero strip with one lonely `PANCAKES / 6`.
**Fix:** filter absent data, not zero values, for stats where low is good (`sacksAllowed`,
`passInt`, fumbles). A zero there is the story.

**B5.8 · MEDIUM · S — the draftee page repeats itself four times over.** On one screen:
"Kettle Falls" ×4 (meta line, Draft Class detail, section title, Measurables context);
`6'8" / 314 lb` ×2; `Competition: B-tier` ×2; `through week 1 of 13` ×2. Two of five hero tiles
duplicate the line 40px above them. **Fix:** the meta line already owns identity — drop
Measurables and the college detail from the fact strip and spend those tiles on projected round,
positional scarcity, or the depth-at-position read currently at the bottom of the page.

**B5.9 · MEDIUM · S — the 4-child two-column grid produces ragged, half-empty columns.**
`grid sm:grid-cols-2` wrapping Season / Career / Depth / Contract pairs an empty Season panel with
a tall Career panel (~120px dead), and on a free agent pairs a 3-row `Your Depth at S` (~180px)
with the ~650px `SignOfferForm` (**~500px of empty left column**). **Fix:** give the tall
interactive block its own full-height column and stack the short read-only blocks in the other.

**B5.10 · MEDIUM · XS — the primary CTA turns red exactly when you most want to press it.**
`SignOfferForm.tsx:164` — `beingOutbid ? 'btn-danger' : 'btn-primary'`. `btn-danger` is this app's
destructive treatment; it is what **Release Player** uses on this same page. Rendering
`Offer Contract (Currently Losing)` in that red conflates "this will hurt you" with "you're behind
on the bid." **Fix:** keep `btn-primary`. The red already lives, correctly, in the competing-offer
alert.

**B5.11 · MEDIUM · XS — the card is 208px narrower than its siblings.** ✅ Inside the same
`max-w-7xl px-6` shell: dashboard/roster/depth-chart all 1232px, player 1024px
(`space-y-6 max-w-5xl` at line 182), left-aligned — so clicking a roster row visibly narrows the
page and opens a 200px right gutter. **Fix:** match the shell width, or if the narrower measure is
deliberate, `mx-auto` it and apply the same measure to the other detail pages. Either is one token.

**B5.12 · LOW · XS — the contract year bar's fill reads backwards.** A 5-year deal with 1 year
left renders as four `bg-line` segments then one `bg-accent` — a progress bar that looks 80%
complete in the un-emphasised colour. Invert, or label the two states.

**B5.13 · LOW · XS — `(this player)` is redundant** on a row already carrying `bg-accent/10`, an
accent border and bold text.

**B5.14 · LOW · S — no way back.** No breadcrumb to the roster / draft board you arrived from;
the global nav lands you on Roster regardless of origin.

## B6 · Re-sign — `app/league/[id]/resign/page.tsx`

**B6.1 · HIGH · S — "Cost To Keep All" is compared against a cap-space number that already
includes it** ✅
`currentCost` (line 33) sums `capHit` over `expiring`, which is
`{ teamId: team.id, status: 'ACTIVE', contract: { yearsRemaining: { lte: 1 } } }`.
`teamCapSummary` (`lib/cap-summary.ts:26`) computes `activeSalary` over **all ACTIVE players on the
team** — which is a strict superset. So the $134.2M is already inside the committed total that
produced the $15.8M cap space, and the masthead colours the tile `text-warn` because
`currentCost > capSpace`. Keeping them all at their current numbers costs **$0 of additional space.**

*Cost:* it is the page's headline judgement and it is backwards. It tells a GM he is $118M short
of a decision that costs him nothing. `ResignRow` gets this right — it passes
`availableSpace = capSpace + (that player's own hit)`. Only the masthead is wrong.

**Fix:** relabel to `Committed to expiring deals $134.2M — comes off the books`, and add a separate
`Est. cost to retain all` built from `marketValue()`, which is the number that actually competes
with cap space.

**B6.2 · MEDIUM · S — 28 stacked boxes, no group boundary, no sort.** Each row is a `ResignRow`
`.panel` with a gap between — precisely the wall of rounded cards the system says to avoid, on the
one page where `.section` + divided rows fits best. The ordering *does* carry meaning
(`yearsRemaining asc` puts the 14 already-expired above the 14 walk-year) but nothing marks the
boundary; the reader has to notice a red pill became an amber pill at row 15. It is also the only
page in the transactions lane with no sort and no filter at all.
**Fix:** one `.panel` with `divide-y divide-line/60`, split by two `SectionHeading`s that name the
actual decision — *"Expired — decide now (14)"* / *"Walk year — extend early if you want (14)"* —
and add the shared sort control from A7 (by OVR / current APY / age).

## B7 · Trade — `app/league/[id]/trade/page.tsx`, `components/TradeBuilder.tsx`, `components/PendingTradeOffers.tsx`

**B7.1 · HIGH · S — `Accept` is one irreversible click, and it is not deadline-aware** ✅
Three problems in one row of `PendingTradeOffers.tsx:48–52`:
- `Accept` is `btn-primary`, fires `respondToTradeOfferAction(…, true)` immediately, and executes a
  real multi-asset trade. **Every other irreversible action in this lane has a confirm step** —
  `ResignRow`'s "Not Re-sign", `CutButton`, `LetAiResignButton`, and the builder's own
  Propose → Confirm & Execute. This one does not.
- `Review` and `Decline` are both `btn-secondary` — the safe exploratory action and the
  offer-killing action are visually identical and adjacent.
- The component takes no `deadlinePassed` prop. On the live page the deadline **has** passed, the
  builder correctly shows an amber banner and a disabled `Deadline Passed` button, and directly
  above it sits a fully-enabled green `Accept`. `respondToTradeOfferAction` (`app/actions/trade.ts:36`)
  `throw`s a raw `Error` that nothing catches, so the click lands on an unhandled server-action
  error rather than a message.

**Fix:** pass `deadlinePassed` through and disable Accept with the same label; make Accept a
two-step that restates what leaves the roster; demote `Decline` to `btn-ghost` so `Review` reads
as the default path.

**B7.2 · MEDIUM · S — draft-pick pills give a 2027 R1 and a 2029 R7 identical weight, above the
roster.** 21 identical `.pill`s per side, four wrapped rows, ~120px tall, rendered **before** the
search box and the roster. Round is buried inside the label (`2028 R5`) at the same size and
colour as everything else; `(proj. #29)` — the only real value signal — is `text-[10px] opacity-70`.
Draft capital is the currency of this screen and it renders as an undifferentiated blob.
**Fix:** group by year; let round drive weight (R1/R2 get a brighter border and a readable
projected slot, R5–R7 collapse behind "+11 late picks"); move the block below the roster.

**B7.3 · MEDIUM · S — deadline-passed leaves the whole builder live but inert.** `deadlinePassed`
gates only the Propose and Confirm buttons; `TeamPanel` never receives it. You can toggle every
pick and roster row and watch `Your cap space after` recompute, then find the only button that does
anything says `Deadline Passed`, 500px below the amber banner and out of eyeline. **Fix:** move the
deadline notice adjacent to the disabled action so the explanation and the dead control are one
object (preferable — the banner explicitly says you can still browse), or dim the panels.

**B7.4 · LOW — polish.** `TradeBuilder` position select is `w-20`, clipping `All Pos` → **`All Po`**
on both panels · `0 asset(s) out · 0 asset(s) in` ships a literal `(s)` · `PhilosophyBadges` puts a
`?` circle on each of three adjacent pills — six glyphs for three facts; one on the group would do ·
masthead fact `TRADES MADE 0 · graded below` promises a section that renders nothing
(`TradeRetrospectives` returns `null` at zero) · `CAP SPACE $15.8M · before any deal` in the
masthead and `Your cap space after: $15.8M` in the action bar with nothing selected; dim the
"after" figure until a selection exists.

## B8 · Free Agency — `app/league/[id]/free-agency/page.tsx`

*(Truncated count is A11; hidden-estimate sort and colour are B4.2/B4.3, which apply identically here.)*

**B8.1 · MEDIUM · M — the page gives no reason to prefer one player over another.** 100 rows, each
ending in an identical `Negotiate` button, ordered by rating. Nothing says which positions this
roster needs, how many spots are open, or whether anyone else is bidding — even though
`components/ds/RosterNeeds.tsx` already exists (used on the dashboard) and `lib/freeagency.ts:42`
already exports `leadingCompetingBid`, surfaced through `app/actions/roster.ts:59`. The masthead's
`WITHIN BUDGET 98` is technically true and practically useless: 98 of 100 are affordable, so the
filter that would matter isn't offered. **Fix:** drop `RosterNeeds` beside the position pill row
and mark need-positions in the `Pos` cell; add a `Within budget` toggle; show the competing bid in
the row — that is the number that decides whether a fair offer wins.

**B8.2 · LOW · XS — the `<h1>` is a filtered row count.** `100 AVAILABLE` becomes `7 AVAILABLE`
when you filter to QB, so the page's largest text doesn't identify the page, and it sits directly
above `ON THE MARKET 100` in the fact strip. `BEST AVAILABLE 71-79 · S · Elias Doyle` likewise
duplicates the Top Available panel immediately beneath it. **Fix:** `<h1>` = `Free Agency`; delete
the `BEST AVAILABLE` fact; counts live in the strip, which already has them. (See B18 for the
general masthead-grammar rule.)

## B9 · Standings — `app/league/[id]/standings/page.tsx`

**B9.1 · HIGH · XS — the eight divisions render in arbitrary, conference-interleaved order** ✅
Line 8: `prisma.team.findMany({ where: { leagueId } })` with **no `orderBy`**, so the `groups` Map
takes raw DB row order. Observed: AFC East, NFC North, AFC South, NFC West / AFC North, NFC South,
AFC West, NFC East — and a *different* order on a second league. *Cost:* this is the page whose one
job is "read the league at a glance," and you cannot scan a conference; to see the AFC you read
boxes 1, 3, 5 in the left column and 1, 3 in the right. Two readings of the same page can differ.
**Fix:** `orderBy: [{ conference: 'asc' }, { division: 'asc' }]`, and lay out as two conference
columns with an `AFC` / `NFC` `SectionHeading` and divisions in fixed East/North/South/West order.

**B9.2 · HIGH · XS — every team name links to *your* roster** ✅
Line 47: `href={`/league/${league.id}/roster`}` inside the per-team `<Link>`. Clicking "Houston
Stingrays" navigates to the Atlanta Blaze roster. All 32 rows point at the same page. A link that
lies, on the single most obviously clickable thing on a standings table. Same defect at
`stats/page.tsx:395`, where team names link to `/standings`.
**Fix:** remove the `<Link>` (the roster page is user-only), or point at
`/league/{id}/schedule?team={t.id}`, which is a genuinely useful landing.

**B9.3 · MEDIUM · M — no playoff picture at all.** No seed line, no clinch/eliminated marker, no
conference standings, no win %, no streak, no point differential. `t.playoffSeed` renders a gold
`#n` only if already populated (it isn't during the regular season), and
`computeClinchStatus`/`clinchScenarioTag` — already called by the dashboard — are never imported
here. At Week 17 of a 2-14 season the standings page cannot tell you whether you're eliminated.
In a football sim, the playoff race *is* the standings page. **Fix:** add `PCT` and `DIFF`; stamp
`x`/`y`/`z`/`e` next to records with a one-line legend; draw an accent rule after the last
in-playoff seed in each conference column.

**B9.4 · MEDIUM · S — the rank-delta column is 30 rows of em-dash under a blank header.** The `<th>`
is empty and `computeRankDeltas` only fires in `REGULAR` phase, so the offseason shows 32 dashes;
even at Wk 17 it is 30 dashes and 2 arrows, because movement *within a 4-team division* is almost
always zero. An unlabelled column consuming the leftmost, highest-attention position in eight tables
to say "nothing happened" thirty times. **Fix:** compute the delta against **conference seed**, not
division rank — that moves weekly and is what a GM watches — render the cell empty (not `—`) at
zero so the arrows that do appear pop, and label it `MOV`.

## B10 · Schedule — `app/league/[id]/schedule/page.tsx`

**B10.1 · HIGH · M — one 16,185px page dumping all 272 games with no week navigation.** Every week
renders at once, 16 `MatchupCard`s per week in a 2-col grid, `label-sm "Week n"` as the only
separator. No week selector, no scroll-to-current-week, no "my team only" toggle, and your own
team's games are visually identical to the other 15. To see the game you play next you scroll past
~250 irrelevant results — the page is unusable for the one question anyone brings to it.
**Fix:** `?week=` defaulting to `league.week`, with a horizontal week strip (1…17 + playoff rounds)
as the primary control — the pill row already exists as a pattern on News. Add a `My Team` scope
toggle. Keep the full dump behind an explicit "All Weeks". **Minimum viable:** tint your own team's
card border with `--team-accent` so it is findable.

**B10.2 · MEDIUM · XS — the winner of a final is not visually distinguished.** `DETROIT 13` and
`CHICAGO 52` render in identical white at identical weight. Every broadcast scorebug in existence
brightens the winner and dims the loser. **Fix:** on `weekLabel === 'Final'`, drop the losing side
to `text-muted`, keep the winner at `chalk`, add a caret or filled bar on the winning side. This is
the cheapest possible change with the biggest read-speed gain on a page of 272 scores.

**B10.3 · LOW · XS — unplayed games are wrapped in a dead link.** `href={g.played ? … : '#'}` jumps
to the top of the page and puts `#` in the URL. Render the unplayed card as a plain `<div>`.

*(Stale records on played cards are A9(b); the offseason empty state is A9(c).)*

## B11 · Stats — `app/league/[id]/stats/page.tsx`

**B11.1 · HIGH · S — Advanced shows your team's numbers under the "League" scope, unlabelled.**
The `MetricTiles` strip (Pythagorean W-L, Luck, Point Differential, SOS) is built from `myPythag`
and `mySos` and renders whenever `advanced` is true, regardless of scope. At `?view=advanced` with
the **League** pill lit, the page reads: heading `LEAGUE STATS — 2026`, then
`PYTHAGOREAN W-L 2.9-13.1 / actual 2-14`. Nothing on those four tiles says "you". *Cost:* the most
prominent numbers on the Advanced view are silently mis-scoped; a reader coming off a page titled
"League Stats" reads 2.9-13.1 as a league figure. **Fix:** gate the tiles behind `myTeam`, or keep
them in both scopes with the team crest and abbreviation in the strip's eyebrow — `ATL · Season
Profile` — so they are visibly a team readout inside a league page.

**B11.2 · HIGH · S — four filter pills in two anonymous stacked rows conflate two orthogonal axes.**
`League | My Team` sits directly above `Basic | Advanced`, right-aligned, both rows in identical
`.pill` styling with identical active treatment and no labels. Nothing indicates these are
independent switches; visually it is one four-option group broken across two lines — and `scope`
changes *what data* while `view` changes *how much analysis*, so you can hold either constant.
**Fix:** one row, two visibly separate segmented controls (A7b), each with a `label-sm` — `SCOPE` /
`DEPTH` — in `PageMasthead`'s `action` slot, matching `cap/page.tsx:206`.

**B11.3 · MEDIUM · M — "Full Roster Stat Line" is a table whose columns mean something different on
every row.** The header is `Player | Pos | Efficiency (colSpan 5)` and each row emits its own
`nerdyLine()` label/value pairs into those five cells: column 3 reads `Playmaker (INT+PD)` on an S,
`Cmp %` on a QB, `YPC` on an RB, `FG %` on a K. Rows are in raw DB order so positions are shuffled;
rows with 3 metrics leave ~35% of the width ragged; the repeated inline label is heavier ink than
the number it labels; and the numbers use `font-mono text-sm` with no `.stat-value` anywhere on the
page's flagship table. *Cost:* you cannot compare any two players on anything. It looks like a
table, promises a table's affordances, and delivers key-value pairs in a grid.
**Fix:** group by position with `RosterGroupHeader` (already in `ds/`) and give each group a real
`<thead>` so columns are stable within the group — QB gets `Cmp% | Y/A | TD% | INT% | Rating`, WR
gets `Catch% | Y/R | Y/Tgt | TD`. The labels stop repeating on 53 rows and the numbers become the ink.

**B11.4 · MEDIUM · S — two competing header languages inside one page.** The three chart panels use
`<h2 className="font-semibold">` (default sans, sentence case, no divider); every other block uses
the hand-rolled `px-4 py-3 border-b border-line/70 label-sm`. Neither is `SectionHeading`. Pick one
— this is exactly what A7c's `DataPanel` is for.

**B11.5 · MEDIUM · M — Advanced is additive rather than alternative, producing a 5,827px page.**
The `advanced &&` blocks are inserted *above* the full Basic content, which still renders in its
entirety: 4 metric tiles + 32-row luck table + 3 charts + 7 leader tables + 32-row team table on one
scroll. "Advanced" reads as "everything, plus more" rather than a different lens, and nobody
scrolls to the bottom. **Fix:** needs a product decision — see section D.

**B11.6 · MEDIUM · S — the scatter chart carries almost no information.** 32 identical grey dots,
one blue, no tick values on either axis, no team labels or crests, no quadrant labels. The tooltip
explains "top-left is the most complete quadrant" — discoverable only by hovering a `?`. It occupies
half a two-column grid and reads as a grey cloud. **Fix:** label the quadrants on the plot at low
opacity, add tick values, colour each dot with its team's accent, crests on the four extremes. Or
drop it — the Luck Table above already delivers the same insight with more precision.

**B11.7 · LOW · S — the Passer Rating panel is half empty** (8 bars against an equal-height scatter,
~250px dead), and all 8 bars are hardcoded `#3987e5` (line 149) rather than the passer's team accent.

## B12 · Cap — `app/league/[id]/cap/page.tsx`

**B12.1 · HIGH · M — the page shows the exact number a cut decision needs and offers no way to cut.**
The Contracts table's last column is literally `Cut: Savings / Dead` with a tooltip explaining "what
cutting this player right now would do to your cap." Then nothing. `CutButton` exists but is mounted
only on the player page (`player/[playerId]/page.tsx:502`), and its confirm step shows **no dead-money
figure** — the number is only on the page you just left. **Fix:** a per-row release affordance
opening an inline confirm that restates `savings` and `dead`. At minimum, pass the two figures into
`CutButton`'s confirm state.

**B12.2 · MEDIUM · S — the Advanced charts have no axis values at all.**
`components/charts/ScatterChart.tsx:63–64` and `LineChart.tsx:92–95` draw only the axis *title*,
plus (line chart) the first and last x label. "Multi-Year Cap Outlook" is a descending line from
2027 to 2030 with no y values and no 2028/2029 labels; "Cap Hit vs. Overall Rating" is a cloud with
unreadable coordinates on both axes. Values are hover-only. *Cost:* the outlook chart exists to
answer "how much room do I have in 2029" and that is unanswerable without hovering four times.
**Fix:** 3–4 y ticks with `formatY` and a faint gridline each; label every x point on a 4-point
series. For the outlook specifically, consider replacing the line with a 4-column year strip — with
four points a line adds shape but costs precision.

**B12.3 · MEDIUM · XS — the scatter renders at 640px inside a 1200px panel.** `ScatterChart.tsx:40`
pins `width = 640, height = 340` with `viewBox="0 0 640 340"`, `className="w-full"` and
`style={{ height: 340 }}`. Default `preserveAspectRatio` scales the viewBox to fit the pinned
height, so the drawing stays 640px wide and centres, leaving ~280px of dead panel each side and
crushing the point cloud into a third of the available resolution. **Fix:** drop the fixed pixel
height and use `className="w-full h-auto"`, or accept a `width` prop.

**B12.4 · LOW · S — the `Cap Usage` panel restates two numbers it already showed.** Its right label
reads `$239.2M active salary` while the fact strip 60px above reads `COMMITTED $239.2M`, and the
bar's only other content (94%) is already in `CAP SPACE`'s detail. The bar has no scale, no limit
tick, no labels. **Fix:** delete it, or make it earn the space — segment the bar by position group
(using A8's shared map) and mark the cap limit and dead-money share.

**B12.5 · LOW · XS — negative "savings" is a cap *cost* labelled as savings.** The cell renders
`-$4.17M / $19.7M` in red-and-red under a header that says "Savings." **Fix:** when `savings < 0`,
render the word — `Costs $4.17M` (red) `· $19.7M dead` (muted red) — or rename the column
`Cut Impact` with explicit `+`/`−`.

## B13 · News — `app/league/[id]/news/page.tsx`

**B13.1 · MEDIUM · S — the wire has no time structure.** 80 items in a flat `divide-y` list, each
stamped `Yr 2026 Wk 16` in 11px mono at the far right — ~1,900px from the headline it belongs to.
The sort is `createdAt desc` while week is a separate field, so the visible stamps also jump (first
item Wk 5, then six Wk 16s). 7,176px tall, no pagination, no indication it is truncated at 80.
*Cost:* a transaction wire whose primary axis is time doesn't show time; you cannot answer "what
happened this week". **Fix:** group by `seasonYear`/`week` with a sticky `SectionHeading` per week
(`WEEK 16 · 2026`), drop the per-row stamp, add a "Load older" control or season selector.

**B13.2 · MEDIUM · S — ten heterogeneous filter pills in one flat row, three categories missing.** ✅
`FILTERS` mixes transaction types, injury events, honours and stat trivia at one visual level with
no counts, so you cannot tell which filters have anything behind them. Verified: `FILTERS` omits
`RESIGN`, `TAG`, and all five `AWARD_*` types that exist in `TYPE_LABELS` — award news appears
under All and **cannot be filtered to**. **Fix:** three labelled clusters (A7b) — `ROSTER MOVES`
(Trades, Signings, Re-signs, Tags, Releases, Draft) / `ON THE FIELD` (Injuries, Performances,
Development) / `HONOURS` (Championships, Awards, Firings) — with a count on each pill, and add the
missing types.

**B13.3 · LOW · XS — category colour is extracted by string index.** ✅ Line 72:
`TYPE_STYLE[item.type].split(' ')[1]` fishes the text colour out of
`'border-accent2/30 text-accent2 bg-accent2/10'` by position. It works only because every entry
happens to put the text class second, and silently falls back to `text-muted` otherwise. The border
and background halves of `TYPE_STYLE` are never used on this page — dead config that reads as if
pills were intended. **Fix:** reuse `CATEGORY_COLOR` from `NewsRow.tsx`, which the ticker already
imports for exactly this.

**B13.4 · LOW · XS — empty grey discs down the left gutter.** Line 74 renders
`<div className="w-7 h-7 rounded-full bg-raised" />` for transactions with no `teamId`; six
league-wide DEVELOPMENT items in a row produce six blank circles. Drop the slot and let the text run
flush, or put a category glyph there.

## B14 · History — `app/league/[id]/history/page.tsx`

**B14.1 · HIGH · S — Dynasty Score opens the page with 32 rows of "0 / Nothing on the board yet".**
In a league with no completed seasons the leaderboard renders all 32 teams ranked 1–32, every score
`0`, every "Driven By" cell identical — roughly 1,250px of nothing as the first thing on the page.
The ranking is worse than useless: Boston is `#1` and Cincinnati `#32` on identical zeros, purely
from array order. It presents a fabricated ranking as fact and buries the actually-populated
sections below it. **Fix:** when every score is 0, replace the table with one line — *"No dynasty
has started yet. Championships, playoff runs and draft hits all feed this ranking — finish a season
to get on the board."* When scores exist, collapse to a Top 8 + "your rank if outside it", and show
ties as shared rank.

**B14.2 · MEDIUM · M — two pages stapled together, with the control for the second one 1,600px down.**
`Ring of Honor` (h1, 3xl) covers league-wide records; `Franchise History` (h2, 2xl) below a
`border-t` covers one franchise's season log — and its team `<select>` sits at the far right of that
h2, ~1,600px below the top of the page. The only interactive control on the page is undiscoverable,
and a reader landing here can't tell whether the page is about the league or a team.
**Fix:** two tabs in `PageMasthead`'s action slot (`LEAGUE` / `FRANCHISE`), or lift the team selector
to the top so it governs the page from the start. `HistoryTeamSelect` is also a bare native
`<select>` — fold into A7b. This subsumes the "nav says History, h1 says Ring of Honor" naming
complaint; resolve the naming as part of the split.

## B15 · GM Career — `app/league/[id]/gm/page.tsx`

**B15.1 · HIGH · S — the career numbers are smaller and in a different face than a secondary derived
number on the same page.** Covered in A6b; restated here because it is the page's defining problem.
Lines 62–86 render Record, Championships, Draft Hit Rate and Trades Made as `text-lg font-mono` in
`.stat-tile`s; lines 90–93 render "Average dead money per season" as `stat-value text-stat-md`. On
the one page whose entire purpose is "here is your career", the headline figures are 18px mono and a
footnote is the big display number — the intended hierarchy exactly inverted, and the clearest single
reason this page doesn't feel like the same product as Cap or Roster. **Fix:** those four become the
`PageMasthead` facts (A5); the tile row is deleted.

**B15.2 · MEDIUM · M — the page ends at ~620px on a 900px viewport, with two half-width panels each
holding one sentence.** `Cap Management` and `Best Season` are `md:grid-cols-2` panels containing one
line + one number and (with no completed seasons) the string "No completed seasons yet." Above them
`s.badges` renders into `sm:grid-cols-2` holding one badge, leaving an orphan half-row. Below,
~480px of empty page. It reads as unfinished, which is a shame — the badge/identity concept is one of
the more distinctive things in the app. **Fix:** once B15.1 moves the tiles up, this page needs real
middle content, and the candidates already exist in the data layer: a season-by-season tenure
timeline (`ds/Timeline.tsx` exists and is unused), the transaction retrospectives, and the
`Awards Won By Your Players` table. Give the badge grid a single column when there is one badge, and
merge Cap Management + Best Season into one `Tenure at a Glance` row.

## B16 · Settings — `app/league/[id]/settings/page.tsx`

**B16.1 · HIGH · M — native checkboxes and native selects, in a product that built its own segmented
control.** Line 148 (`<input type="checkbox" className="w-4 h-4 accent-accent">`) and line 168
(`<select className="input">`): fourteen browser-default checkboxes and three OS-chrome dropdowns.
This is the single most "generic admin dashboard" screen in the app — precisely what the brief rules
out. And it is worse than a generic problem, because the app already solved it: the create-league
screen configures **the same two settings** (`capMode`, `difficulty`) as visible, comparable
segmented pills. Set up a league with `Off / Simplified / Realistic` as pills, then open Settings and
the same choice is a `<select>`. **Fix:** A7b's `ds/Segmented` for every enum field and every boolean
as two-state `On / Off`. This makes the create → settings journey continuous.

**B16.2 · MEDIUM · S — six stacked `.panel` boxes where the system's default is heading + divider.**
The local `Section` helper (line 137) wraps every group in `.panel p-4`. `globals.css` is explicit:
section-based layout is the default; reach for a box only when the content is a genuinely distinct
object. A settings group is a heading, not an object. **Fix:**
`<div className="section"><SectionHeading title={title} />{children}</div>` — four lines.

**B16.3 · MEDIUM · XS — group headings are quieter than the settings they contain.** Line 139 uses
`<h2 className="label-sm">` (12px muted uppercase) above 14px `text-chalk` labels, so the heading is
the smallest, dimmest text in its own group. Use `.section-title`, which exists for this.

**B16.4 · MEDIUM · XS — `max-w-3xl` inside `max-w-7xl` with no `mx-auto`** leaves the form hugging
the left edge with 560px empty to the right. Every other page fills the width, so it reads as broken
rather than as a deliberate measure. `mx-auto` it, or go two-column (the groups are independent and
short enough that this halves the scroll).

**B16.5 · MEDIUM · S — four dead controls shipped as live ones.** `showAdvancedStats`,
`autoAdvanceWeeks`, `confirmRiskyMoves` are labelled `(stored only)` with tooltips saying "toggling
it has no visible effect right now", and the page subtitle apologises for them in advance — yet they
look and behave exactly like the fourteen working toggles. It teaches the player that toggles here
may or may not do anything, which devalues the working ones. **Fix:** a visually separated, dimmed
`Not Wired Up Yet` group at the bottom with one explanatory line — then the subtitle's apology goes
away too — or remove them until they're real.

**B16.6 · LOW · S — no save confirmation.** `Save Settings` posts a server action with no toast, no
pending state, no diff. A `useFormStatus` pending state plus a brief confirmation line is the minimum.

## B17 · Game Detail — `app/league/[id]/game/[gameId]/page.tsx`

**B17.1 · HIGH · M — the one screen that is *about* two specific teams carries no team colour and no
design-system tokens at all.** This page is entirely pre-redesign: five `card card-pad` boxes stacked
(lines 25, 33, 39, 79, plus the `BoxLines` helper), zero `.panel`, zero `.section`, zero
`SectionHeading`; headings are `<h2 className="font-semibold">`; no `--team-accent` anywhere; and at
**line 76 the final score** — the single biggest number a football game produces — renders as
`text-3xl font-mono font-bold` while `ds/MatchupCard.tsx:41` renders the same number as
`stat-value text-stat-lg`. **Fix:** Recap (bare section) + Team Stats (panel) + Leaders (two panels),
one masthead-style scoreline hero carrying both teams' accents, score on `.stat-value text-stat-xl`.
~60 lines, and it is the largest remaining single-page consistency gap.

## B18 · App shell — `components/LeagueNav.tsx`, `app/league/[id]/layout.tsx`

**B18.1 · MEDIUM · S — the header height jumps 41px between nav categories.** The sub-nav row renders
only when `activeCategory.items.length > 1`. Measured: Standings/Schedule/Stats/News/History = 160px;
Dashboard/Draft/GM Career/Settings = 119px. Since the header is `sticky top-0`, both the content
origin and the sticky offset shift by 41px whenever you cross between category types — Home → Team,
Standings → GM Career. On a product whose pitch is a stable broadcast frame, the frame itself moves.
**Fix:** render the row with its single item in it (harmless, and it confirms where you are).
See section D on why reserving an *empty* row is the wrong fix.

**B18.2 · MEDIUM · S — the two nav tiers speak two different visual languages.** Tier 1 uses the
broadcast lower-third device: uppercase display face, underline bar in `--accent`. Tier 2 immediately
below uses `text-accent2 bg-accent2/10 rounded-md` — a soft rounded pill in a *different* accent
colour. The `.nav-link` comment in `globals.css` explicitly says "a broadcast lower-third tab, **not a
rounded pill**", and the row underneath it is a rounded pill. The two rows read as unrelated controls
and the second accent implies a distinction that doesn't exist. **Fix:** tier 2 gets a quieter version
of the same device — 1px underline in `--accent`, smaller type, no fill.

**B18.3 · MEDIUM · S — the ticker's content is database rows, not headlines.** In a populated league
the crawl reads `INJURY 2 injury report(s) from MIA @ SDG · INJURY 5 injury report(s) from WAS @ BUF ·
INJURY 1 injury report(s) from MIN @ DEN` — the same sentence with a different integer, and
`report(s)` is machine plural. The round-robin in `layout.tsx:33–48` correctly stops injuries from
being 14 of 14, but injury is one of ~4 live categories so it recurs every ~4 slots. A broadcast crawl
should feel like a league breathing around you; this reads as a log tail, which undercuts the aesthetic
more than no ticker would. **Fix:** exclude bare injury-count rows (no name, no stake) or collapse them
into one `INJURY REPORT · 11 across the league in Week 16`; cap any category at 2 of 14 slots; make
each item link to `/news?type=<CATEGORY>` — it already pauses on hover specifically so a headline can
be read, but there is nowhere to go once you've read it.

**B18.4 · LOW · XS — `System` is a category label for one item called `Settings`,** and it is the only
label in the bar that isn't football vocabulary. `GM Career` is likewise a category whose sole item
repeats its own name. Fold Settings under a renamed `Front Office` category (items: GM Career,
Settings), which also removes two single-item categories and shrinks B18.1's surface.

## B19 · Landing / Create — `app/page.tsx`, `components/CreateLeagueForm.tsx`

**B19.1 · HIGH · XS — in the franchise list, the differentiator is the smallest text and the duplicate
is the biggest.** Lines 68–74: the league name renders as `label-sm` (11px, muted, uppercase); the
team name renders as `font-display font-bold text-lg uppercase`. With 12 saves, ten of which are the
Atlanta Blaze, the display line is identical on ten consecutive rows and the only thing telling them
apart is the smallest text on each. The code comment directly above states the correct intent —
*"League name leads: with several saves it's the only thing that tells them apart"* — and the type
scale does the opposite. **Fix:** swap them. The crest already carries team identity visually, so
nothing is lost. Highest impact-to-effort ratio in the entire audit.

**B19.2 · MEDIUM · XS — twelve equally-loud primary buttons.** Every row gets the same bright green
`btn-primary` "Continue →", making a green ladder down the right edge that flattens the list and
signals nothing about which save is live. **Fix:** `btn-primary` on the most recently played league
only (already ordered `createdAt desc`), `btn-secondary` on the rest, `LAST PLAYED` pill on the top
row. The adjacent bare-ghost `Delete` with no confirmation is a mis-set risk one tab-stop from
Continue — give it a confirm.

**B19.3 · MEDIUM · S — the hero is two-thirds empty and repeats its own eyebrow.** A full-width
`px-8 py-12` band whose content is confined to `max-w-lg` on the left, ~700px of bare texture on the
right, and `FRONT OFFICE SIMULATOR` printed twice within 100px (header line 26, hero eyebrow line 42).
It is also the only surface in the app using a one-off `rounded-lg border border-line bg-card/40`
rather than `.panel` or `.card`. **Fix:** drop one eyebrow; fill the right side with an oversized crest
at `opacity-[0.07]` — `.watermark-logo` exists precisely for this and is used on every in-league
masthead, so this ties the landing page to the product for almost no work.

**B19.4 · LOW · S — "Step 1 of 2" and "Step 2 of 2" sit side by side** in a `lg:grid-cols-[1.3fr_1fr]`.
They are simultaneous, not sequential. Relabel to `FRANCHISE` / `RULES`, or stack them into real steps.
The left column is also `max-h-[26rem] overflow-y-auto` scrolling 32 teams with no fade at the
boundary, so the list looks cut off rather than scrollable — a `mask-image` fade fixes it in one line.

**B19.5 · LOW · XS — the picked franchise is weakly marked** (`bg-raised/70` + a 2px team-coloured left
border, which A3 shows is nearly invisible anyway). Given the panel exists because this is the single
most consequential decision on the screen, it should be unmissable — a check glyph, the crest at
higher opacity, or the row's name switching to `var(--team-text)`.

## B20 · Masthead grammar — cross-page, LOW

**LOW · S · `components/ds/PageMasthead.tsx` + 5 consumers · lane: transactions (#17, #18)**

The five transaction pages have five different `<h1>` grammars: `Trade Center` (page name) /
`100 AVAILABLE` (a filtered count) / `ATLANTA BLAZE` (team name) / `Re-sign Window` (page name) /
`2027 Draft Class`. On FA the largest text on the page doesn't identify the page; on Cap the `<h1>`
is the team, which the global header already carries. **Fix:** `<h1>` = page identity always; eyebrow
= context (`2027 · Atlanta Blaze`); counts belong in the fact strip, which already has them.

Related: `PageMasthead.tsx:88` renders every fact at `stat-value text-stat-sm`, evenly divided, so no
page has a lead number — Cap Space (the figure that gates every decision on four of five pages) is the
same size as `MODE: Realistic · set in league settings`. The system defines `text-stat-lg/xl` for
exactly this and the masthead never uses them. **Fix:** add `primary?: boolean` to `MastheadFact`;
render the primary at `text-stat-lg` in a wider cell; make Cap Space primary on trade/FA/resign/cap.

---

# C. Already good — do not touch

De-duplicated across all four lanes. This list exists so that a redesign sweep doesn't flatten the
things that are already working.

**Components**

- **`FrontOfficeBrief`** — the strongest thing on the dashboard and arguably in the app: category
  kicker, real headline, a consequence sentence, and a **concrete action button per row** rather than
  a chevron implying "go read more elsewhere." It is the only block that answers "what should I do
  next." (Noted by core; B1.3 hands it more work precisely because it is the right home for it.)
- **`MatchupCard`** — big tabular score, crest, team-coloured base bar split at the midline. Genuinely
  broadcast. It is let down by its container (B10.1), not by itself. It is also the only site in the
  app that gets team-coloured text right today, by bypassing the broken token.
- **`MetricTiles` with `tip`** — every derived metric carries a plain-English explanation of how to
  read it and where the threshold sits. `Cap-Weighted Age 26.6 / roster average is 26.8` is a good
  derived metric with its baseline attached. The Luck Table's sub-line ("Top of the list has been
  winning close games; the bottom has been losing them") is a model for how to head a data table.
- **`RosterGroupHeader`** — `5 players · avg 80.2 OVR · $48.4M · thin` answers "how deep and how
  expensive is my O-line" before you read a row. Real density, and the `capHit: null` handling when
  cap tracking is off is careful. (Its background band should lighten as part of B3.3 — that is a
  relative-weight change, not a criticism of the component.)
- **`NewsRow`'s `metric` slot** — `ATL 49, BUF 30` set in `stat-value` makes each wire row carry its
  own payoff instead of a timestamp. The editorial kicker + byline meta reads as a dispatch.
- **`ScoutingRange`** — its fixed 40–99 scale is the single best piece of thinking in the library, and
  it is the model B4.3 and B5.1 should be corrected *toward*.
- **`TradeScoreBar`** normalising to the AI's own `requiredRatio` with a threshold tick, rather than
  showing raw value points. Right call, well explained by its tooltip.
- **`ds/positionColor.ts`, `ds/NewsRow.tsx`, `ds/StorylineFeed.tsx`** — single responsibility,
  token-only, doc comments that state intent rather than restate the code.
- **`ds/RatingBadge`'s `tierHex()`** duplicating `ratingColor()`'s thresholds as literal hex is a
  *documented, deliberate, correct* duplication (one returns a class for text, the other needs a
  literal for a `clip-path` corner flag). Do not "fix" it in the A8 sweep.

**Logic and honesty**

- **The asymmetric cap math in the trade builder** — modelling `freedIfSent` vs `addedIfAcquired`
  separately, and surfacing *"Dead money you'd eat"* as its own figure rather than burying it in a
  net number, is more honest than most shipping football games. Keep the inline comments.
- **Confirm-then-act** on `ResignRow`'s "Not Re-sign", `CutButton`, and `LetAiResignButton` —
  including `LetAiResignButton` naming the scope of the bulk action and reporting the result
  afterwards. B7.1 asks `PendingTradeOffers` to *match this bar*, not to invent something new.
- **`ExtendContractForm`'s** per-year cap-hit pill strip, with year-1 turning red on breach and the
  button relabelling to `Not Enough Cap Space`. The failure state is explained at the control, not in
  a banner elsewhere.
- **`SignOfferForm`'s** `Cap space after signing $6.00M` plus per-year pills — a real consequence
  preview that shows the outcome before you commit.
- **The roster's starter derivation** (manual rank-0 falling back to best `trueOvr` at the exact
  position) is correct and genuinely agrees with the depth chart. The logic is right; only the
  rendering is invisible (A3).
- **`heroFacts` branching on `capMode`** and `RosterGroupHeader` omitting the cap figure entirely
  rather than showing a fake `$0` — the kind of care that keeps a settings-driven UI honest.
- **The ticker round-robin in `layout.tsx:33–48`** is a thoughtful fix for a real problem (injuries
  drowning everything else), and its comment explaining why it excludes NEWS/DEV_MILESTONE to avoid
  duplicating the dashboard's wire is exactly the reasoning that keeps a design system coherent. The
  component it feeds is what's broken (A2, B18.3), not the data.

**Aesthetic set-pieces**

- **The split first-name / surname treatment in the player hero** — kicker over a 5xl uppercase
  surname. The most on-brand thing in the app: it reads as a jersey back, not a form field.
- **The combine testing band** — six equal tiles, `divide-x`, one full-width row, no nested boxes.
  This is the panels-not-cards philosophy working. Same for the hero fact strip's construction.
- **The draft-day on-the-clock hero** — team-tinted radial, hash texture, watermark crest, `text-3xl`
  headline. Structurally this is the best-looking object in the app. (One correction to the
  transactions lane's praise: see D1 — its headline is *not* currently team-coloured.)
- **The body background** (`globals.css:28–31`) — yard-line hashmarks plus a single top-lit radial at
  0.028 / 0.05 opacity. Does more for the broadcast feel than anything else in the file.
- **Empty-state voice where it exists** — "No completed seasons yet — finish a full season to start
  the history book." A9(c) asks other pages to match this, not to replace it.

**System hygiene**

- **Arbitrary Tailwind values are rare and justified** — 14 across the whole tree, every one a layout
  constraint with no business being a token. There is no ad-hoc spacing problem here.
- **No stray default borders.** A runtime sweep of 15 league pages for Tailwind's preflight `#e5e7eb`
  found zero. Every visible border is a token.
- **The base palette clears AA comfortably** — chalk 17.6:1, gold 10.3, warn 11.9, accent 11.4,
  accent2 9.2, bad 7.2, muted 6.5, viz1–viz8 4.0–6.4 on ink. All three contrast failures in A3 are
  *misuse* of a token (a border colour as text, an opacity knock-down, a raw fill colour as text),
  not a bad palette. Do not repaint the palette.
- **The hardcoded hexes in `PlayerAvatar.tsx` and `TeamLogo.tsx` are correct** — sclera white, pupil
  brown, lip shading are SVG illustration internals, not UI chrome. Exclude them from A8.

---

# D. Findings I think are wrong, overstated, or whose proposed fix is wrong

The lanes were accurate — nearly every checkable claim reproduced. These are the exceptions and the
places where two lanes' recommendations collide.

**D1 · The transactions lane praises the draft hero for using `--team-text` correctly. It is not
correct today.** The praise reads *"`--team-text` used correctly for the headline"* — but per A1,
`--team-text` resolves to house blue everywhere, so that headline is currently sky blue inside a
pine-green border. The *structure* of that hero is genuinely the best in the app and belongs in
section C; the colour claim is false until A1 lands. Same caveat applies to the league lane's blanket
praise of "the `PageMasthead` pattern" — the pattern is right, its team-colour output is not.

**D2 · The core lane's fixes for R1 and DC6 will not work as written.** Both say "use
`var(--team-text)`". Today that ships house blue for the Starter tag and the depth-chart starter rule
— a *different* wrong colour, which would then look deliberate and hide A1 for months. This is a
sequencing correction, not a disagreement: A1 first, then A3.

**D3 · The transactions lane's `marketValue()` calibration claim is a sim-balance finding wearing a
design finding's clothes.** Under finding #10 it observes that nothing qualifies as an overpay while
the six biggest contracts on the roster all read as $8.8M–$13.3M/yr *bargains*, and concludes
`marketValue()` sits systematically above what contracts actually pay. The observation is probably
right and it does have a UI symptom (a "Best Value" list that flags most of the cap sheet as a steal
has no discriminating power). But the fix is a tuning-curve investigation, not a layout change, and
this curve has already been retuned twice (tasks #12, #22). **Do not let it into a design sprint** —
file it as a balance task and fix the panel layout (A9a) independently.

**D4 · The league lane's fix for the 41px header jump is worse than the problem.** It proposes
reserving an empty second row on single-item categories. That adds 41px of permanently blank chrome
to four pages to solve a transient lurch. Render the single item in the row instead — it costs
nothing, confirms where you are, and B18.4 (folding Settings under a renamed `Front Office`) removes
two of the four offending categories anyway.

**D5 · "History vs Ring of Honor" is not its own finding.** The league lane raises the nav/title
mismatch as MEDIUM #30 and the two-pages-stapled-together problem as MEDIUM #31. The first is a
symptom of the second: the page genuinely contains a league-wide Ring of Honor *and* a per-franchise
season log, so no single title is correct. Fold it into B14.2 and resolve the naming when the split
happens. Counting it separately inflates the History page's apparent severity.

**D6 · The core lane wants `TeamHeader` upgraded to masthead weight. It should be deleted instead.**
X2 correctly identifies three competing page-header treatments, then proposes giving `TeamHeader`
the coloured border, shadow, hash texture and fact-strip base — i.e. reimplementing `PageMasthead` a
fifth time, which is exactly the failure mode A4 is trying to stop. `TeamHeader` has one consumer.
Delete it; the dashboard uses `PageMasthead` with record/standing/tenure as facts.

**D7 · Folding `OffseasonRoadmap` into the masthead fact strip (core D1) will not fit.** The
diagnosis is right and important — the franchise must come first. But the roadmap is a five-stage
progress bar with a title and a description per stage, and the fact strip is already five tiles wide;
they would fight for the same row and the roadmap would lose its stage descriptions. Put the roadmap
as a full-width sub-strip immediately *under* the masthead, or in the masthead's `action` slot in a
compressed form. Same outcome (team first, roadmap second), no cramming.

**D8 · The system lane's "the philosophy is followed on 3 pages out of 16" is overstated, and acting
on it literally would make things worse.** The claim is that `.panel` everywhere is "the same
boxes-in-boxes problem wearing a squarer radius." But `globals.css` prescribes `.panel` for *dense
data blocks*, and a sortable 32-row standings table inside a titled panel is the system working as
designed — not a violation. The real violations are boxes wrapped around **prose, settings groups and
lists of decisions**: `settings`'s six stacked panels (B16.2), the re-sign page's 28 panels (B6.2),
the depth chart's 16 panels (B2.3), and the dashboard's four stacked box languages (B1.2). Scope the
de-carding work to those four and leave the data panels alone.

**D9 · "Advanced replaces the leader tables" (league #19) is a product decision, not a design fix.**
The diagnosis — Advanced is additive, producing a 5,827px page nobody scrolls — is solid. But whether
Advanced should *hide* the leader tables depends on whether "Advanced" means a different lens or a
deeper one, and only the product owner can settle that. The three-tab framing (Leaders / Teams /
Analytics) that the same finding offers as an alternative is the safer default, because it also gives
the depth axis somewhere real to live and resolves B11.2 for free. Flag for a decision; don't ship
either silently.

**D10 · "Delete the dead `ds/` components" needs a scalpel, not a broom.** ✅ I confirmed all 12 named
components have zero real-page imports. But four of them map to *pending* work rather than abandoned
work — `PickTradeOffer` and `TradeOfferPreview` to task #46 (live draft-pick trade market), `Timeline`
to the GM tenure timeline that B15.2 explicitly proposes, `ScoutsRoom` to the draft page. And
`ProspectRow` is the one component using `IconStar` correctly — the model A3 cites for fixing
`ShortlistStar`. **Recommendation:** adopt `PlayerHero` + `OnTheClock` (A4); keep `PickTradeOffer`,
`TradeOfferPreview`, `Timeline`, `ScoutsRoom`, `ProspectRow` with a one-line TODO naming their target
task; keep `BottomNav` (honestly labelled as a mobile concept, and mobile is deprioritised); delete
`CapDecisionPanel`, `ContractSummary`, `PlayerRowMobile`, `RecentPicksFeed` unless someone claims them.

**D11 · The player card's 208px narrower measure (core P10) is presented as a defect; it is a
judgement call.** `max-w-5xl` on a detail page with long prose is a defensible reading measure. What
is *not* defensible is that it is left-aligned, so the page visibly narrows and opens a 200px right
gutter when you click a roster row. Fixing the alignment (`mx-auto`) resolves the jarring part
without relitigating the measure. Kept at MEDIUM in B5.11, but do not let it block anything.

**D12 · Roster Needs showing five O-line positions (core D7) may be a sim bug, not a display bug.**
The finding says it "reads as a bug ('why is my entire line a need?') rather than a finding." That
may be literally true — five contiguous O-line positions all at "Moderate" with identical bar widths
is the signature of a needs calculation that is either double-counting linemen or has no
position-scarcity weighting. Check the calculation before redesigning the presentation; if the data
is right, B1.6's grouping fix stands, and if it isn't, the display fix would launder a bug into a
tidier bug.

**D13 · Two `/design-system` route notes are engineering scope, not design.** The system lane observes
that `/design-system`, `/design-system/dashboard`, `/design-system/player` and `/design-system/draft`
are real routes with no auth or env gate and will ship. Correct and worth a deliberate decision, but
it belongs in a release checklist, not a design backlog. LOW, and out of this plan's scope.

---

# Appendix — the LOW pile, in one place

Everything below is a genuine nit. Do not let any of it displace section A. Batch them into a single
polish pass when someone has an idle afternoon.

| Item | File | Effort |
|---|---|---|
| B1.7 "Browse →" not phase-aware | `league/[id]/page.tsx` | XS |
| B1.8 three consecutive RECORD WATCH storylines | `ds/StorylineFeed` consumer | S |
| B2.6 depth-chart OVR is the smallest text in the row | `DepthChartGroup.tsx` | XS |
| B3.6 Potential column is flat; show the delta | `roster/page.tsx` | S |
| B4.4 rank badges duplicate the rank column ×32 | `draft/page.tsx` | S |
| B4.5 Potential column carries no signal at low confidence | `draft/page.tsx` | S |
| B4.6 Class Outlook banner renders above the masthead | `draft/page.tsx` | XS |
| B5.12 contract year bar fills backwards | `player/[playerId]/page.tsx` | XS |
| B5.13 `(this player)` is redundant | `player/[playerId]/page.tsx` | XS |
| B5.14 no back link from the player card | `player/[playerId]/page.tsx` | S |
| B7.4 `All Po` clipping, literal `(s)`, triple `?` glyphs, phantom retrospectives section, dead "after" figure | `TradeBuilder.tsx`, `trade/page.tsx` | S |
| B8.2 FA `<h1>` is a filtered count; `BEST AVAILABLE` duplicates the panel below | `free-agency/page.tsx` | XS |
| B10.3 unplayed games wrapped in `href="#"` | `schedule/page.tsx` | XS |
| B11.7 Passer Rating panel half empty; bars hardcoded `#3987e5` | `stats/page.tsx` | S |
| B12.4 Cap Usage panel restates two numbers | `cap/page.tsx` | S |
| B12.5 negative "savings" is a cost labelled as savings | `cap/page.tsx` | XS |
| B13.3 category colour via `split(' ')[1]` | `news/page.tsx` | XS |
| B13.4 empty grey discs in the news gutter | `news/page.tsx` | XS |
| B16.6 no save confirmation on Settings | `settings/page.tsx` | S |
| B18.4 `System` / `GM Career` single-item nav categories | `LeagueNav.tsx` | XS |
| B19.4 "Step 1 of 2" side by side; no scroll fade on the team list | `CreateLeagueForm.tsx` | S |
| B19.5 picked franchise weakly marked | `app/page.tsx` | XS |
| B20 masthead grammar + no primary fact | `ds/PageMasthead.tsx` + 5 consumers | S |
| `viz6` fill-only comment; `.input` placeholder at 2.81:1 | `tailwind.config.ts`, `globals.css` | XS |
