# PART 5 — BUILD EVERY SCREEN, AND THE DESIGN SYSTEM

Build 39 routes and roughly 159 components. Tick every route and every control off as you
go. Where a figure is given, use that figure — every number below was read out of the
reference implementation. Where you are told to decide something yourself, decide it, and
read the reasoning before you do.

## 1. BUILD THESE ROUTES

| # | Route | Group | Query params |
|---|---|---|---|
| 1 | `/` | global | `claimed`, `all` |
| 2 | `/new` | global | `team` |
| 3 | `/import` | global | — |
| 4 | `/start/[id]` | global | — |
| 5 | `/sign-in` | global (auth layout) | `next` |
| 6 | `/sign-up` | global (auth layout) | `next` |
| 7 | `/account` | global | — |
| 8 | `/leaderboard` | global | `sort`, `sport` |
| 9 | `/league/[id]` | league | — |
| 10 | `/league/[id]/roster` | league | `sort`, `dir` |
| 11 | `/league/[id]/depth-chart` | league | — |
| 12 | `/league/[id]/resign` | league | `player` |
| 13 | `/league/[id]/cap` | league | `sort`, `dir`, `view` |
| 14 | `/league/[id]/analytics` | league | `view` |
| 15 | `/league/[id]/free-agency` | league | `pos`, `sort`, `dir` |
| 16 | `/league/[id]/trade` | league | `with`, `reviewOffer`, `pos` |
| 17 | `/league/[id]/draft` | league | `pos`, `sort`, `dir`, `shortlist`, `q` |
| 18 | `/league/[id]/draft/broadcast` | league | — (redirect) |
| 19 | `/league/[id]/scouting` | league | `lens` |
| 20 | `/league/[id]/standings` | league | — |
| 21 | `/league/[id]/power-rankings` | league | — |
| 22 | `/league/[id]/schedule` | league | `week` |
| 23 | `/league/[id]/stats` | league | `view`, `scope`, `split` |
| 24 | `/league/[id]/news` | league | `type`, `page` |
| 25 | `/league/[id]/history` | league | `team` |
| 26 | `/league/[id]/gm` | league | — |
| 27 | `/league/[id]/dynasty` | league | — |
| 28 | `/league/[id]/rebuild` | league | — |
| 29 | `/league/[id]/settings` | league | — |
| 30 | `/league/[id]/player/[playerId]` | league | `split`, `view`, `from`, `fq` |
| 31 | `/league/[id]/team/[teamId]` | league | — |
| 32 | `/league/[id]/game/[gameId]` | league | — |
| 33 | `/design-system` | design | — |
| 34 | `/design-system/dashboard` | design | — |
| 35 | `/design-system/player` | design | — |
| 36 | `/design-system/player-card` | design | `split` |
| 37 | `/design-system/draft` | design | — |
| 38 | `/league/[id]/design/negotiate` | design | — |
| 39 | `/league/[id]/design/negotiate/[direction]` | design | `player` |

### Validate every query parameter, and fall back silently

A query string is whatever anyone types. Parse every parameter defensively. **An invalid
value must fall back to the documented default and must not be reported as an error.** No
route may 500, no route may render an empty board, and no route may echo an unvalidated
value back into its own copy — if a position filter does not match a real position, do not
write "No unsigned `<whatever>` anywhere in the league".

| Param | Accept | On anything else |
|---|---|---|
| `sort` (roster) | `pos age ovr potential cap years` | use `pos` |
| `sort` (cap) | `pos age ovr cap base years savings` | use `cap` |
| `sort` (free agency) | `pos age ovr market` | use `ovr` |
| `sort` (draft) | `consensus ours pos ovr age potential athletic` | use the phase default |
| `sort` (leaderboard) | `LEVEL TITLES PER_SEASON REBUILD` | use `LEVEL` |
| `dir` | `asc` → ascending | descending |
| `pos` | a value in your `POSITIONS` list | treat as no filter |
| `view` | `advanced` (cap, stats, analytics) / `contract` (player) | basic / stats |
| `week` (schedule) | a week that exists in the fixture list | the league's current week, else the last week that exists, else 1 |
| `type` (news) | a value in the filter list | `ALL` |
| `page` (news) | `max(0, Number(x) \|\| 0)` | page 0 |
| `claimed` (home) | a positive integer | suppress the banner |
| `all` (home) | `1` → every save | first 6 only |
| `team` (`/new`) | uppercase, must match a team seed's abbreviation | no pre-selection |
| `team` (history) | a team in this league | the user's team, then the first team |
| `next` (auth) | must start with `/` and not `//` | `/` |
| `shortlist` (draft) | `1` | off |
| `q` (draft) | trim, then **slice to 40 characters** | — |
| `lens` (scouting) | a known consensus-bias id, or `board` | `movers` |
| `reviewOffer` (trade) | a real pending-offer id | ignore |
| `with` (trade) | a team id in this league | the first other team |
| `split` / `scope` | `playoffs` / `myteam` | regular season / league |
| `player` (negotiate) | a player id in this league | render a "No such player" panel with a back link |
| `player` (resign) | a player id on this roster | open no row |
| `direction` (negotiate) | `table` `sheet` `room` | **404** |

### Two route-identity rules, in every league route and on `/start/[id]`

**Report a save the viewer does not own as missing, not as forbidden.** Return 404, never
403. A 403 confirms the save exists.

**Re-check every id that arrives in the path against the league.** Proving the viewer may
see *this league* says nothing about a `teamId`, `gameId` or `playerId` typed into the URL.
`/team/[teamId]` and `/game/[gameId]` must 404 when the row's league does not match.
`/game/[gameId]` must also 404 on a game that has not been played — do not build an empty
box-score page for it.

## 2. THE GLOBAL ROUTES

### 2.1 `/` — the front door

Give this route **two layouts**, chosen on whether the viewer has any saves at all, and do
not try to serve both readers with one. It answers two different questions: "what is this?"
for someone opening a link a friend sent, and "where was I?" for someone coming back.

Never require signing in anywhere on this page. A cookie-based ownership model works for a
single-player game, and a wall in front of one costs every tester who was only ever going to
click once.

Shell: the shared site header, a `max-w-6xl` main, and a footer carrying *"Fictional league.
No real teams, players or logos anywhere in this game."* plus links to New dynasty, Import a
league, and Sign in when signed out.

Render a **claim banner** only when `?claimed=N` is a positive integer: accent-bordered,
label "Saves secured", and **name the real number that moved onto the account**. "You won't
lose your saves" is the whole pitch for an account; a vague version of it is not persuasive.

**No saves — build the pitch:**

| Panel | Build |
|---|---|
| Hero | eyebrow "Front Office Simulator"; `Dynasty GM` / `Football` at `text-5xl sm:text-7xl`; two paragraphs in the game's own voice; `Pick your franchise ▸` (primary) and `Import a league` (secondary); a one-line account note whose wording changes on signed-in state. Decoration: a yard-line repeating gradient at 0.06 opacity, an accent radial, and a drifting crest field over all 32 team seeds |
| "Choose who you run" | eyebrow "32 clubs, one chair"; the full 32-crest wall, every crest linking `/new?team=<abbr>`; action link "See the full board →" |
| Three job cards | The Draft / "Scout all year" · The Cap / "Every deal comes back" · Sunday / "Sixteen games a week" |

Make the signed-out account note read *"You can start without one, but a save made
signed-out lives only in this browser — making an account first is the safest way to keep
it."* The safest minute to make an account is the minute before there is anything to lose;
do not present it as a thing to get round to.

**Has saves — put the franchises first, above everything else.** Do not make a returning
player scroll past a pitch to reach a Continue button.

| Panel | Build |
|---|---|
| Hero | tint with the lead save's club primary; crest watermark at 0.07; "Signed in as X" or "Welcome back"; `Your Franchises` in the team-text colour; a count line; `Start another ▸`, `Import a league` |
| Unclaimed-save warning | **only when signed out and at least one save exists.** Warn-bordered: "This browser is the only copy", `Save my dynasty` / `Sign in`. Telling somebody with no saves that their saves are at risk is noise |
| Save list | one row per save, left-bordered in that club's primary: a 44px crest, **the league name first** (it is the only thing that tells two saves apart — the franchise can repeat), `CITY NICKNAME` under it, then `year · Week n · phase label · record`. `Continue ▸`, plus a Delete form hidden below `sm` |
| Older saves | show the first 6; below the list offer `Show N older saves` linking `?all=1` |
| "Take over somebody else" | the same crest wall at size 46 |

Set a 60-second max duration on this route and on `/new`. League creation runs ~236 database
round trips and the ownership stamp happens **after** generation, so a 10-second function
timeout leaves a league with no owner — invisible to the person who made it and deletable by
nobody.

The pitch layout **is** the empty state. Do not ship a bare save list.

### 2.2 `/new` — team select

Give team select its own route rather than a section of the home page. The landing page has
to be one confident screen and a 32-club board is not that; and a franchise chosen from a
crest on the landing page arrives here as `?team=`, so the click that expressed the choice is
the click that makes it.

**At the save limit** (default 8), replace the whole screen: a panel reading "Save slots
full", `You already have N dynasties`, the limit stated, *"Delete one from your franchise
list and the slot comes straight back — nothing else on the account is affected."*, and
`Back to my franchises`.

Count the saves **exactly the way the server-side creation guard counts them**, never off the
visible list. The two differ — the visible list may include legacy unowned saves — so
counting rows on screen puts this page behind a "slots full" wall while the action it guards
would have accepted the request happily. **A pre-check that disagrees with the real check is
worse than no pre-check.**

Below the limit, render a guest note when signed out — *"Playing as a guest — this dynasty
will live in this browser only. An account keeps it if you clear cookies or switch device."*
with `Create account` / `Sign in` carrying `?next=/new` — then the create-league form,
pre-selected from a validated `?team=`.

Do not put a team rating or strength figure on this screen. Rosters do not exist until
generation runs, so before that point every franchise is statistically identical and any
strength number would be invented. `/start/[id]` is where the real one goes.

### 2.3 `/import` — custom leagues

Put import and export on **one route**. They are one loop — you export a file so someone else
can import it — and a rejection needs room to be explained in full. Squeezed into a panel on
the home page, a refusal like `teams[7].players[3].age is 900; it must be between 18 and 45`
has nowhere to go but a truncated toast.

Sections: hero ("Import a League", plus what a league file is) → **Import** (the upload form,
which must print the validator's full message) → **Export one of yours** → **What a file may
contain**, printed from your file-limit constants, not typed out:

| Rule | Value |
|---|---|
| Teams | exactly 32, as 2 conferences × 4 divisions × 4 teams |
| Players per team | up to the roster maximum; omit them and a roster is generated |
| Free agents | up to 400; omitted means a generated pool |
| File size | up to 4MB |
| Ratings | 1–99 |
| Ages | 18–45 |
| Contracts | $0.5M–$100M per year, 1–7 years |
| Names | up to 24 characters, letters and ordinary punctuation |

Close with a note that names are shown to anyone you send the file to, and that nothing
imported is published anywhere.

Empty state for the export half: *"No leagues to export yet. Start one from the home page,
then come back."*

### 2.4 `/start/[id]` — the handover

Build the first screen on which the player sees the club as it actually is. This is the
earliest moment a **real** team rating exists, which is why it goes here and not on the
picker.

Mark it `noindex`. 404 on a save the viewer cannot see. If no team is flagged as the user's,
redirect straight into the league rather than render a broken celebration.

- **Hero:** club-tinted, 2px border in the club primary, elevated shadow, hash texture at
  0.06, the crest at 132px with a motion-safe fade-up; "You are now the general manager of
  the"; `CITY` / `NICKNAME` at `text-4xl sm:text-6xl` in the team-text colour; league name ·
  year · conference division.
- **Four facts:** Team overall (detail "Nth of 32"), Offense, Defense, Special teams.
  **Compute each rank from the same ratings map that produced the number above it.** If you
  display a rank it must be the rank *of* the grade you displayed — the offense and defense
  composites usually carry no stored rank, so rank them on the spot from that same map.
- **"The roster you inherit":** best unit and weakest unit by rank, each with its rating and
  "Nth of 32", and a footnote stating that overall is the weighted starter rating across all
  nine units — *the same number the dashboard shows and the same one the sim uses to set a
  win chance.* Nothing here may be estimated, projected or scaled for effect: if it says 4th,
  the dashboard says 4th.
- **Division panel:** the three divisional rivals with crest, city, nickname, overall and
  ordinal rank. Render it whether or not a rating exists.
- `Enter the front office ▸`, `Back to my franchises`, and a signed-out footer offering an
  account.

**Skip the rating entirely in a fantasy-draft league.** Every roster is empty, so a league
rating function scores all 32 clubs at replacement level — a real number that means nothing,
which is worse than no number. Put this in its place: a panel headed "Fantasy draft" —
*"Every roster in the league is empty. There is no team rating yet because there is no team
yet — you build one, pick by pick, starting now."* Keep the division panel, because the
division is the only real thing about the club yet, and it is still the thing worth knowing:
these are the three teams drafting against you and then playing you twice a year.

### 2.5 `/sign-in` and `/sign-up`

Share one auth layout: the site header with its right-hand slot replaced by the label "Front
Office Simulator" (offering "Sign in" on the sign-in page is noise), `max-w-md` main. Mark
both `noindex, follow` — a search result for "dynasty gm sign in" ahead of the game itself
helps nobody. Redirect to `/` if already signed in.

**Sign in:** hero with the yard-line texture, "Welcome / Back", the form, a crest ribbon over
the first seven seeds, then two notes — a guest escape hatch (*"it works exactly the same,
the save just lives in this browser"*) and *"Forgotten your password? There is no reset — we
never asked for an email address. Message whoever sent you the link and they can set a new
one for you."*

**Sign up:** "Keep Your / Dynasty". **Count the claimable saves on this browser and state the
real number in the subtitle.** Crest ribbon over a different slice of seeds. Point the escape
hatch at the validated `next`, not at `/`: somebody who reached this screen from team select
wants to go back to team select, and sending them to the front door is what makes an optional
account feel like a detour they lost their place in.

### 2.6 `/account`

Redirect to `/sign-in?next=/account` when there is no session — a settings page for nobody is
a sign-in prompt.

Masthead facts (3): **Saves**, **Public board** (`Listed` / `Private`, with the rank or
"Nobody can see you"), **Member since**.

**Privacy → Public leaderboard.** State that the board is public to anyone with the link,
signed in or not, that listing is off by default, and that turning it off **deletes** your
rows rather than hiding them. Then render **the exact row a stranger would see** — crest,
username, franchise, seasons, record, titles, level, XP — labelled "What people currently
see" / "What people would see". **Consent to publish something you have not been shown is
not consent.** Add the rank line ("Publishing now would put you at about #N"), the
one-GM-one-row note when several saves are eligible, and a statement that only the username
and record are published and everything inside the save stays private. Then the Rebuild
board block, rendered only when this account has something to say about it.

Build the toggle as a plain form posting a server action, with no client component, so it
works with JavaScript disabled. **Put the state on the button** (`name="listed"`,
`value="on"` / `"off"`), not in a checkbox: an unchecked checkbox submits nothing at all, so
the action would have to read "no field" as "off", and a request that lost a field in transit
would silently unpublish somebody. One button, one explicit value, one meaning.

**Security → Change password.** Render the form when the account has a password. When it does
not, print a sentence saying so — a form whose current-password field can never be satisfied
is worse than a sentence.

**Session → Sign out.** *"Ends this session on the server, not just in this browser. Your
saves stay attached to the account."*

Empty state: *"Nothing yet — you have no franchise on this account with a team in it. Start a
league and play a week; your best save is the one that would be published."*

### 2.7 `/leaderboard`

Make it readable with no account and no session. The entire point is that it can be pasted
into a group chat.

**Derive every published row from franchise history inside this request, before reading the
board.** Do not do it on a cron. A stored XP total is only trustworthy if nothing could have
changed since it was derived, and the only moment that holds is now.

Facts: **GMs Listed**, **Top Level**, **Championships** ("won by listed GMs"), **Seasons
Played** ("the denominator"), plus **Fastest Rebuild** on the Rebuild sort only.

Put the honesty panel **above the table, at full weight, not in a tooltip**: someone who
reads only the first thing on this page should still come away knowing what the numbers are.
Append the Rebuild caveat below a rule on that sort, because everything else on the board can
be padded by playing longer and that column cannot — its risk is the opposite one, a small
number that does not say what it excludes.

Four sorts:

| Sort | Blurb to carry |
|---|---|
| Dynasty Level | career XP — "Rewards everything a franchise has ever done, which also means it rewards time." |
| Championships | "Rings first, then level. The only line on the board that a losing season cannot pad." |
| Per Season | XP per completed season, with a minimum — "Simming a decade of .500 football moves you DOWN this one." |
| The Rebuild | worst roster to champion, in seasons |

Print the active sort's blurb under the tabs — **except on Rebuild, where it is already at
full weight in the panel above.** Printing it twice on one screen is duplication, not
emphasis.

**Render sport tabs only once a second sport has actually published a row.** Offering a
"Baseball" tab before baseball exists is its own kind of lying metric. Build the board around
a sport column and a shared account so a second game's GMs join this table rather than
getting a table of their own, and say so in one line while only one sport is playing.

Each row: rank (gold at display scale for the top three, muted below), crest, a monogram, the
username, a **You** pill for the viewer, the franchise, then **the denominator on every
breakpoint** — seasons, record, titles. A name without a mark reads as a row key; a level
without its denominator is the lie this whole feature had to be designed around. Swap the
right-hand metric with the sort.

Close with "How a GM gets listed" in three variants: signed out (you can read this all day,
you cannot appear on it — *a save made while signed out belongs to a cookie in your browser
and nothing else; there is no durable identity to attach a rank to*), signed in and listed,
signed in and not listed.

**Write three different empty states, because they are three different facts:**
- Per Season: *"This board needs N completed seasons before a per-season rate means anything.
  Nobody has qualified yet."*
- Rebuild: *"Nobody has taken a club off the bottom of the league and won a championship with
  it yet. A run only appears here once the title is on the books."* Do **not** write "nobody
  has played one" — runs may well be under way, and saying which is the difference between an
  empty board and a wrong one.
- Otherwise: *"The board is empty because it is opt-in and brand new. Be the first franchise
  on it."*

## 3. BUILD THE LEAGUE SHELL

Wrap every league route in one layout. 404 when the league or the user's team is missing.
Top to bottom: the wire ticker, a sticky header, the nav, the lineup-gap banner, the cap
alert banner, then `main.max-w-7xl.px-6.py-8` wrapping the page inside the signing-moment
provider.

Header contents: the `D` mark plus a "Dynasty GM" wordmark (hide the text below `sm`), a
compact account badge (hide below `md`), the club crest at 32px with `CITY NICKNAME` and
`record · conference division` (hide below `md`), then up to four tiles and the advance
control.

| Tile | Render when | Build |
|---|---|---|
| **Cap Space** | cap mode is on, `lg` and up | the figure, accent when ≥ 0 and `bad` when negative. Make it a **link to `/cap`** — the number names a budget and that is where it is spent. Use a **native `title`** carrying the cap-space glossary text, not a tooltip bubble: this strip is dense and a bubble here opens over the Advance button |
| **Workouts** | scouting is enabled, `lg` and up | `remaining/max`; muted when the window is shut, `bad` at zero, else the info blue. Link `/scouting`. Native `title` carrying the window label **and** the private-workout definition — the window label alone says *when*, never *what*, and a GM who has not opened the scouting page has no way to learn what a workout is from the tile counting them down |
| **Phase** | always | the phase label, then `<year> · Wk <n>` |
| **Advance** | always | the advance control (§6.3) |

Give the Cap Space tile two conditional sub-lines:

- **`<year> books`**, drawn **only when the cap year and the league year disagree** — the
  offseason window either side of the year roll. Contracts age the instant the final whistle
  blows, so from the end of the playoffs the ledger is already writing next season's books
  while the league row still reads the season just played. The rest of the year this line
  would restate the date beside it on every screen.
- **What the next press of Advance does to that figure**, with its own nested native `title`
  naming the cause. Quote it on **exactly two advances a league year** — the final, and the
  press that shuts the re-sign window — because those are the only two whose cap effect is
  entirely determined by the ledger as it stands. Everything else either does not move the
  books or cannot be quoted exactly (the offseason press runs a retirement roll), and **a
  predicted figure that does not arrive is worse than none.**

Compute in the shell: one cap-compliance report covering both the header figure and the
banner (wrap the cap summary and short-circuit the extra roster scan when compliant — never
run two); the pending cap change; the workout slots; the ticker rows; the week's
power-ranking movers; the lineup gaps; and the two nav badge counts.

**Skip the cap figure and the compliance banner entirely when cap mode is off.** There is no
ceiling to be under, so neither has anything true to say, and a cap-space function returns
infinity in that mode.

### Ticker row selection

Query transactions of type `TRADE SIGN RESIGN CUT TAG OPTION POSITION DRAFT FIRE CHAMPION
ALL_STAR_ROSTER` plus every award type, with `seasonYear >= league.seasonYear - 1`, taking
120.

**Exclude injuries.** The sim writes one injury row per game per week — sixteen a week — so
including the type spends the whole window on other clubs' training rooms and leaves
mid-season leagues with no ticker-eligible news at all within reach. **Exclude the individual
all-star selection rows** (~76 in the week the regular season ends) for the same reason; keep
the single roster announcement, which is the ticker-worthy half.

**The season-year floor is not an optimisation and you must not drop it.** League creation
seeds two decades of fictional backstory — a champion row and five award rows for every year
back about twenty seasons — and every one is written at creation time. Ordering by creation
date therefore puts all of them ahead of anything that has actually happened in the save: a
league in its fifth season showed a wire of nothing but twenty-year-old championships.
Ordering cannot fix this, because the creation timestamp is honest about when the row was
written and lying about when the event happened. **Only the league year the event belongs to
can fix it.** Keep last season's title and awards eligible through week 4 of the new year —
that is still "what just happened" to a GM reporting for a new season — and let them go quiet
after that.

Then: filter to breaking news, bucket by category, and take **round-robin across categories**,
at most **4 per category per round**, to at most **14** items. A straight "most recent 14" is
a wall of identical injury lines; the per-category cap handles the weeks where only one
category is active (a free-agency week would otherwise fill the whole strip with eight
consecutive "Signed X" lines). Enter the power-ranking movers as their own category rather
than prepending them, capped at two, so a ranking update takes at most one slot per round and
cannot crowd out a trade or a firing — it is genuinely weekly and genuinely breaking, but it
does not get to be special. Bucket it separately from general league news so it competes with
itself for slots rather than with a coordinator being fired.

**Cap the strip and never pad it.** If four things happened, carry four. If nothing has,
render nothing at all. A strip that is always full is a strip reaching for filler, and filler
is what put two-decade-old championships on it in the first place.

### Write the power snapshot here

Write this week's ranking down once, the first time any league page is opened in a new week,
idempotently, and swallow failures so a ranking error cannot 500 every league page.

**Movement cannot be recomputed later, and this is why the write has to happen on read.** A
team rating moves with the roster, so a club that signed a free agent on Tuesday would
retroactively rewrite what it was ranked on Sunday. It has to be captured as the week is
being lived. The ideal home is the week tick itself; this is the version that does not need to
own that file.

### Gate the lineup-gap scan to three phases

Run it in `REGULAR`, `PLAYOFFS` and `PRESEASON` only.

**Do not extend it through the building phases, even though a playtest will ask you to.** A
banner has to differ by outcome or it is wallpaper. Releasing unresigned expiring contracts
empties every walk-year deal in the league the moment free agency opens, so on the first
screen of the building period a normal club is missing several starters **by design** — and a
standing red alarm that is on from the offseason roll until the roster is rebuilt is on for
almost the whole period, including preseason, where a gap genuinely does cost the next game.
Give the building phases **doors instead of an alarm**: make the depth chart's unmanned rows
and its "Open Starting Slots" and "No Backup" tiles open `/free-agency?pos=` for the position
they name. Those state the hole where the GM is already looking at it, without claiming a
deadline that has not arrived.

### Raise the signing card to the layout

Put the signing-moment provider around the page content, not inside the panel that signed the
player. It is the only level at which the card survives what a signing does to the page
underneath it, and hoisting it is what lets a signing revalidate the layout at all — which is
what keeps the two banners above honest without waiting on the user to dismiss anything.

## 4. THE LEAGUE ROUTES

### 4.1 `/league/[id]` — the dashboard

Show everything waiting on the GM this week in one read.

**Derive "the season just played" once, and have every panel read that derivation.** The
league year increments **inside** the offseason, not at the end of it: one step at offseason
week 2 resets standings and bumps the year. So through weeks 1–2 the stored year still names
the season that finished, and from week 3 on it names the one about to start. Compute
`reviewYear = phase is OFFSEASON ? (week <= 2 ? seasonYear : seasonYear - 1) : null`. Keyed
on the raw league year, the championship announcement arrived at week 1 and was gone by week
4, because the reset moved the year out from under the query halfway through the first press.
Pass the year **on the object** rather than re-deriving it at the render, so the panel prints
the year it is actually announcing.

Conditional banners, in order:

| Block | Render when |
|---|---|
| Season announcement | `reviewYear` is set and a champion row exists for it — the ring plus the trophies, the biggest single moment in the game. Read the user's finished record from the season-record row, **not** from the team row, which is back to 0-0 the moment standings reset. Pass the rebuild-seasons figure **only when the title being announced is the one that ended the rebuild**; a second championship is a championship, not a climb |
| Season review | same window — narrative reads on your own players' years |
| All-star honour roll | always. Pass the honours and a **frozen** near-miss. **Read the near-miss, never re-rank it** — it was written into its own row at selection time, and season stats are cleared at the rollover, so recomputing lets the page change its mind a year later about who was snubbed |
| Offseason roadmap | always, but suppress it on the first preseason of a save: a five-stage checklist of an offseason that happened before the GM arrived, sitting above the two live decisions in his brief, reports nothing |
| Re-sign window card | phase is `RESIGN`. Warn-bordered; name the count, or *"No expiring contracts this offseason."* |

**Team header** (set the team accent on a wrapper around it): crest, record, `Nth · CONF
DIV`, a tenure label ("Your first season" / "Year N of your tenure"), a clinch scenario tag
in the regular season only, three stats, four ratings, and the next game.

- Stats: Cap Space (or `Off`), Roster with `(N inj)`, and **Power Rank**. Colour the power
  rank gold at #1, accent in the top 5, the info blue in the top 10, and ordinary ink outside
  that — **colouring all 32 would make the colour mean nothing.** Put the week-over-week move
  in the tile's *label* (`Power Rank ▲3`) and **read it from the stored snapshot, never
  recompute it**, so it cannot disagree with the power-rankings page. A #12 that was #19 last
  week is a different club from a #12 sliding out of the top ten; the move is the story.
- Ratings: Team Overall, Offense, Defense, Special Teams, each with its rank out of the league
  size. Rank the three composites **here**, off the same map that produced the number.
- Next game: the opponent, a **display-only** win probability, and the **two biggest factors**
  behind it, so the badge can say why instead of asserting a number the user has to take on
  faith. Compute it from the weighted starter rating, not a flat mean of the opponent's whole
  roster — a flat mean rates a team down for carrying depth and treats an elite quarterback as
  worth the same as an elite punter.

Two-column body. Left (`lg:col-span-2`): the front-office brief, rendered only when non-empty;
then Storylines, rendered only when non-empty.

Right rail, four sections:

- **Roster Needs** — the top five needs above a floor, each carrying a severity word **and** a
  bodies-against-starters detail (`N rostered · M start`). Measured on a live dashboard all
  five rows read "Moderate": the middle severity band is wide enough to swallow a whole normal
  roster's top five, so the word alone says nothing and the counts are the reason the score is
  what it is. Read the starter count from the same function the sim and the depth chart use,
  so this cannot disagree with them. Link each row `/free-agency?pos=`. Empty: *"No glaring
  holes right now — nice work."*
- **Division standings** — sorted by win percentage, with a real last-five form guide computed
  from played games and rank deltas.
- **Injury Report** — up to six, sorted starters first, then weeks, then rating.
- **Season Leaders** — one name per phase of the game: Passing, Rushing, Receiving, Pass Rush.
  **Omit a category nobody has produced in yet rather than showing a zero.** An empty leader
  board reads as broken; a shorter one does not.

**League Wire, full width**, not in the left column: it is the longest block on the page, and
stacking it under the brief pushed the left column to roughly three times the rail's height
with the right half of the page blank.

Take up to seven rows: your own game results first, so a real result outranks same-week
trivia on a tie, then transactions **in relevance order** from the ranking function. **Do not
re-sort by week** — that undoes the ranking and pushes a title or a trade below whatever
happened most recently. Fetch wide (200 rows) rather than taking the six most recent: 90% of
the pool is injuries, so a narrow window ranks six injury reports against each other.

Collapse other clubs' injuries into one row: *"N injury reports around the league / Your own
injuries are in the Injury Report on the right; these belong to other clubs."* Empty: *"No
news yet."*

### 4.2 `/league/[id]/roster`

Masthead facts (5): Roster Size (`N injured` / "all healthy", warn when injured), Average
`<rating label>`, Average Age, **Expiring** (warn, and **link it to `/resign` when > 0** —
counting them here and making the GM find that screen from the nav was the whole dead end),
Cap Space (link `/cap`). Action: the fill-roster button.

Render the roster-shape panel under the masthead, then one table grouped by position group,
with a group header row carrying the group's average rating, its cap hit, and a thin-depth
flag.

Columns: Pos · Player · Age · OVR/Scouted · Pot. · Status · Cap Hit · Years Left. Make every
column but Player and Status sortable through `?sort=&dir=`.

Put the **rating-colour legend** on the OVR header's tooltip, alongside the overall
definition. Every rating in this game is drawn in its tier's ink and nothing anywhere told the
player that — a re-sign screenshot showed 93 gold, 88 green, 85 green, 79 blue and 75 white in
one column with no legend on any screen. **Gate the legend on whether the cell is fogged:**
when it shows a range the ink comes from the fogged centre point, and calling that "the tier
he falls in" would promise a read the fog exists to withhold.

**Open every tooltip on this page downward.** The table sits inside a clipped panel **and** a
horizontal scroller — the exact pair that once rendered a tooltip perfectly and clipped it out
of existence.

### 4.3 `/league/[id]/depth-chart`

Subtitle must state the real constants: *"Set who starts. The sim engine uses this order every
game — 11 on offense, 11 on defense, highlighted below."* Action: the auto-sort button.

Six facts:

| Fact | Detail | Link |
|---|---|---|
| Position Groups | "with at least one player". Keep colour **off** this one — 16 groups is not the problem, an unmanned one is, and that has its own tile | — |
| Open Starting Slots | the short positions, or "every starting slot filled"; `bad` / accent | `/free-agency?pos=<first>`. **An empty starting slot is not fixed by reordering — there is nobody to reorder.** Link the first position named, not all of them: the strip carries one href and the GM works the list top-down |
| Starter OVR | "across all N starters". **Put the colour legend here.** This page is cards, not tables, so there is no header row anywhere on the route to hang it on; this tile is the one thing already about the rating and it sits above every coloured number it explains. The alternative was a "?" in each group card header, printing the same bubble sixteen times down one screen | — |
| No Backup | the thin positions, or "depth everywhere"; warn / accent | `/free-agency?pos=<first>` |
| Injured Starters | "backups start automatically" / "none" | **none** |
| Out Of Order | the misordered positions, or "best man starts everywhere"; warn / accent | — |

**The Injured Starters tile reports and stops, and you must not give it an instruction.** It
read "reorder before kickoff" for long enough to have cost somebody a season of Sundays. Unit
computation filters a group through an availability check **before** it applies the depth
chart, so an injured man is skipped wherever the chart puts him and the next healthy man takes
his snaps. Reordering by hand changed nothing at all — and obeying the instruction was *worse*
than ignoring it, because the demote was permanent and nothing on any screen prompts a GM to
undo it when the man heals two or three weeks later. A starter left behind his own backup, for
a press the sim never read. Give it no link either: "No Backup" above already opens the wire,
and sending a GM shopping over an injury that clears itself in a fortnight is a worse answer
than none.

Count the open slots as `max(0, startersAt(pos) − healthy starters at pos)`. Average the
starter rating **across all starters, each counted once per slot he fills**, so a three-deep
receiver group weighs what it does on the field. **Exclude injured players from the
out-of-order check** — benching someone who is hurt is exactly right, and counting it makes
the number meaningless.

**Lay the groups out in CSS columns, not a grid.** A grid row is as tall as its tallest cell,
so a two-deep quarterback card sat in a box sized for the seven-deep receiver card beside it
and the page ran close to half empty. Use `columns-1 lg:columns-2 xl:columns-3` with
break-inside avoidance; reading order becomes top-to-bottom then across, which is fine because
every card names its own position.

Two up only from `lg`. The rows carry a cap hit, and in a two-column card at 768px that left
the name 105px — every man on the page truncated to a first name and three letters. At `lg`
the cards are 480px and the name gets 233px. On a phone the card is ~342px and long surnames
do truncate; **truncate rather than drop the money.** The name is a link to his card; a price
he cannot see anywhere else on the screen is the thing that has been reported three times.

Pass each row's cap hit through **the same function the cap page, the player card and the
trade board use**, and pass **null, not zero**, when he has no contract row — a man with no
deal is not a man on a free one.

### 4.4 `/league/[id]/cap`

Two views through `?view=advanced`, switched by Basic/Advanced pills in the masthead action.

**Label the masthead with the cap year the summary actually resolved, not the league year.**
Through the first two offseason weeks the ledger has rolled onto the new league year and the
league row has not, so labelling off the league row is how this page came to head next year's
salaries with last year's date.

Facts (5): Cap Space (+ "N% of the cap used"), Cap Limit, Committed (+ "N contracts"), Dead
Money ("already spent, unrecoverable" / "none on the books"), Mode (Realistic / Simplified).

**Non-compliance panel** — `bad`-bordered, the shortfall at the large stat size, then one of
four sentences. **Every one of them has to name the price.** Two of these branches used to end
at "the week advances anyway", which was true and was read — correctly — as "and nothing
happens". A club that closes a league year over the ceiling now carries the overage into the
next one as a real charge, so the sentence telling a GM he is not stuck must be the same
sentence telling him what it costs.

- Offseason roll: every team's books run heavy; expiring contracts only come off when free
  agency opens; the new league year starts whether or not you are under; **how much comes off
  by itself** when the re-sign window shuts; and *"Get back under it before this season closes:
  whatever you are still over by when it does is carried into the next league year as dead
  money."*
- Realistic mode and fixable: *"The week will not advance until you are back under the ceiling.
  Any combination of these clears it — cuts and restructures below, or a trade that sends
  salary out."*
- Fixable: *"Clear the shortfall before adding any more salary — signings, extensions, tags and
  trades are all blocked while you are over."*
- Not fixable: cutting everybody who frees space still would not clear it, most of the
  commitment is dead money that cannot be released, a trade is the only route, and the week is
  allowed to advance so you are never stuck standing still — *"That is a reprieve, not a
  pardon"*, and whatever you are still over by at season end will be on this page under "Cap
  overage carried".

Then the **Fastest route** list (N releases, each with its dead money and what it frees) and
**restructure candidates**, with the warning that a restructure buys room by pushing bonus
into later years and **raises the dead money you would owe if you cut him afterwards — only
restructure players you intend to keep.**

Point every release link at `/player/<id>?view=contract&from=cap`. The panel is a **sequence**
of releases, and a hard-coded return to the roster page made the GM navigate back here between
every one of them.

**Cap Usage bar:** accent under 85%, warn over 85, `bad` over 96, with a caption carrying
active salary and dead money.

Advanced only, in this order: the multi-year outlook panel **first** (the usage bar told
forward in time — same three quantities, four years of them, with the room left over as the
headline instead of the share used) → four metric tiles (Top-5 Concentration, Cap-Weighted Age,
Committed Next Year, League Spend Rank) → Best and Worst Value Contracts → Cap Allocation by
Position, Spend vs League Average, and a Cap Hit vs Overall Rating scatter → the dead-money
runway panel at the **foot**, above the Contracts table.

Put the runway panel below the analytics grid and above Contracts, not dead last: Contracts is
the page's reference table, it closes the page on Basic too, and an Advanced panel after it
would strand it. The column chart at the top already stacks the same money into every season
and prints each season's total, so the runway is the **itemisation of that segment**, not a
second rival account of the future — which is what it and an old line chart were when they sat
side by side.

**Contracts table, in both views, closing the page:** Player · Pos · Age · OVR · Cap Hit ·
Base · Yrs Left · **Cut: Net Saving / Dead**. That last pair is what turns the table from a
statement into a decision.

Empty state inside a value list: *"Nothing qualifies yet."* — not an empty box.

### 4.5 `/league/[id]/analytics`

Two views through `?view=advanced`; label the pills **Simple** and **Advanced**.

**Write the subtitle in the world, not about the implementation.** It said *"Everything below
is read-only arithmetic over what this save already produced — no projection the sim does not
make… Nothing on this screen feeds the simulation back"*: an engineer reassuring another
engineer, on the screen a player opens to feel like a front office. Say what the room is for
and point at the cap sheet and the stats page for acting on it.

Facts (6): Record (+ division position and games played) · **The scoring says** (expected
record, the luck delta, the unluckiest rank — and `—` with "no games played yet this season"
before kickoff) · Roster rating (+ rank, offense, defense) · Committed (or `—` with "cap mode
is off in this league") · Cap-weighted age · Projected finish.

Build ten panels on a 12-column shell, each inside an error boundary so one broken read cannot
take the page:

| Panel title | Span | View |
|---|---|---|
| Are You Paying For What You're Getting? | 12 | both |
| How These Games Are Actually Being Decided | 7 / 12 | both |
| What Is Left | 5 | advanced |
| Who Outperforms The Deal, Who Is An Anchor | 7 / 12 | both |
| The Cliff, Two Years Out | 5 | advanced |
| The Luck Ledger | 12 | both |
| The Drive Board | 12 | advanced |
| The Efficiency Room | 12 | advanced |
| Draft Return By Round | 12 | advanced |
| Is The Money Still Climbing? | 12 | advanced |

Put the four questions a GM asks out loud in Simple, at full width, so each has room to be
read rather than scanned. Everything in Advanced costs an extra read or an extra thirty
seconds of study, and neither is charged to a player who only wanted to know whether he is
getting value for money.

Close, Advanced only, with **"What we don't measure"** — three sentences: no snap counts, so a
lineman's week leaves no trace and his page stays blank; no play-by-play, so nothing is
per-play in the modern sense and drives are the smallest unit kept; no archive of what a unit
rated in past seasons, so every rating on the screen is today's. This replaced six paragraphs
headed "What the department cannot tell you, and why" that explained the database to the
player and printed a render-timing readout. **Keep the honesty — the alternative is a screen
that quietly omits what it cannot compute — but say it the way a real analytics department
would: "we don't track that", and move on. It does not apologise for its schema.**

Every rate read falls back to *"Nobody here has the attempts yet to be judged on a rate."*
Close the headline read with *"A rate is a claim about a player. The volume behind it is how
much the claim is worth."*

### 4.6 `/league/[id]/stats`

Three axes of state: `?scope=myteam` (tab) × `?split=playoffs` (scope toggle) ×
`?view=advanced` (pills). **Offer the Basic/Advanced pills on the League tab in the regular
season only** — the advanced blocks are regular-season constructs.

**Put the phase label in the eyebrow: `year · phaseLabel · Week n`.** The league week restarts
at 1 in every phase, so a masthead printing it bare says "2028 · Week 1" in the first week of
the regular season **and again** in the first week of the playoffs, with nothing on the page to
tell the two apart.

My Team facts: Stat Lines (`N of M`, "men with production") · Games Played · Ranked Against.
League facts: Players Ranked · Clubs · Games Played.

For Games Played, print "none played yet" at zero rather than falling through to "longest
season on the books". At zero the caption has nothing to be the longest *of*, and that is a
state a GM stands in for four phases, from the final whistle to the new schedule going up.

Tabs: **League** (`N clubs`) and **My Team** (the club abbreviation), the second only when
there is a user team.

**My Team pane:** a position-verdict strip with a footnote naming the qualifier (`Minimum N
games played to qualify`, or in the postseason *"Every man who has played in the bracket
qualifies."* — do not write a minimum where there is none, which reads as a rule). Then **one
table per row** per position section. Two-up fitted the short defensive tables and clipped
everything else: a quarterback's Advanced line is eleven columns and does not go into half a
screen. Each table header names how many men and **which number is painted** — "league
standing on X", or "not ranked, this game deals the numbers". That header line is doing the
job a deleted "Lg Rank · Avg" column did, at one fifteenth of the ink.

Close that pane with: *"No table for the offensive line: the box score records no individual
line for a lineman, so there is no honest stat row to draw for one. Click a lineman's name
anywhere on the roster for his contract and ratings instead."*

**League pane:** the same position cards, so the two tabs can be read against each other. Then,
Advanced only: a Luck Table (actual versus expected, every team sorted by how far their record
sits above or below what their scoring earned — top of the list has been winning close games,
the bottom has been losing them), passer-rating bars with a 158.3 maximum, and an
offense-versus-defense quadrant scatter with dashed league-average lines on both axes. Then the
category leader boards, top ten each, then Team Stats.

**Rank the leader boards by competition ranking, not array index.** Two men on 27 touchdowns are
both 3rd, prefixed `T`. Printing the index gave one of them 4th purely from where the sort
dropped him, which is how a card and a board come to disagree about the same player.

Write four distinct empty states and one per-table fallback:
- My Team, postseason, club did not play one: *"<City> <Nickname> did not play a postseason game
  in YYYY, so there is nothing to show here rather than a table of zeroes. The Regular Season
  split has the full year."*
- My Team, no lines: *"No stats recorded for this roster yet in YYYY — this fills in as the games
  are played."*
- League, postseason: *"No postseason games have been played in YYYY yet — this fills in once the
  bracket starts."*
- League, regular: *"No stats recorded yet this season — check back after Week 1."*
- Per table: *"No qualifying players yet."* / *"No qualifying passers yet."* / *"No postseason
  games played yet."*

In the postseason, print one line above the body: postseason production only, kept in its own
column since the day it was first recorded — a club's run adds games to these numbers and to
nothing on the Regular Season side.

### 4.7 `/league/[id]/standings`

Subtitle must state the seeding rule and the real constants: *"Division winners are seeded above
every wild card, so a division lead is worth more than a better record. Top 6 per conference make
the field; the top two get a bye."*

Facts (5, user team only): Your Record (+ percentage and week) · Playoff Position (`#N seed` /
`Outside`, with "Leading the division" / "Wild card" / "N games back") · Point Diff · Division
record · Streak.

| Panel | Render when |
|---|---|
| Playoff bracket | playoff games exist. **Once the bracket exists it replaces the projection** — a projected field is only interesting while the field is still undecided |
| Playoff picture | no bracket yet, and the user's conference has a field or a hunt |
| Power-rankings capsule | always |
| Division tables | always — one table per division, two-up from `md` |

Build the playoff picture as the bracket as it stands for the user's own conference: seeds in
order with the bye line and the cut line drawn in, a three-swatch legend (Bye gold, Division
accent, Wild card info blue), a note that it is projected from today's records **using the same
seeding rules the season finale runs**, then the clubs close enough to still take someone's spot
under a **Cut line** strap. Put it above the division tables — this is the screen a GM checks in
week 14.

**Dim the "somebody else's club" rows to 80%, not 70%.** The dimming says "this is not your
club" and still does at 80 — the user's row beside it is at 100 — but at 70 a losing streak in
the alarm colour measured **4.23:1**, the last rendered text on the page under the floor. At 80%
it is **5.15:1** and the row is still visibly quieter.

Division columns: seed chip (accent for a division leader, info blue for a wild card, `—`
otherwise, with a native `title` saying which) · Team plus a rank-delta arrow · W · L · T · PCT ·
DIFF · STRK · OVR (hide below `sm`). Use a native `title` on the OVR header — a nine-column table
cannot carry a "?" — reading "Team rating from the roster, with its rank across the league".

Before kickoff neither playoff panel renders and the division tables show 0-0 rows. That is
correct: it is what the standings of an unplayed season *are*. Do not write an empty state over
them.

### 4.8 `/league/[id]/power-rankings`

Give this its own screen rather than a block on the standings, for the reason a real league
publishes it as its own thing: **the standings are a record of what happened and this is an
argument about what it meant.** Thirty-two rows each carrying a rating, a margin, a form guide
and — for the ones worth talking about — a sentence, is a page, not a panel. Leave the standings
screen the capsule and the strength column, which is what a reader wants while looking at a table
of records.

Write the power snapshot **after** the board is built, so this week's ranking is compared with
the last week **on record** rather than with itself.

Facts, up to five, and **omit any that has nothing true to say**: Your Ranking (+ the move, or
the record and rating when there is no move) · Against The Record (the gap between the power rank
and a record-only rank) · Biggest Riser · Biggest Faller · Furthest From Its Record. Before
kickoff nobody has a record rank, so there is no gap to report.

**Write three different no-movement sentences, and make which one you get the information:**
- Out of season: *"Out of season this is a roster ranking: nobody has a record, so there is
  nothing to be above or below and no week-over-week movement to report. The weekly editions
  resume when the season does."*
- First snapshot of the season: *"First ranking on record for this season, so there is no movement
  to show yet. Next week every row carries its change against this one."*
- No earlier week available: *"No movement is being shown, because no earlier week is available to
  compare against — and last week's order cannot be recomputed after the fact, since a club that
  signed a free agent on Tuesday would rewrite its own history. Nothing is claimed rather than a
  zero that would imply nobody moved."*

Close with **"How this is worked out"**, printing the four component weights from the same
constants the ranking uses — never typed out — and stating what each is: **Résumé** (results
credited against the quality of who produced them: beating a good team banks more than beating a
bad one; losing to a good team costs less than losing to a bad one) · **Adjusted margin** (scoring
margin corrected for schedule strength, with single games counting for at most three scores so one
blowout cannot carry a season) · **Roster rating** (the same figure the dashboard and the handover
screen show) · **Recent form** (the last four games, the most recent counting most). Then: early in
a season the three result-based components are scaled down and the roster rating takes up the
slack, because six weeks of football is a small sample and pretending otherwise is how a table ends
up claiming more than it knows; and the index is centred so the league average is 50.

Open the page with the argument: *"Not the standings re-sorted — a 5-2 club that has escaped three
times against bad teams will sit below a 4-3 club that has been battering people, and the Δ column
says by how much."* Everything a ranking is built from must be on the row, so a ranking a reader
disagrees with is one he can check.

### 4.9 `/league/[id]/schedule`

**Do not render all seventeen weeks.** That produced a page roughly sixteen thousand pixels tall
that nobody scrolled. Separate out the two things a GM actually wants: his own season, one line per
game, and the league's slate for one chosen week.

Default the active week to the week being played, falling back to the last week that exists once
the season has run past the league clock.

**Order the user's own games by round first, then week.** Postseason rows are numbered 1–4, which
collides with regular weeks 1–4, so a plain week sort scattered a wild-card game between weeks 1
and 2 and labelled it "Wk 1". Label by round.

**Build a `scheduleDrawn` flag and branch every tile on it.** A season that has not been drawn yet
is not a season that is over, and this strip printed the second sentence over the first. The
schedule is created in preseason, so from the final whistle until the new season opens — the whole
of the offseason, the re-sign window, free agency and the draft, four phases of a GM's calendar and
most of what a new save walks through in its first hour — the league year has rolled and there are
no fixtures in it. Every tile then fell through to its end-of-season branch: **"season complete",
"none", "nothing left", under a masthead reading "2027 · Re-sign Window"** — while the body
underneath said the true thing. Tell the two states apart by whether there is a schedule at all.

| Fact | Drawn | Not drawn |
|---|---|---|
| Your Record | `W-L`, "N of M played" | `—`, "no football played yet" |
| Next Up | the abbreviation, "Week N · home/away"; **"season complete" only when the schedule is drawn** | `—`, "fixtures not out" |
| Games Left | the count, "still to play" / "none" | `—`, "nothing drawn" |
| Remaining SOS | the figure; "a hard run in" above .550 in the alarm colour, "a soft run in" below .450 in accent, else "about average"; "nothing left" when none remain | `—`, "no opponents yet" |

Panels: your own season (one row per game, club-tinted) → **Around The League**: a week pill bar
(active in accent, the live league week outlined in accent, the rest muted; show a postseason week
as its round's first four letters), then matchup cards two-up, with played games linking
`/game/[gameId]` and unplayed ones at 70% with pointer events off.

Under each played card put the margin and **one word, only when the word says something** — `tie`,
`one score` at 8 or fewer, `decisive` at 28 or more. A neutral result shows only its margin.

Empty state: *"Nothing drawn yet — The YYYY slate goes up when the new season opens in preseason
camp. Until then the offseason is the calendar — the re-sign window, free agency and the draft all
come first."*

### 4.10 `/league/[id]/news`

Facts (3): Filter (the label, "every category" / "one category") · Stories ("matching this filter")
· Showing (`a–b`, "page N of M"). Page size 60.

Filter pills: `ALL NEWS TRADE SIGN RESIGN CUT POSITION DRAFT INJURY CHAMPION FIRE DEV_MILESTONE
DEV_PROJECTION`. Use the **short** award codes here — these are chips in a dense feed, the one place
a full "Offensive Rookie of the Year" will not fit. Generate every award's chip style off one shared
list rather than writing a line per trophy; five hand-copied identical lines is how the sixth award
ends up rendering unstyled.

Give three types their own chip for a reason: **re-signs** because something actually writes them;
**position changes** because after a draft class lands a couple of dozen arrive league-wide in one
step and "who reshaped their line this year" is a question the unfiltered wire cannot answer once
the week's signings are on top of them; and **revised projections** because a ceiling coming down is
the one piece of development news a GM goes looking for and it must not be buried under stat-leader
filler.

Group rows under `YYYY · Week N` headings. Weight the treatment: a championship or an MVP is the
story of its week and an injury report is a line item, so do not render eighty identical rows.
Weight 3 for championship and MVP; 2 for the other trophies, firings, trades and draft picks; 1 for
signings, re-signs, tags, cuts, position changes and revised projections; 0 for stat-leader news,
injuries and development milestones. Weight ≥ 2 gets `py-4`, a raised backing, a 32px crest and a
`text-base` headline; everything else `py-2.5`, 24px, `text-sm`.

**Make the headline a link to the player whenever the row carries a player id**, and plain text
otherwise. A headline about one player should be a link to that player rather than a sentence with
his name in it; rows that are not about one man, and rows written before the column was filled in,
render exactly as they always did.

Paint a position change and a revised projection in **chalk, not the signing green**. A reshuffled
line is not business the club did on the market, and a revised ceiling is neither good news nor bad
news league-wide — the same chip carries both directions.

Pager: `← Newer` / `Older →` with `a–b of N`. Empty state: *"Nothing here yet."*

### 4.11 `/league/[id]/history` — Ring of Honor

Facts (4): Champions Crowned ("seasons completed", or **"no title decided yet"** at zero — do not
print "0 seasons completed"; gold when above zero) · Records On The Books (+ the season/career
split) · Awards Handed Out · Franchises.

| Panel | Render when | Build |
|---|---|---|
| Franchise Dynasty Score | always | every club ranked on its whole book — championships, playoff depth, win rate, draft hits, cap discipline, awards, league records held — silverware won long before the current front office included. Columns: Rank · Team · Since · Score · Driven By. **On the user's row, also print his own tenure line**, bounded to his hire year, so he cannot read the club's trophy count as his |
| The finals roll | any title exists | per year: champion, runner-up, and the championship MVP **as a link when the row carries a player id**, plain text when it does not — a legend from the seeded backstory has no player row to open |
| Single-Season and Career Records | records exist | Category · Record · Player + team · Year / As Of |
| Award Winners | awards exist | Year · Award (gold, 🏆) · Player · Team · Stat Line |
| Franchise History (`#franchise`) | always | a team selector, a club-tinted hero with the crest at 56px over a 220px watermark, championship pills, then the season table: Year · W · L · T · PF · PA · Result, with champion rows backed in gold at 5% |

Read the championship roll from the **season-record rows**, not from the championship transaction
feed. The season row is the one that also carries the record the club finished with, and the two
cannot disagree if only one of them is used.

Empty states: *"No completed seasons yet — finish a full season to start the history book."* and, in
the Dynasty Score's "Driven By" cell, *"Nothing on the board yet"*.

### 4.12 `/league/[id]/dynasty`

Make the subtitle state the whole rule: XP comes from what the club achieves with you in the chair —
wins, playoff runs, titles, awards, picks that hit — **never from repeating an action, and never
from a season decided before you were hired.** Every level banks one skill point, and points buy
what a front office can actually buy: a clearer read on the draft board, coaching that develops
players faster, and a cap staff who can tell what a signing really takes.

Give Dynasty its **own top-level nav category**, not a sub-tab under GM Career. As a second-level
item it only appeared once you were already in that category, so the whole progression system —
levels, XP, the skill tree — was invisible to someone who had never clicked GM Career, and it was
reported as **missing entirely**.

Facts (5): Dynasty Level (+ "Level N+1 at X more XP" / "Maximum level") · Total XP (+ "Since YYYY")
· Skill Points (+ "N spent · M earned", accent when unspent) · Record (+ completed seasons) · Next
Point ("Every level banks one"). State the one-point-per-level rule in the detail line rather than
leaving a GM to infer it from a counter that happens to tick every time.

Panels: **Level progress** (a bar, "X / Y XP toward level N+1 · Z to go", and an accent line when
points are unspent) → **the tree**, three branches in a declared reading order, each a column of
skill cards → **Perfect Evaluations** → **Front Office Intel** (Breakout Watch, N-Year Projections,
Aging Curve Read) → **XP Ledger** (Source · Detail · XP, with a Total row).

On the scouting-network node, show **both** counters it buys. A card that promises workouts and then
only counts evaluations is the kind of half-truth that makes a skill feel fake.

Close with: *"XP is recomputed from franchise history every time this page loads — there is no ledger
to farm and nothing to lose. Only your spent skill points and your remaining limited-use charges
are stored."*

Write one empty state per block, each saying which of three things is true:
- No Development upgrades at all: *"Nothing to report. Buy an upgrade in the Development branch and
  your staff's forward-looking work on the roster shows up here."*
- Node not bought: *"Locked."*
- Bought but nothing to say: *"Nobody young on the roster is standing out to the staff right now."* /
  *"No young players on the roster to project."* / *"No veterans on the roster to read."*
- No XP: *"No XP yet. You took the job in YYYY — win some games and this fills up. Franchise history
  from before you were hired does not count toward your career."*

### 4.13 `/league/[id]/gm` — GM Career

Hero: club-tinted, "GM Career", `CITY NICKNAME` in the team-text colour, *"On the job since YYYY —
N seasons and counting."* Right: a one-line description of the artefact and a reveal wrapping the GM
card.

**Describe the card, do not instruct the reader.** Write *"N seasons on one card, sized for a
screenshot."* — no verb aimed at the reader; the sentence describes the artefact and what he does
with it is his.

**Hand the card everything it prints from this page's own summary.** It is a second *view* of these
numbers, never a second source for them, and it is the half that leaves the game.

Three tabs, each carrying its own hint:

**Career** (`N seasons · W-L`): the badge grid, then five tiles — Record (+ win rate, or "No games
yet") · Championships (+ playoff trips, gold above zero) · **In January** (the playoff record, kept
apart from the autumn one *at the source*) · **In the Division** · **All-Star Players** (distinct
players in the headline, selections underneath — a five-time all-star quarterback is one all-star
player, not five, and the two must never be readable as each other) — then the **Season Log**.

Put the best season **on the Season Log's header and light its row.** Do not give it a panel: a
half-width "Best Season" box printed one year, one record and one playoff result, all three of which
are already in the row below it, verbatim.

**Synthesise the season in progress** as a row when it has no season record yet, or a first-year GM
sees an empty table while sitting on a 7-2 start — and **stand that row down the moment the real one
exists**, or the log shows the season twice and outruns the header count beside it.

**Draft** (`N picks · M hit`, or **"No picks called yet"**): the per-round summary and the pick table.

**Moves** (`N trades · M signings`): five tiles — Trades Made (+ `won · lost · even · still playing
out`, or **"None graded yet"**) · Signings · **Re-signed** ("your own men, kept") · Released ·
Franchise Tags — then the graded trade retrospectives titled "Every Deal You Have Made" with
Best-of-N / Worst-of-N labels, the dead-money panel, and **Your Latest Moves**.

**Count re-signs.** Keeping your own players is a decision and it belongs here. The extension and
re-sign paths both write that transaction type; on the save this was checked against it was 65 of
them for one club, every one invisible on the page about that GM's decisions.

**Do not add a "Drafted" tile.** The draft tab counts the same picks off the pick table, and two
counters for one number is how they end up disagreeing.

**Move the draft and trade headline tiles to the tops of the tabs that carry their evidence.** Each
was a headline with its evidence three screens away; the number and the table under it are read
together.

Derive the card's "best deal", the panel's "Best of N" label and the Trades-Made tally **from one
ranking, read three times, computed once** — the same quantity each verdict sentence is written from.
Claim a best deal **only when the verdict itself calls that deal a win**: a card boasting "Best Deal"
over a trade the panel grades as fair is the same figure saying two things, so a GM whose best deal
was merely fair gets his best season there instead.

Say "the trades are graded above" in the Latest Moves sub-head **only when a graded panel is actually
rendered.** On a GM who has never traded, pointing at one is the page describing a layout it is not
currently rendering.

Empty state: *"No moves yet — the ledger starts with your first signing or release."*

### 4.14 `/league/[id]/scouting` — Scouting Department

Subtitle: *"The board is free and everybody has it. Your edge is knowing where it's wrong — and
paying attention to the right handful of names for long enough to find out."*

**Facts with a class in** (up to 5): Class (link `/draft`) · Shortlisted (gold above zero, else warn
"star anyone to start") · **File By Draft** · Workouts · **We Disagree**.

- Drop **File By Draft entirely** once there are no weeks left. A per-week projection over weeks that
  will not happen is a rate for work nobody will do, and an em-dash tile is a tile saying nothing.
- Let the Workouts detail be **the same sentence the panel below quotes in full**, cut to tile width
  by the function that writes it. Do not read the phase again here — that is how a tile ends up
  promising a window the panel says is shut.
- Name the last tile **We Disagree**, not "Board Leader". The board leader was row one of the table
  200px below, rendered a second time. "Where the room is wrong" is the thing the GM came for.

**Facts with no class in: two only.** Three of the five would be an em dash, and a strip of
placeholders reads as a broken page rather than an early one.

**Replace the whole body when there is no class.** A save created this minute has none — league
creation writes rosters and a free-agent pool but no draftees, and the class is added on the preseason
step, so rendering the three normal panels produced a page that was an essay above three "nothing
here" boxes. Instead: a section headed **"The Class Isn't In"** with two paragraphs (next spring's
class lands the week the season kicks off, graded and ranked for every team at once, and from that
moment your department has the whole regular season to work it — the only thing it needs from you is
which names to live on; advance into week 1 and this page fills up) plus a scout's-room quote —
*"Nothing to look at yet. Get me to the season and I'll have names for you by the first bye."* —
attributed to the Director of College Scouting.

**Class-in body, three numbered sections:**

1. **The Consensus Board** (eyebrow "Free · public · identical for every team"; action "Whole class,
   sortable →"). Two sentences only: *"Every front office opens the year with these same grades. The
   room is **wrong** in six ways it will tell you about — pick one below and read the men it moved —
   and wrong again in ways nobody can name, which is why the first pick busts and the fifth-rounder
   plays a decade."* **Keep both halves of that.** The consensus number one busts about 12% of the
   time, so the page must not claim every error is named on the rows below. Cut the explanation of
   *which* biases exist and what each does: that is readable off the filter bar directly underneath,
   where it is a control instead of a claim.

   Then the bias filter, then the rows, then a footer that **says what the rows are and what they
   were truncated from** — a truncated list with no statement of what it was truncated from is the
   same defect as a count with no denominator, one level up. Right-align the legend (slot pull, board
   grade, band) and **anchor every bubble in it to its own right edge.** Which item is rightmost moves
   with the viewport because the row wraps, and a centred bubble on whichever one lands there is
   horizontal page scroll: 106px at 1440 before the last item was fixed, then 50px on the item beside
   it. Fixing them one at a time is a game of whack-a-mole with a flex-wrap.

2. **Who Your Staff Is Watching** (eyebrow "Free · every week · the only ongoing input"). Put the
   per-man attention split and the weeks left in the action slot — but once there are no weeks left,
   print *"The watching is done for this class"* instead. Keep the body to **one line**, and make it
   the **counterfactual** — what half this many prospects would buy. The paragraph it replaces
   restated the masthead tile beside it; the counterfactual is the half a GM cannot get anywhere else.

3. **Private Workouts** (eyebrow "Scarce · one class"). **Shut: one line** — the window label and
   "N of M still in hand". A four-line explainer over a grid of cards reading "Window closed" reports
   nothing; what a GM needs while it is shut is that his slots are intact and what closed them. Open:
   the window label, then a paragraph on what a workout does **and does not** tell you — *"He flies
   in, your people run their own testing, and every measurable comes back exact with the ceiling
   projection about as tight as it gets. It will not tell you how he reads a defense — that is the
   read that busts picks, and one day in a facility cannot settle it."* — then up to nine cards from
   the shortlist.

Empty states:
- Filtered board with no hits: *"No prospect <pool> carries the <Bias> tag this year"*, with a link
  back to the board.
- Class picked clean: *"Nobody left on this board — the class has been picked clean."*
- No named bias on anybody left: *"Nobody left on this board carries a named bias. Whatever the room
  has wrong about the men still here, it cannot tell you what it is."*
- Nothing starred: *"Nobody starred. Your staff is watching the class the way everybody else is — from
  the same public board. Star a prospect on any row above, or on the draft board, and they start
  working him this week, at no cost, for the rest of the season."*
- Nothing starred with workouts open: *"Star the men you are considering first. A workout is the last
  question you ask about a prospect, not the first."*

### 4.15 `/league/[id]/draft`

This is the largest route in the app. Build **six states**, and let the state decide whether the
two-pane toggle exists at all.

| State | Condition | Toggle |
|---|---|---|
| Pre-draft scouting | no draft running | **none** — the page is a masthead, your picks and the class. It is all board already |
| The War Room | board set, clock stopped | **none** — nothing can be taken yet; the panel that starts the draft **is** the page, and a "watch the broadcast" view of a draft that has not begun would be an empty room |
| Live rookie draft | state exists, not fantasy, phase is `DRAFT`, started | **The Board** (default) / **The Room** |
| Live fantasy draft | fantasy | **none** — it has no pick rows, so no broadcast and no order to run out |
| Finished | state complete | **The Class** (default) / **What's Left** |
| After the phase moves on | class flags cleared | **none** — the board empties and the page is a masthead over the recap |

Give each pane an **`id` for its job and a `label` for its name**: `board` is always the men — the
list, the filters, the search, your capital — and `room` is always the draft as an event: the
broadcast while it runs, its record once it is over. The two jobs do not stop existing when the
clock does; they change into *The Class* and *What's Left*. The label is free to change with the
moment; the id may not, because the situational default is written in terms of it.

**Why the toggle exists at all:** everything above the big board is something a GM *reads* — the pick
on screen, the feed, the run watch, the war-room panel, both best-available columns. The board is the
only thing he *acts* on, and it was last on the page, which put it furthest away at the exact moment
it mattered most. **Nothing is dropped** — every panel is in exactly one of the two — and **the clock
stands above both, always**, because a GM must never be unable to see whose pick it is.

**Keep the toggle on after the draft ends.** It used to switch itself off at the one moment this page
has the most on it: the recap arrives and none of the broadcast leaves. Measured on a finished
224-pick save at 1600×1000, the page ran **4,971px** — five screens — against 1,882px for the same
save mid-draft.

**Let the page choose the default, not the component.** The component guessed from urgency, so a GM
who opened a live draft holding pick 20 landed on the broadcast and the board he had spent a season
building was one click away rather than in front of him. A live draft opens on **the board**; a
finished one opens on **the recap**. In both cases that is also the leading tab, and a leading tab
that is not the open one is a screen disagreeing with itself. Read urgency only for scoping, and
treat it as what "the situation" *means*, not what it selects. **A finished draft is never urgent and
cannot become urgent** — no state, no next selection — so the recap leads on the first visit and the
tenth.

Scope the urgent note to on-the-clock or one pick away: *"You are on the clock."* / *"One name to
go."* One name away counts, because the point is to be **already looking at the board when the room
turns to you**, not to start scrolling once it has.

**Masthead** (suppress it entirely while a club is on the clock — the hero takes its place):

- Eyebrow: `Rookie Draft · Round N` / `Fantasy Draft` / `Rookie Draft` / `Scouting Hub`.
- Title: `Pick N of M` / `YYYY Draft Complete` / `YYYY Draft Class`.
- **Name the class for the draft these prospects are selected in, not the season being played.** They
  are generated during one season and drafted in the offseason after it, so the season year runs a
  year early and would not match the picks you would spend on them. **And handle the window between
  the last selection and the phase advancing:** the class that just went through is still flagged as
  draftees while the upcoming-draft year has already moved to next year's picks, so the old title
  called 176 undrafted men "the 2028 Draft Class" — a class that will not be generated until week 1
  of the coming season.
- Subtitle, three branches:
  - Class size zero: *"No names on the board yet. The class is not put together until the season
    kicks off — from week one it is yours to scout, right through to the draft, which opens after
    free agency."* **This branch is not cosmetic.** The line was picked without ever looking at the
    class size, so "scout them now" went out over a board with nobody on it — which is exactly what a
    brand-new league shows, because the class is seeded by the preseason step and a league is created
    sitting *in* preseason. A first-timer clicking through after free agency was handed an
    instruction, followed it, and got an empty screen with no way to tell whether it was broken,
    early, or his fault. The same hole opens again between one draft finishing and the next class
    arriving.
  - Class graded and the draft year has arrived: *"The season is in the books and the class is graded
    — your selections and where they land are below. The draft opens when free agency closes."*
  - Otherwise: *"The incoming class is browsable all season — scout them now, the draft opens after
    free agency."*
- Facts (4): Prospects / **Undrafted** (detail names the active filter and search, or *"nobody called
  their name"*) · Shortlisted · Your Picks · Well Scouted (warn at zero).

**The War Room panel** — the ten minutes before the commissioner walks out. Everything is ready and
nothing has happened yet, which is exactly what this panel has to say. Give it the same card
treatment as the on-clock hero, in its place, so it reads as the same object a moment later.

Club-tinted, 2px border, elevated shadow, hash texture, a 240px crest watermark. Crest at 56px,
`YYYY Rookie Draft · N rounds · M selections`, **THE WAR ROOM** in the team-text colour. Then a
paragraph: the class is graded and the order is set, who is first to the podium, how many selections
you hold and where the first lands — or *"You hold no selections in this draft — you can still watch
it, and the board comes to you if a deal happens."* — closing on *"Nothing goes on the clock until
you send it."* Four tiles: Your Picks, On the Board, Shortlisted, Well Scouted.

Then, when they apply: an unused-workout warning in the warn colour (*"the window closes when this
draft opens"*) — **state the scouting department's unspent budget before he spends the night
regretting it, not after** — and the rookie-cap warning. **Put the cap warning above the Start
button, never inside its confirm:** the workout confirm is one question asked once that vanishes when
there are none left; this is the state of the books and is true whether he clicks anything or not.

**Price that warning with the same function the draft charges with.** The rookie price had been
written out twice inside the draft function, once at the cap check and once at the contract write; a
warning quoting a different pool than the one that blocks him would be worse than no warning, because
he would trust it. Walk the picks in **selection order** rather than totalling them, because the
draft charges one card at a time. The reason this panel exists: a GM used to discover he could not
pay for his own first-round pick while on the clock with a short timer running — the worst possible
moment, and the only one the game offered him.

Close the panel with: *"Clubs go on a short clock once it starts. You can pause the board or
fast-forward to your selection at any point, and every pick is announced as it is made."*

**The board pane:** give the section an `id` so the rest of the app can link straight at the men.
Title it **Big Board** / **Still On The Board** / **Undrafted** — "still on the board" is a thing you
say while there is a board; once the seventh round is over these men are simply the undrafted, which
is also what the masthead calls them.

Action row: the prospect search, an `All` pill, a pill per position, and a `★ Shortlist (N)` pill.
**Make the search carry the position pill and the shortlist with it**, so typing narrows what is
already on screen instead of quietly resetting it — the search *is* a filter.

Print the workout ledger line directly above the men a slot would be spent on: `Private Workouts`,
`N of M left`, the window label, and "Fly a man in from his row" when the window is open and slots
remain. The header has carried a workouts tile for a while and the board gave no sign that spending
one was two clicks away, so the whole mechanic was read as missing. **Suppress that line in the war
room** (the panel above is already speaking about unspent workouts in its own words, at the moment
they stop being spendable, and a second line in different language is the page arguing with itself on
the one screen where the point is urgency) **and once the draft is over** (a budget nobody can spend
on men nobody can fly in, reported above a table of men who have already gone undrafted; the row
control is gone with the window, so the line would explain the absence of something the reader never
saw).

**Cap and scroll the table in every state** — `max-h-[44rem]`, `overflow-y-auto`, with a sticky head
so it pins to this container rather than the viewport and the column names stay over the numbers. The
scouting hub shows three hundred men and ran to **twenty-one thousand pixels** of one table; during a
draft slice to eighty, or to every man whose name matches a search. Nothing is dropped either way —
the rows scroll inside the box. The cap is also why the board view is one screen: under the toggle
this table is the first thing after the clock, and a 44rem box means the rows a GM is choosing between
are above the fold rather than somewhere down an eighty-row document the page grows and shrinks with.

Give the table a sortable **Ours** column — where this club's own scouts have him, on the same blend
of present and ceiling the room uses, and **only for men we have a real file on** — alongside
consensus, position, rating, age, potential and athletic rank.

**Make every board link scroll-preserving and non-prefetching.** A plain anchor reloads the document,
and a reload throws away the view the GM is standing in; and eighteen pills prefetching a
six-thousand-pixel page is a lot of server work for the seventeen he is not going to press.

**The room pane:** the broadcast hero (round and pick, "You Are On The Clock" / "<City> On The
Clock", the club, your next pick, and the next twenty clubs of selection order, with the live ticker
as the clock), the selection feed, the selection card, board depletion, a run watch over the last
twelve selections, and best-available.

Non-broadcast states close with **Recent Picks**. **Suppress it during the broadcast**, where the
feed says all of this *and* what each pick meant — the two together would be the same list twice.
Empty: *"No picks yet."*

Raise the selection card to a provider above the board. The pick action revalidates the route, and
the row that raised the card is gone from the board a moment later.

Board empty state: a row that **names which filter emptied it** — e.g. *"Nothing on your shortlist is
a `<POS>` still on the board."* — with undo links, plus a line pointing at the feed: *"This board is
the men still available — if his name has been called, he is in the feed in The Room."*

### 4.16 `/league/[id]/draft/broadcast`

Make this a permanent redirect to `/league/[id]/draft`. Build the broadcast here **first**, as a real
route at a real URL running on a real save, so it can be opened beside the board it would replace and
judged against it rather than against a description. Once it is judged and merged into the draft page,
keep the route so a link saved while it was a mockup still lands somewhere real. There is only ever
one draft page.

### 4.17 `/league/[id]/free-agency`

Title is the live count: `N Available`.

Write the subtitle as the whole minigame, plainly: the asking price is a number that gets it done —
offer it on the deal he is after and he signs — but most men will take something under it, and the
interest meter is how you find out how much; salary, term and guarantee are yours to set; every offer
he turns down costs you patience; rival teams are bidding on the same players, so a fair offer is not
always the winning one; and nobody holds his spring number forever — the longer a man goes unsigned,
the less he will take to sign now.

Facts (up to 4): Cap Space (link `/cap`) · On The Market (+ the whole-pool total when filtered) ·
**Best Available** (an exact rating when revealed or confidence is at least 90, else the range — and
**link the tile to his contract face**, because on free agency the reason to look at a man is his
price, so it opens where every other negotiation entrance opens) · Within Budget (warn at zero).

Panels: a **Top Available** strip (avatar, position, name, age, `Asking $X/yr` with "down from $Y" in
accent when he has decayed, a slot verdict badge, a rating badge or a scouting range, and
`Negotiate`) → position pills → a depth comparison for the focused row → the table.

**Make every pill and sort link scroll-preserving and non-prefetching.** Filtering is not navigating
away. This is the tallest page in the game (~6,000px) and it is worked in a loop — six to ten
signings to reach a legal roster on a new save — and every one of them cost a filter, a sort and a
scroll position to re-establish by hand.

**Write three different empty states, and give only one of them a button.** There was no branch for
this at all: an empty pool drew the masthead over a table with a header row and no rows, no Top
Available strip, and a pill bar carrying the word "All" and nothing else. It is not a rare state — it
is what a fantasy league looks like from the moment it is created until its draft is over, and the
market is one tap off the top nav, so it is one of the first screens a new save can reach. **A blank
table is the shape of a page that has broken; the reason it is blank is a fact about the league and
belongs on the screen.**

- Fantasy draft: *"Every professional in this league is in the fantasy pool, waiting to be picked.
  There is no free agency until the draft has run — whoever is left on the board when it ends lands
  here, and that is when this screen has something on it."* + `Go to the fantasy draft ▸`.
- A position filter with no hits: *"No unsigned `<POS>` anywhere in the league right now."* plus the
  count at other positions, and `Show the whole market ▸` when there is one.
- Genuinely nobody: *"Every man in the league is under contract. Nothing opens up until somebody is
  released or a deal runs out at the end of the season — the wire fills again when the offseason
  does."*

### 4.18 `/league/[id]/resign`

**Make the masthead know what month it is.** This page is reachable in every phase and it said
"2027 Offseason · Re-sign Window" over a league in week 5 of the regular season, with a subtitle
promising that undecided players are released "when this phase ends" — false in the regular season,
the playoffs and the draft alike. **During the window it is a deadline; outside it, it is simply the
list of men whose deals are running out**, which is worth having and is not a deadline.

- Eyebrow: `YYYY Offseason` in the window, `YYYY Season` outside it.
- Title: **Re-sign Window** in the window, **Contracts Running Out** outside it.
- Subtitle: the hometown-discount rule — *"it is at its biggest while a contract still has a season to
  run, and mostly spent by the offseason his deal is up"* — then, in the window, *"Whoever you leave
  undecided is released to free agency when this window shuts, and the rest of the league can call."*;
  outside it, *"The window itself opens in the offseason — that is when a decision becomes a deadline.
  Until then this is a list, and getting ahead of it is up to you."* Then a clause naming the cohort:
  in the offseason cycle, only men whose deals have actually run out, because anyone with a season
  still to play is next year's decision and is deliberately kept off it; in-season, only men whose
  deals end when this season does.

Facts: Decisions (+ "N more set aside") · **Franchise Tag** · **Expiring This Offseason** · Cap Space
(link `/cap` — the only tile here with an elsewhere, because the other two resolve in the rows below
and a link would reload the screen he is already reading) · On The Books.

**Put the franchise tag on the masthead.** It is one per league year, it only works inside this
window, and its control is a small pill inside a row you have to click open first — so a GM could play
a whole career without learning he had it. The tile is the sign on the door; the rules are unchanged.
In the window: `Used` / `1 left`, naming the tagged man, gold when available. Outside it: `1 a year`,
"usable once the window opens".

**Do not label the expiry tile "Already expired", in red, about men still on the roster.** Nothing is
lost: they are under contract, nobody may sign them, and they only walk if this window shuts
undecided. Label it **"Expiring This Offseason"**, let the detail say what is still true rather than
what is gone, and use the deadline amber rather than dead money's red.

**Make the two count tiles reconcile out loud.** The rule, applied across every surface: a count that
**prompts** you about a man drops the ones you have set aside; a count of what will **happen** keeps
them, because "not now" was never "he stays". Decisions is the first kind; Expiring is the second. Say
so in the detail — *"N of them set aside — they still walk"*.

Each row takes the current cap hit, the space available (current space **plus his own hit back**), the
years remaining, a tag state, the depth at his position, and a market figure. **Print the market figure
as a band, and never print his real number** — that would end the minigame this window is built around.
The market figure is pure arithmetic on rating, position and age; what he will actually sign for runs
it through a personality, a decaying loyalty discount, a premium for whoever else is calling and a
seeded wobble.

**Let the tag control own its own arithmetic.** The row used to be handed a dead-money figure for a
warning line beside a pill that committed on one press; the pill is now a priced, confirmed control
that resolves the whole bill from the server when it opens, and it is the same control the player card
renders. The row passes the rule, not the arithmetic.

Then **Set aside · N**, with a line that states the cost: *"Not released — but N of them is/are out of
contract and walks/walk when this phase ends."* / *"Not released. Their deals still have a season to
run."* Set aside is reversible and says so with a count and a control on every row, but a man parked
here whose deal is up still walks when the phase ends — state that **in front of** the decision rather
than after it, and have the advance itself refuse once and name them.

Empty states: *"Nobody's contract is expiring soon — nothing to do here. Advance whenever you're
ready."* and, when every row is parked, *"Every expiring contract is set aside. They are below, and
none of them has been released — bring anyone back before you advance."*

### 4.19 `/league/[id]/trade` — Trade Center

Facts (5): Pending Offers ("waiting on you" / "nothing incoming", info blue above zero) · Tradeable
Picks ("across all future years") · Cap Space ("before any deal", link `/cap`) · **Deadline**
(`Week N` / `Passed` "reopens in free agency" / `None` "trade year-round") · Trades Made.

Make the Trades Made detail *"graded on your GM page"* and **link it to `/gm`.** It read "graded
below", which was true only while the full history was rendered on this page; the tile must say where
the history moved to rather than point at something that is no longer here.

Swap the eyebrow to `YYYY · Deadline Passed` once it has.

Panels: pending offers → the trade builder → **this partner's** retrospectives.

Give the builder: both clubs, a partner selector over all other clubs each carrying a one-line
philosophy summary, both rosters, both pick sets, the initial give/get derived from `?reviewOffer=`,
both clubs' cap space, the cap mode, the deadline state, the forced-trade setting, the round count,
and the last trade's recap.

**Render the partner retrospectives only when there is a shared history.** An empty panel headed
"your deals with CLE" over nothing is worse than no panel.

**Assemble every figure on the recap card where the numbers live, not in the component.** The
depth-chart consequence must be the same function that prices a trade for the AI, read against the
roster as it now stands; the dead money must be the cap-charge row the executor actually wrote, not a
second calculation of what accelerates; and the two cap-space figures must come from the cap summary
on either side of the deal. Read the recap on every render, not only after a trade — the page has no
idea one just happened.

### 4.20 `/league/[id]/player/[playerId]` — the player card

Build one card with two faces: a hero, a summary band, and a pane the tabs switch between. What sits
**under** the card is the context you read it against — what he has won, and who is in front of him
on your own depth chart.

`?view=contract` opens on the money, and every negotiation entrance sets it; anything else lands on
stats. `?from=fa|cap` plus `?fq=` builds the return link, and `from=cap` also makes a release return
to the cap sheet.

**Hero:** jersey-coloured, the name lockup, honour pills (`N× All-Star`; an award pill naming the two
biggest honours and counting the rest when the cabinet is too full for the pill), then **one of three
stat bands**: a prospect's college line ("College — through week N of M"), a pro's season line, or
nothing.

**Label the pro's season band `YYYY` and "Regular season", out loud.** The hero is his headline number
and the postseason has its own view below; an unlabelled total that quietly means one of two things is
this codebase's most repeated bug.

**The rating block follows one rule: a certain number is said plainly, and only a real range gets the
band widget.**

| Case | Render |
|---|---|
| Overall revealed | the large filled rating chip, plus a change chip when a previous season's overall exists. **Absent, not empty**, when nobody has written his last season down — which is every player until the league finishes another season, and every rookie until his first year is over |
| Overall not revealed | a scouting range labelled "Scouted OVR" |
| Potential revealed | a plain number in its tier's ink |
| Overall revealed, potential not | the `low–high` pair plus *"You would have to coach him to know exactly."* **Do not use a scouting range here** — it would put "Confidence: HIGH" under it and invite the reader to think the band narrows with work. It does not, ever |
| Neither | a scouting range labelled "Potential" |

**Summary band — a prospect:** Draft Class (+ college) · Projection ("role this profile suggests") ·
40-Yard (+ Combine / Pro Day) · Competition (`N-tier`, "strength of schedule faced") · Measurables.

**Summary band — a pro:** `Cap Hit YYYY` (+ "N% of cap") — or, with the cap off or no contract,
`Asking` ("down from $X") or `Market Value` ("what the rating is worth") — and Years Left (+ "expires
after YYYY" / "no contract"). Let the terms row own the terms and the ledger own the money, and **never
print the same figure twice.**

**Stats pane:** Career Record (with a regular/postseason toggle; show the end-of-season overall **only
under the same fog gate the hero uses**, never off the true rating and never for a man whose ratings
this club has not seen) → College Profile with a full-width equal-tile testing band (guard it
separately, because older saves carry an empty testing blob where the college line still parses, and
half a band of dashes is worse than no band) → the scouting affordances and the full-evaluation charge
**beside the free ones, so what it costs is compared against what nothing costs** → **Scouting Report**
(confidence in the action slot; drive the prose's hedging off **each attribute's own displayed band
width**, not one aggregate number, so it can never assert more precision than the fog above is already
showing) → **Attributes**.

Lay the attributes **down one column then down the next**, not across: the order is the information, and
a row-major grid zig-zags it. Each row: a bar, a value, and its weight share. Show an exact number when
the player is revealed **or when that one attribute is individually locked** by a full evaluation —
same reason a known potential is not drawn as a range — else `low-high` with a marker at the observed
point.

**Wrap the attributes block in a reveal listening for this player's workout and full-scout signals.**
Nothing happens on a page load; the panel paints exactly as it always did. It reacts only when the
spend comes back and the new values are on screen: the fog comes off and the rows fill in, in the order
they are weighted. That is the whole purchase, so it is the one place in scouting that gets a beat.

**Contract pane — give a draft prospect none at all.** He cannot be signed, so rather than a tab onto
an empty box he has no tab.

Heading: `Rookie Deal`, `Franchise Tagged` and `Option Exercised` pills, **all in the past tense,
because they are states and not offers.** "Franchise Tag" sat in the heading's action slot beside real
controls and was reasonably taken for the offer — it is why the tag was reported as *"the option in the
contract tab, but no option to use it"*. The offers are buttons in the box below; these say what
happened to him. Then `N years · through YYYY`.

Then the deal as signed — Total value, Signing bonus with its per-year proration, Market value — and
quote **only what the ledger below does not carry and only what this cap mode actually charges**: with
the simplified cap there is no bonus proration, so there is no bonus line; with the cap off there are no
cap figures at all. Colour the market figure **only on a deviation big enough to matter**; market rate
keeps the default ink.

**Put the decisions above the evidence.** Release sat at the very bottom of this pane, under a
year-by-year ledger tall enough to push it off the screen. The decisions are the reason a GM opens this
tab; the table is the evidence he reads them against, and evidence belongs under the decision it
supports. So: the contract actions (extend, tag, option, restructure), a restructure note, the release
button, **then** the ledger.

Free agent and no contract: the sign-offer form. Neither: *"No contract on file."*

**Under the card, two-up from `lg`:** Your Depth at `<POS>` and **Position**.

Draw the depth list from **the same component the re-sign window uses**, not a second hand-rolled copy
— that copy is how the panel went two builds without the cap hits the owner asked for. With the cap off,
**do not draw the money column at all** rather than filling it with `$0.0M`. Two up only from `lg`: the
rows carry a cap hit and a term beside the rating, and in a half-width column at tablet size that left
about eight pixels for the man's name.

Put the Position card **directly under the depth panel**, deliberately: that list is the evidence this
decision is made against — "your left tackle is a 61" is half of "move the spare right tackle over".

**Offer a contract shortcut on the stats face only where the move actually exists:** extend needs more
than one year left; the tag needs an unblocked, untagged state; the option needs an open, undecided
window; restructure needs money to push. Naming a button here that the contract face then declines to
draw would be the same broken promise one screen earlier. Name the tag and the option on the stats face
when they are live, because the tag is the rarest move on this card and the one nobody found, and the
option is answered in one window and never again — a GM reading his young star's stats is exactly the
reader who would otherwise let the window shut.

Empty state: *"Nobody rostered at `<POS>` right now — a clear need."*

### 4.21 `/league/[id]/team/[teamId]` — another club

Short-circuit the user's own club: a masthead with **no facts**, subtitle *"This is your club."*, and
`Open your roster ▸`. Your own club has its own page, with the buttons on it.

Another club: eyebrow `YYYY · W-L`, subtitle *"Another club's roster, as your scouts have it. Nothing
here is yours to move."* Facts (4): Roster Size (+ "N scouted") · Average Rating · Cap Space ("over the
ceiling" / "room to take salary on") · Expiring.

Two buttons: `Open a trade with them ▸` and `Franchise history`, deep-linking
`/history?team=<id>#franchise`.

**Read every row through the scouting view with own-roster false.** Without that, the page is a list of
true ratings for a club you have never looked at.

Group the roster and split the groups into real positions — the line into LT/LG/C/RG/RT, the defensive
line into EDGE/DT, the secondary into CB/S — because a group label implies a group that lines up
together and these do not.

### 4.22 `/league/[id]/game/[gameId]`

404 unless the game exists, belongs to this league, **and has been played.**

**Choose the perspective rather than assuming it:** draw the silhouette from the side the reader has a
stake in — their own club when they played in this game, the home team otherwise. Comeback and Collapse
are the same game seen from opposite benches, so the perspective has to be a decision.

| Panel | Build |
|---|---|
| Scoreline | both clubs with crest, name and score, the winner marked; centre: the archetype tag, `Week N · KIND`, the margin phrase, and `· OT` in the info blue when it went to overtime |
| How it happened | the drive path (640×150) plus a quarter axis, captioned `<ABBR> score differential · N drives`. Five facts: Shape · Lead changes · Biggest lead ("never led") · Biggest deficit ("never trailed") · **Swing index**, hinted *"Sum of every score swing, weighted by how late it came and how close the game was — a curiosity, not a rating."* |
| Linescore | when quarter data exists |
| Recap | the generated write-up |
| Team Stats | Total Yards · Pass Yards · Rush Yards · Turnovers · Sacks Allowed · Penalties, laid out away / label / home |
| Leaders | box lines per club, two-up from `md` |

No empty state is needed: an unplayed game is a 404, not an empty page.

### 4.23 `/league/[id]/rebuild`

Build **one editorial screen** in the whole app, and make this it. Everything else is decluttered and
quiet on purpose; this is the exception that quiet exists to make room for. A GM took the worst roster
in football, was refused every setting that could have made it easier, and won a championship anyway.
Give it a full screen and a hero number.

**404 unless the run was actually won under the rules.** Not an empty state, not a teaser: there is
nothing honest for this page to show a run that has not finished, and a save that ended its ironman
rules did not do the thing this page celebrates.

Make it the **record** of the run, permanently reachable — not a moment that fires once. The
full-screen trophy interruption already has a budget of exactly one per season, and this must not spend
a second one. Route the championship advance here, route the settings screen here, and have it here
tomorrow and next year exactly as it is today.

| Panel | Build |
|---|---|
| Banner | club-tinted, 2px border, hash texture at 0.07, a 340px crest watermark. `The Rebuild · YYYY–YYYY`; `CITY NICKNAME` then **Champions** in gold at `text-4xl sm:text-6xl`; the hero number — seasons to the title at `4.5rem`/`5.5rem` in gold, tabular — beside Record over the run and The final (gold, "over the `<opponent>`"). Then the card reveal |
| Day one | "What you were handed" — the roster as inherited |
| Season by season | "The climb" — one line per season, bars scaled to the best win total |
| Rounds one and two | "The men you found" — the picks |
| Every trade you made | "The deals" |

**Compute nothing on this page.** Every figure comes from the run loader, and the page and the pop-out
card print the same object so the two cannot disagree — which matters more than usual, because the card
is the half that leaves the game.

### 4.24 `/league/[id]/settings`

Build two whole-screen states.

**Ironman — a live Rebuild run.** Replace the entire screen. *"This league is The Rebuild. Its rules
were set the day you took the job."* Then a warn-bordered **Locked** panel: a paragraph on what was
agreed (*"You took this job on the understanding that nothing about the league would bend for you.
Every club plays what its roster is worth, no trade goes through that the other side did not agree to,
and the ceiling is the same number next year that it is today — so there is no waiting for the money to
catch up with your mistakes. Win a championship and every one of these settings is yours again."*),
then four bullets: difficulty is Normal and stays Normal; forced trades are off and the other club
always gets a vote; the cap does not move from season to season; nothing else on this screen can be
changed either. Then the seasons-played line (*"Season one is not on the books yet."* at zero), the
abandon control, and the share block.

**Dead controls with no explanation read as a broken page; a page that says why reads as a rule.**

**Decide what this screen may offer with a database read — the same read the write path runs** — so the
screen and the rule cannot disagree. If the render is somehow stale, the write must still be refused.

**Ordinary.** A note that changes take effect from the next advance and nothing already on the books is
rewritten. Then, when they apply, a **"The rebuild is over"** panel with `See the whole climb →`, or a
**"The rebuild was ended"** panel stating exactly what is and is not kept (it keeps its history and its
dynasty level; what it does not keep is a claim on the Rebuild board, and there is no route back).
**Say which of the two ways it ended, because they are not the same thing and only one of them is on
the board.**

Then six sections:

| Section | Controls |
|---|---|
| Core Rules | Salary Cap Mode · **Cap Growth** · Difficulty |
| Scouting / Fog of War | Scouting enabled · Reveal true ratings everywhere (debug) · Fog applies to your own roster too · Scouting focus per week (0–10000) |
| Progression & Injuries | Progression speed (0–5, step 0.1) · Injuries enabled · Injury severity (0–5, step 0.1) · Retirement enabled |
| Transactions | Trades enabled · AI trade frequency (0–1, step 0.05) · Trade deadline enabled · Trade deadline week (1–season length) · Franchise tag enabled · AI accepts lopsided trades (easy mode) · Allow forced trades |
| Simulation | Sim variance (0–5, step 0.1) · Home field advantage |
| Presentation | Recap verbosity (Short / Normal / Detailed) |

**Put every cap-growth rung in one tooltip rather than a hint line under the control.** The choice is
only meaningful as a comparison, and a player reading "Slow" on its own has no idea what it is slow
compared *to*. **Format every percentage from the rung's real rate, never typed out** — the number in
the sentence must be the number the league is played under. Include the two consequences: wages are
quoted in today's money whatever you pick, so the faster the ceiling climbs the less it ever asks of
you; and changing it mid-dynasty moves the ceiling under deals already on the books, so lowering it can
leave clubs over the cap the next morning — including yours, and the season does not advance while you
are over it.

**Set every number input's `min`/`max` to the same bounds the server action clamps to.** A hostile or
fat-fingered value can never reach the sim because the action clamps it — but it could still be
*typed*, and the box would show it, the form would post it, and the screen would come back rendering a
different number from the one the GM just entered with nothing said about it: **a control quietly lying
about what it did.** Keep the server clamp as the authority and do not remove it — a form POST is a
POST, and `min`/`max` on an input protect nothing on their own.

**Anchor every tooltip on this page to its own left edge.** The form is left-aligned, so a label's
trigger sits near the left margin and a centred bubble opens off the screen — the cap-growth and
difficulty bubbles began 17px and 33px past the left edge at 1440.

**Put the share block outside the settings form**, and render the same block on both states rather than
two copies free to drift. It is not a setting — it is a download and an outbound link. The export
button, the generated filename, `Import a league file →`, and a paragraph stating it is **a starting
point, not a save game**: the file carries teams, players and contracts, not your schedule, standings,
scouting book or league history.

## 5. THE DESIGN ROUTES

Build these so a proposal can be opened **beside** the screen it would replace and judged against it
rather than against a description. Link none of them from the product nav.

### 5.1 `/design-system`

`max-w-5xl`, `space-y-16`. Three token sections, then fifteen numbered component specimens.

**Tokens:** Color — eleven swatches (ink, card, raised, line, chalk, muted, accent, bad, warn, gold,
accent2) plus a `--team-accent` swatch set per page/section, closing on *"Text hierarchy is
opacity-based on `chalk`, not separate colors: full opacity for primary copy, `chalk/80` for secondary,
`muted` for tertiary/labels."* · Typography — each stat step labelled with where it is used ·
Surfaces, Radii & Shadows.

**Specimens, in this order:** 1 Team Header · 2 Player Hero · 3 Player Row — Desktop Table · 4 Player
Row — Mobile · 5 Rating Presentation · 6 Scouting Range · 7 Draft Prospect Row · 8 Contract Summary ·
9 Cap Decision Panel · 10 Trade Offer · 11 News / League Wire · 12 Matchup Card · 13 Draft — On The
Clock · 14 Buttons · 15 Navigation — Mobile Concept.

**A design system that is not the source of truth is a style guide.** The reference implementation's
own system page states on itself that nothing on it is wired to real game data or reused in production,
and its desktop player-row specimen has no avatars while production roster rows do. That gap is a real
defect. **Either make the specimens the components production imports, or say on the page that they are
not** — do not let the two silently disagree.

### 5.2–5.4 `/design-system/dashboard`, `/player`, `/draft`

Full-page compositions assembled from those components with mock data, each labelled with its stage:
"Dashboard Composition", "Player Page Composition" (a signed veteran, with a draft-prospect variant at
the bottom), "Live Draft Composition" (the draft-day event view, as distinct from browsing the
year-round scouting hub).

Use these to catch layout bugs before a production page is touched. Real ones caught this way: a
matchup card that clipped a logo when squeezed into two columns with a score shown; a picks-feed label
that wrapped to two lines in a narrow sidebar; a prospect row whose names truncated mid-word once a
Draft button was added; a win-probability pill that was unreadable against the corner watermark (DOM
measurement confirmed it was not actually clipped) and needed a solid backing; and a duplicated
rating/potential panel on the player mockup that the hero already showed.

### 5.5 `/design-system/player-card`

Make this one a **fixture, not a mockup**: run the real career-record assembly and the real cap
functions. **A page that renders the shape by hand stops being a specimen the moment the assembly
changes.** Takes `?split=playoffs`.

Choose a specimen with awkward cases and keep them: a year with an event and no season line still gets
a row; a quiet season shows an empty column rather than a gap.

### 5.6 `/league/[id]/design/negotiate` — three directions

**Build nothing here as a sketch.** Resolve every session through the same function free agency, the
re-sign window and the extension form all call; draw the meter with the same decision function on every
drag; submit to the same server action against the same database. **A negotiation mockup with invented
salary figures answers nothing, because the whole question is whether the real numbers read well.** And
touch nothing in the live flow: the three screens a GM actually negotiates on stay exactly as they are.

Eyebrow: *"Design route — not linked from anywhere"*. Facts (3): Phase (+ week and year) · Your room
("what any of these has to fit inside") · On the market.

"What each direction is trying" — three cards:

| Key | Name | Pitch | What it is trying |
|---|---|---|---|
| `table` | The Table | Him on one side, your books on the other, the deal down the middle | A negotiation has two parties. The drag sits between the two things it changes — what he thinks of it, and what it costs you — instead of above one and below the other |
| `sheet` | The Term Sheet | The deal as a document that rewrites itself as you move it | Clauses in plain sentences with the controls set into the words they change, and the per-season schedule as part of the contract rather than a panel beside it |
| `room` | The Room | The negotiation as the series of calls it actually is | Every offer and every answer stacks up as the record of the talks, so a spent patience pip has a sentence attached to it. One column, and the only one of the three that works on a phone |

Then three groups of up to six real players: **An outside free agent** ("The open market. Somebody else
can sign him today, and the meter has to be honest about losing him."), **Your own expiring man**
("Nobody else may sign him — yet. The hometown discount is real and it is shrinking."), **An extension**
("Years still running are leverage a re-sign does not give you, and the new years go on the end."). Put
three buttons on every row, one per direction.

Empty state: *"Nobody on this save is in that state right now."*

### 5.7 `/league/[id]/design/negotiate/[direction]`

404 on an unknown direction. **Derive the mode rather than taking it from the URL:** a free agent is a
free-agent negotiation; your own man with two or more years left is an extension, otherwise a re-sign;
another club's man gets a refusal. Each server action re-checks its own case anyway, so a hand-typed
URL cannot route a negotiation into the wrong one.

Header: a back link, three direction buttons with the active one primary, and the direction's pitch.

**Read the subject's cap space from the cap summary**, so the panel and the page header cannot quote
two different figures for the same club on the same screen.

Missing-player states, each with `Back to the index`: *"No player named. Pick one from the index."* /
*"No such player in this save."* / *"He is under contract to another club. Trade for him, or wait."*

## 6. THE CROSS-CUTTING UI SYSTEMS

### 6.1 The page masthead and its fact tiles

Build **one** masthead component and open every front-office screen with it, so every screen
introduces itself the same way. The reference implementation built this pattern ad hoc on the Cap,
Depth Chart and Free Agency pages first and then duplicated it four times; pulling it into one
component is what makes the Team, Market and Draft tabs feel like one product rather than a set of
similar pages. **Do not let a page inline its own copy.**

Structure: a `relative rounded-lg border-2` plate with the elevated shadow, tinted with
`--team-accent` and a radial gradient at 16%. **Resolve the accent from the team's abbreviation, never
from its row id.**

Put the hash texture (115°, 0.05 opacity) and the 220px crest watermark (0.06) inside an
**absolutely-positioned clip layer, and put `overflow-hidden` on that layer rather than on the card.**
Clipping the card also cut the fact strip's tooltips, which open upward out of a band with only about
100px of masthead above them. Same pixels, one layer lower.

Then eyebrow (`.label-sm`) / title (`font-display font-extrabold text-3xl uppercase tracking-wide`, in
the team-text colour when a club is in scope) / subtitle (`text-muted text-sm max-w-2xl`) / an action
slot on the right.

**Size the fact strip to the number of facts, not to a fixed five.** `grid-cols-2 sm:grid-cols-3`, and
at `lg` one column per fact for 1–6. The depth chart passes six, which stranded the last one alone on a
second row beside four empty cells. Resolve the class from a **lookup, not a template string** —
Tailwind needs whole class names to survive its scan.

Each tile: a `.label-sm` label, an optional "?", the value at `.stat-value text-stat-sm` with an
optional colour, and an optional 11px muted detail.

Three rules bind every tile:

1. **Take the tooltip text from the glossary by key, never as a hand-written string.** Otherwise the
   same term ends up explained two ways on two screens.
2. **Set an `href` only when the destination is somewhere else.** A tile that links to the page it is
   sitting on is worse than an inert one: it promises a move and delivers a reload. With an `href`,
   render the tile as a link with a hover tint; without one, render it as a plain div, identical in
   every other respect. **The hover tint is the only signal a tile is clickable, so it must appear only
   where there is genuinely somewhere to go.**
3. **Open the bubbles upward, and open the end tiles inward** — anchor the first tile's bubble to its
   left edge, the last tile's to its right, and centre the ones between. The strip spans the full page
   width, so the first trigger sits against the left edge of the viewport and the last against the
   right, and a centred 18rem bubble hangs half of itself off whichever edge it is nearest. **It is not
   only ugly: the bubble is laid out whether or not anyone is hovering it, so the overhang gives the
   page a permanent horizontal scrollbar.** Measured at 1440 before the fix: 106px of document overflow
   on the Scouting Department, 13 on Analytics, and a left-edge bubble on the Cap sheet starting 22px
   off the screen. A single-fact strip takes `start` and opens rightward, the only direction it can.

**Use the fact strip as the place a screen names its own problems** — "Open Starting Slots: 2 — LT, K",
"Expiring: 7" — and link the tile that knows the position and the severity. Every one of those was a
bare div, so the tile that knew the most was the one thing on the page you could not click.

### 6.2 Navigation

**Outside a league:** build **one** site header component — the reference had three slightly different
copies in three files, so the front door read as four pages that happen to share a colour scheme. The
`D` mark, the "Dynasty GM" wordmark, and either a caller-supplied right slot or the account badge.

**Hide the wordmark text below `sm`.** At 390px the right-hand group and a full wordmark do not both
fit, and what actually happened was "Sign in" breaking across two lines. The `D` mark holds the brand in
the bar; the hero underneath says the full name at 48px.

**Inside a league:** two rows. Group every destination into the categories a GM actually thinks in —
front office, the market, the league around you — instead of one long flat strip of fifteen tabs.

| Category | Items |
|---|---|
| Home | Dashboard |
| Team | Roster · Depth Chart · Re-sign · Cap · Analytics |
| Market | Free Agency · Trade |
| Draft | Draft Board · Scouting Dept |
| League | Standings · Power Rankings · Schedule · Stats · News · History |
| GM Career | GM Career |
| Dynasty | Dynasty · **Leaderboard** (absolute — it is not a page of this league) |
| System | Settings |

Put Analytics under Team and after Cap: every panel on it is about this club's roster, money and
results, and it reads the cap sheet. Put the public leaderboard under Dynasty, because that is the
screen whose number it publishes.

**Show the active category's sub-row — and, on hover or focus of any multi-item category, that
category's items, swapped in place.** The sub-row used to render for the active category only, so
fourteen of the twenty-two destinations did not exist on screen until the GM had already navigated into
their category **on a guess**. On the dashboard he saw eight words, with Depth Chart, Re-sign, Cap and
Analytics all behind "Team" and six more behind "League". Swap in place rather than opening a floating
menu: the row is already there, it is already the right shape, and a panel that overlays the page would
have to be dismissed. **Never let a single-item category take the row** — emptying it would move the
whole page up under the cursor.

Bind `onFocus` as well as `onMouseEnter`, so tabbing along the bar walks the same preview. On blur,
check the related target against the nav container, so the row stays open while a keyboard user tabs
from a category **into** the row it just opened and closes only once focus has left the nav entirely.

**Never mark an absolute item active from inside a league** — you are on a league page, so highlighting
it would claim you are somewhere you are not. **Leave the whole nav unhighlighted for routes that live
outside every category** (a player card, a game) rather than guessing a parent.

**Badges.** Measured across a full league year: twenty-nine presses of Advance, and the button posed a
question the GM could have answered differently **once**. Every real decision in this game — the depth
chart, a trade, a cut, an extension, a bid — is something he has to go **looking** for, and the bar
could not tell him any of it was there: twenty-three destinations, no indicator of any kind, and
incoming trade offers rendered inside the trade page and nowhere else, so nobody who had not already
opened it knew a club was waiting on him.

Three counts qualify:

- `/trade` — pending inbound offers, from **the same query the dashboard brief counts from.** A nav
  badge reading 3 above a trade page listing 2 would be this codebase's signature defect in a new
  place.
- `/resign` — men who walk at the end of this league year, **and only while the window is open.**
- `/depth-chart` — the gap count, **reused from the same scan the banner reads**, so the badge and the
  banner can never disagree.

Two rules, and both are load-bearing:

**Every count must be off most of the time.** A badge that is always lit is furniture, and the second
one becomes furniture it also stops working for the times it mattered. That is why free agency carries
no badge at all — the size of the free-agent pool is non-zero every week the market exists, and a
number that never changes state is not news. It is also why the re-sign count is collected only inside
the window: in-season the same idea counts every walk-year man on the roster, non-zero essentially
always, on a decision with a twelve-month clock.

**Every count must be the number the system uses.** Compute them in the layout against the same queries
the destination pages run. The nav must count nothing itself, and there must be no second definition of
"expiring" or "unmanned" living in the nav file.

Treat zero and absent as the same thing, so a phase where a count is deliberately not collected needs
no special case. **Have a category wear the sum of what is waiting inside it**, because the item that
owns the number is invisible until the row is open.

### 6.3 The advance control

A split button: `Advance ▸` and a bare `▾`.

**Keep the caret a bare caret.** It briefly carried a "Jump ahead" label on the grounds that a
playtester never found the menu. The cadence has been ruled on: **watching a season go past one week at
a time IS the game**, and the offseason is already the truncated part. A word on that control
advertises the skip next to the button whose whole job is not to be skipped. Keep its accessible name
and its expanded state for anyone navigating by keyboard or screen reader; what it does not get is a
poster.

**Build the menu from the phase actually on screen.** It used to show the same five options regardless,
and once you were past the regular season those targets either did nothing or silently collapsed to a
one-step advance, which read as broken.

| Phase | Options |
|---|---|
| `RESIGN`, `DRAFT`, `FANTASY_DRAFT` | **none** — there is nothing to multi-advance into; resolve this stage first |
| `OFFSEASON` | Advance 1 Step · Advance to Re-sign Window |
| `FREE_AGENCY` | Advance 1 Week · Advance to Draft |
| `PLAYOFFS` | Advance 1 Round · Advance to Offseason |
| `PRESEASON` / `REGULAR` | Advance 1 Week · Advance 3 Weeks · Advance to Midseason · Advance to Playoffs · Advance to Offseason |

Give free agency no "Advance 3 Weeks": the phase is three weeks long, so it was a second button doing
exactly what "Advance to Draft" does — two ways to spell one jump.

**Drive the multi-week run one week at a time from the client, not as one opaque server-side loop.**
That is what makes real progress visible — *"Working through week 3…"* instead of a static spinner for
however long the batch takes — and it is the whole reason a stop is possible at all: **there is a seam
between every week, and the flag is read there.** Cap the loop at 60 iterations as a safety backstop,
not a target.

**Put the live progress sentence in a popover below the button, not on the button.** Held for a whole
batch it grows the button to the width of "Working through week 14…", which overflows the header at
390px and shoves the popover — and the stop control on it — off the right of the screen. One word on
the button, the detail one line below it, nothing moving sideways.

**Put the stop on the popover.** The popover is the only thing on screen that is moving, so it is where
the eye already is — and the Advance button is disabled for the whole batch, which a control meant to
interrupt the batch obviously cannot be. **Render it only for a multi-week run:** a single advance is
one round trip that is already over by the time a hand reaches it, and **a stop that could not stop
anything would be a lie in button form.**

Label it `Stop after this <week|playoff round|offseason step>`, and **swap the label on the press
itself, not at the end of anything** — the motion rules say animation never gates input, and this is
the control that rule was written for. The second label is `Stopping — finishing this <noun>…`: the
week in flight is finished either way, and claiming otherwise would be a false figure. Bind `Escape` to
the same request. Give it `min-h-[40px]` and `aria-live="polite"`.

**Hold the stop flag in a ref, not in state**, read fresh on every pass — a ref's current value is read
fresh however many times the user presses Stop — and **read it only between weeks**, where the week just
written is whole and the next one has not been asked for. Keep a parallel piece of state only so the
label can change.

**Then report what actually happened, not what was asked for.** Count the iterations and the collected
reports from advances that **returned**, and read the week it landed on **off the last report** rather
than restating it from the mode — so a run called off at week 8 cannot report having reached the
playoffs.

- Called off: `Stopped at <landed> — N advances taken. <last summary>`
- Finished, multi: `Advanced N weeks. <last summary>`
- Finished, single: the summary alone

**Check the mode's own stop conditions before the user's flag, and the order is the point.** If this
week was the one the mode was driving at — the playoffs arrived, a gate phase needs the user — then the
run **finished**, and a stop pressed while it was in flight has nothing left to stop. It must not
relabel a completed run as a called-off one, and it must not swallow the message a gate phase produces.

**Show exactly one report for a multi-week run.** Seventeen reports for one click would be intolerable,
and a player who asked to skip to the playoffs **has explicitly asked not to be stopped**. Collect
every week's report, show **none** of them as they arrive, fold them into one span strip — real
per-week results, the record at both ends of the run — and render the **last** week in the panel
itself, which is where the league actually now stands.

"Not to be stopped" means not stopped **by the app**. The user stopping his own run is the opposite
thing, which is why the stop flag travels with the span: **fold a called-off run from the weeks it
actually played, never from the weeks it was asked for.** "Weeks 3-17" after a stop at week 8 is a
fabricated figure.

A season can only end once, so take the **first** top-tier trophy in a span: a run that passes through
a title game and keeps going into the offseason still shows exactly one.

**Refuse in two shapes, and let the difference be whether there is anything to DO:**

- The cap gate and the roster-limit gate are standing conditions with a screen behind them, so give
  them a **sticky, dismissible panel**: the block's own title, the shortfall at the medium stat size in
  the alarm colour, the summary, a "Fastest route back" list of cuts with what each frees, and a link.
  **Let the title and the link travel with the block, not be hard-coded.** The cap gate was the only one
  when this was written, so the panel hard-coded "Over the salary cap" and "Open Cap Sheet"; cut-down
  day now refuses too, and a roster-limit block reading "Over the salary cap" is a lie.
- "The last advance is still being played out" is a busy signal that clears itself with nowhere to send
  anybody, so give it a **toast**. Rendering it in the block panel would put a red heading and an "Open
  Cap Sheet" button on a league with nothing wrong with it.

**Stop the batch immediately when the gate refuses**, rather than spinning sixty times against a closed
door, and drop a stop pressed during that same week — the refusal is the thing the user needs to read,
and nothing may be handled twice.

**Guard the whole thing against a double click with a ref, not state.** State is not committed until
the render after the first await, so the disabled state and the progress popover both flickered off
while the advance was still running — and a double click sends two advances, which write results,
progression, injuries, contracts and cap twice.

### 6.4 Toasts and week reports

Build the toast as an `w-80` card popover under the advance button, shown only when not busy.

Build the week report as a modal with **four ways out, none of them mandatory**: `Escape`, a mousedown
on the backdrop itself, the `✕`, and Close. Header: the week label (or the span label) with `is in the
books` / `are behind you` in muted, then `YYYY · phaseLabel`, hidden below `sm`.

For a multi-advance, carry the span strip: `N advances`, a `Stopped` chip in the info blue when the run
was called off, one chip per week (outcome, score, opponent, or `—` for a week with no game of yours),
and `recordFrom → recordTo`. Then the week's own result, the **Game ball**, **The room** (coach
reactions), and the count of the league's other injury reports.

**Pass the single-advance handler into the panel's footer.** The panel covers the advance button while
it is open, so the loop has to be able to continue from inside it, and it must be the same handler the
header button runs.

Let the trophy moment and the season-end card take precedence over the week report when both would
fire, and fire **at most one trophy per season**.

### 6.5 The moments / animation system

Build one stylesheet, no library, and put nothing in it on any path the simulation runs. Every moment
is a keyframe plus a class, and **every class must be additive — redefine no existing rule** — so the
file can be edited alongside a rebuild of any page without the two meeting.

**A moment earns its animation by being RARE or by being a DECISION.** Scouting a man costs a charge.
Drafting him is the only pick you get at that slot. Losing a shortlisted prospect to a rival happens
once or twice a draft. **Advancing a week is neither rare nor a decision, so wire nothing to it** — nor
to a page load, a table sort, or a tab switch. **The effect depends on most of the game staying still.**

Four things hold throughout:

1. **Nothing fires on a failed action.** Apply every class on the success path — the star fills when
   the write comes back, not when the button goes down.
2. **Nothing is gated behind a frame.** Final values are in the DOM at frame one; only decoration
   moves, and every control accepts the next click the instant the server answers.
3. **Durations are the motion tokens and nothing else**, so reduced motion is handled once for the
   whole file rather than once per animation.
4. **Reduced motion loses the movement, never the information.** Use `both`/`forwards` on every
   animation so a 1ms run lands on its **end state** rather than on nothing, and give any moment whose
   meaning lived only in the movement a second, static channel: the steal keeps its gold ring, the
   sniped prospect keeps his strike-through.

Keyframes to build: `moment-bar`, `moment-clock`, `moment-confidence`, `moment-flash`,
`moment-flash-lost`, `moment-flip`, `moment-fog`, `moment-pop`, `moment-rise`, `moment-stamp`,
`moment-star`, `moment-steal`, `moment-strike`.

Classes to build: `.moment-called`, `.moment-clock-tick`, `.moment-confidence`, `.moment-figure`,
`.moment-fogged`, `.moment-landed`, `.moment-lost`, `.moment-pick-badge`, `.moment-pick-card`,
`.moment-pick-name`, `.moment-released`, `.moment-sequence`, `.moment-signed`, `.moment-sniped`,
`.moment-star`, `.moment-steal`.

Tune the draft-clock beat **smaller than it wants to be**: a draft is 224 of them, and anything that
reads as a bounce the first time reads as a stutter by the third round.

**Fire most of them with no JavaScript at all.** A CSS animation runs when a node carrying it is
**inserted**, so a feed row for a new pick, or a card raised for a selection, animates once by
existing — and the same node re-rendered by a router refresh does **not** animate again, which is
exactly the behaviour wanted.

**Where a moment must fire on a node that was already there, remount it with a fresh key.** Do not add
the class and remove it on `animationend`: that is the right instinct on a hand-written page and the
wrong one in React. Putting the same class back on a node that already ran it does nothing, and the
remove-on-end dance becomes a two-render cycle that misfires whenever a re-render lands between the
two. Remounting is the same intent expressed in the framework's own terms — the old node goes, a new
one arrives with the class already on it, and it animates exactly once. **The `animationend` listener
is then unnecessary, which is the point.**

Export three things from the helper: a single `motionReduced()` read (one function, so there is one
answer in the app rather than two — only the one place that counts a number in JavaScript needs it,
since the token override handles everything that is pure CSS); a one-shot burst hook returning a key
and a `fire()` **to be called on the success path, never on the click**; and a **signal bus** —
`signalMoment(name)` plus a listener component.

Build the bus as a module-level map of callbacks with one counter per listener. No context, no provider
threaded through a page that does not otherwise need one. It exists because **a success in one control
sometimes lands somewhere else on the page**: a workout's button is in the scouting band and the
information arrives in the Attributes panel two sections down, which is server-rendered and knows
nothing about the click. A router refresh re-renders the server tree in place **without unmounting the
client components inside it**, so a listener mounted around that panel is still there when the new
attributes arrive.

Make the shared entrance animation read the state-change duration and the shared easing with `both` —
**do not invent a duration and a curve for it.** A hand-written `.25s ease-out` was the one animation
in the app that kept running at full length for a reader who had asked for reduced motion, because it
was a number written nowhere else.

**Keep that entrance a rise and not the rise-plus-scale a mockup will show you.** Half its consumers
are `fixed inset-0` modal backdrops, and scaling one of those from `.96` opens a bar of bare page along
all four edges for the length of the animation.

Scroll the wire ticker at 45s linear infinite, **pause it on hover** so a headline can actually be
read, and hold it still entirely under reduced motion — where you must **pin `overflow-y` explicitly**,
because setting only `overflow-x` makes the other axis compute to `auto` and puts a vertical scrollbar
on a single-line ticker.

### 6.6 The League Wire ticker

Build it as **ambient, passive flavour only** — a scrolling strip of things that already happened
around the league, **never a place for anything the player needs to act on or reliably see.** If it
scrolled past unread, nothing important was missed. Anything that matters stays in static UI: the front
office brief, the roster alerts, cap space in the header.

**Return nothing on an empty list.** Duplicate the items once so the marquee loops seamlessly at -50%.

Fix the `League Wire` label on the raised surface in the info blue with a 2px right border, and **stack
it above the track explicitly** — the marquee is a later sibling, so without a z-index the scrolling
headlines paint straight over the label as they exit left. Put an 8px gradient just under the label's
stacking level so items **arrive and leave** instead of being sliced: content reappearing at a hard
edge gets chopped mid-word, which reads as a rendering bug rather than as a marquee.

Each item: the crest at 14px, the abbreviation, the category kicker in that category's ink, then the
headline. **Mark the crest `aria-hidden`** — the abbreviation is the very next node, so without it a
screen reader says "TAM TAM".

**Put the club on every row that has one.** The strip read "SIGNING Signed Stellan Millsap / LEAGUE
Released Cassius Sinclair" — a name and a verb, with no club anywhere. Every one of those rows carried
a team id all along; only the render dropped it. **The crest is identity**, so add the crest rather than
more text. Rows that genuinely belong to no club — the all-star announcement, a power-rankings note —
start at the kicker.

### 6.7 Tooltips and the glossary

Build the tooltip as a `?` button plus an absolutely-positioned `role="tooltip"` bubble, revealed by
group hover and group focus-within. **Pure CSS, no client JavaScript**, so it renders inside server
components; keyboard-reachable through the button's own tab stop, not just mouse hover. Ship a
label-plus-tooltip convenience wrapper for the common case.

Three things about it are load-bearing, not cosmetic:

**Reset the typography inside the bubble** — `font-sans normal-case tracking-normal font-normal
text-left`. Triggers hang off the small-caps label class (uppercase, letter-spaced, often in a
right-aligned cell) and the section title class (bold condensed display), and a bubble nested inside one
inherits the lot. **Six lines of letter-spaced condensed capitals is not a sentence anybody reads.**

**Make it 18rem wide.** A glossary entry is a definition plus, usually, a sentence on what good and bad
look like; at 14rem that wrapped to a dozen lines and the bubble grew taller than the card it was
opening inside — **a clipping bug wearing a copy costume.** 18rem keeps a two-sentence tip to five or
six lines.

**Make placement a prop and use it.** The bubble is absolutely positioned, so **any** ancestor with a
clipping overflow cuts it off — and `overflow-x: auto` counts, because CSS computes the other axis to
`auto` the moment one axis stops being `visible`. The cap page's contract table sits inside a clipped
panel **and** a horizontal scroller, so a tooltip on its sticky header opened upward into two clipping
boxes: **it rendered perfectly and was completely invisible.** Opening downward keeps it inside the
scroller, where there is always table body under it. **Open downward from any trigger inside a scroll
container; a sticky table header is the usual case.**

Make alignment a prop too — `start` pins the bubble's left edge to the trigger, `end` its right — so a
trigger near the edge of a clipping box can open **inward**. The same overflow rule that eats a badly
placed bubble vertically eats it sideways.

**The glossary: one definition per term, for the whole game.** Build around 138 keyed terms in one
file, and read every explanatory tooltip in the app from it. That is the entire point of the file:
**this codebase's most persistent defect is two places describing the same thing and drifting apart** —
a twelve-man defence in two duplicated tables, a power-ranking note contradicting its own table, three
different definitions of "starter". With this, dead money is explained in exactly the same words on the
cap sheet, the player card, the re-sign window and the trade builder, and **a rewrite lands on all four
at once.**

Shape: `definition` is what the thing **is**, in football language; `why` is an optional second beat —
why a GM should care, or what counts as good, bad and normal. **Keep `why` optional**, because forcing
one produces padding and a padded tooltip is worse than a short one. Join the two with one function, so
a call site never decides how to present a term and two call sites can never present the same term
differently.

**Key it camelCase in an object, not an array.** A keyed lookup greps back to the file in one hop, the
lookup is O(1), and — the real argument — a typed key makes a misspelled term a **compile error rather
than an empty bubble in production.**

Where a layout genuinely cannot carry a "?" — a nine-column standings table — **put the same string
into a native `title`**, so the voice stays one even where the affordance has to change.

**The writing standard, which is the hard part and not the wiring:**

- **Useful and informative, never an explainer that breaks immersion.** A tooltip explains the
  **football** concept. It never mentions the database, a box score, a stat line, this save, the sim, or
  how a number is computed internally. Write *"Signing bonus you already paid, accelerated onto the
  books the year you cut him"* — not *"signingBonus / proration years"*.
- **Give a sense of scale wherever it can be supported honestly**: what is good, what is bad, what is
  normal. That is the thing a new GM actually lacks.
- **Take every threshold from this game's own tuning or from a real-sport fact — never from a number
  invented to sound authoritative.**
- **And where the two disagree, this league wins.** Quoting a real-world figure beside a table that
  never produces it is the lying-metric failure in its purest form: a tooltip telling a GM his best
  quarterback is bad at a number no quarterback in this league has ever reached. Describe **this**
  league's landscape.
- **Re-measure the bands whenever the sim is recalibrated.** The reference's bands once recorded a
  median back at 5.4 a carry and a median receiver at 8.6 a catch — all correct when written, all
  measured against an engine that has since changed. On the engine that ships today a back runs 4.55
  league-wide, a passer 6.26 an attempt and a receiver 10.11 a catch. **A stale benchmark is a lying
  metric with a timestamp.**

### 6.8 The lineup-gap banner

Build it for a starting spot with nobody healthy for it, and put it beside the cap alert in the league
header. It is a standing condition, it costs you every week it goes unfixed, and it is invisible on most
screens. The sim fills an empty slot at replacement level — a man off the street — so losing your only
quarterback is worth roughly forty rating points at the position that decides games, and the only place
that showed was the depth chart, **which counts bodies rather than men who can actually play.**

**Do not make it a block.** Real clubs play short-handed all the time; the game's job is to tell you,
not to refuse to run the week.

Headline: `No healthy <names>` when a position is empty, else `Short at <names>`. **Write the names the
way a person says them** — one name, "X and Y", or "X, Y and N more". "No healthy QB or TE or K" reads
like a list a machine made.

Body, two variants: *"Nobody on the roster can line up at `<POS>` this week. Whoever the coaches put
there plays like a man signed off the street, and it will show in the result."* / *"You are N short of a
full lineup across those spots. The empty slots get filled by whoever is left."* Controls: `Sign
someone` → free agency, `Depth chart`, and a dismiss `×`.

**Make it dismissible, and scope the dismissal to the hole he actually saw.** Sometimes there is nothing
to be done and the GM knows it — there may be no kicker on the wire worth signing, or he may have
decided to ride it out. Key the dismissal on the **exact set of positions and counts** in front of him
(`QB:1!,K:1`), stored per league in browser storage. Waving away "no healthy K" must not also hide "no
healthy QB" next week: a new hole has a different key and comes back loud, and losing a **second** kicker
changes the count so that returns too. **He is silencing one known fact, not turning the warning off.**

**Start hidden and reveal once the browser's answer is read.** The other order flashes the banner on
every page load for a GM who already dismissed it, which is a worse thing to do than appear a frame
late.

**Fail to always-showing** when storage is blocked or unavailable — that is the safe direction for this
particular control.

**Keep it client-side and per-browser.** This is a preference about being told something, not a fact
about the league, and it has no business in the save file where an export would carry it to somebody
else.

Put the dismiss button's own explanation on its `title`: *"Stops showing this particular hole. A
different one still gets your attention."*

### 6.9 Team logos and colours

Generate crest parameters from a seeded RNG: a colour pair, a shape, and a pattern.

**Seed it off the ABBREVIATION, not the team row's id.** A franchise has colours; it does not re-roll
them every time somebody starts a new save. A row id minted inside league generation made the same club
crimson in one league and olive in the next — and, worse, **no screen that exists before a league is
generated could show the crest**, which rules out the landing page and the picker.

Twenty colour pairs: crimson/gold · navy/silver · forest/gold · purple/silver · teal/bone · rust/amber ·
charcoal/scarlet · steel blue/amber · maroon/gold · olive drab/silver · slate teal/burnt orange ·
violet/cyan · pine/mustard · oxblood/silver · cobalt/tangerine · olive/cream · wine/rose · deep teal/ice
· saddle brown/silver · midnight/cyan.

Four shapes: shield · circle · hexagon · diamond. Five patterns: plain · stripe · chevron · split · ring.

**Below 40px, render only the abbreviation in a dark plate, dead centre.** This is not a compromise, it
is the point: at 20px a drawing is mud and the three letters are the only thing that reads, and **every
dense table in the app — standings, schedule, stats, trade — sits under that line.** The drawn mark is an
addition at header and watermark sizes, never a replacement anywhere.

**Give each shape its own geometry** — a mark centre, a mark scale, and a nameplate position and width.
A diamond's usable area is its inscribed square, which is far smaller than a hexagon's: drawing every
mark at one scale chops the corners off diamond crests, and hanging the nameplate at one fixed height
leaves it sticking out the bottom of one.

### 6.10 Player avatars

Render the face as layered SVG from a **pure function of (seed, age, body)**, and store nothing.

Style it as a **portrait, not a sticker**: the bust in a tinted frame with shoulder pads filling the
base, the head proportioned closer to life than to a bobblehead, and real shading — jaw, brow, neck
shadow — rather than flat fills. **Keep the detail deliberately bold**, because it is drawn at 20px in
roster tables as often as at 128px on a player card, so the silhouette has to survive when the fine
strokes vanish.

**Spend weight and age on the silhouette and on nothing else.** A 330 lb nose tackle and a 178 lb kicker
used to get the same neck, the same shoulders and the same jaw while the line of text beside them said
otherwise. Scale shoulder span, neck width and jaw width off mass, so **the heavy man reads heavy in the
first ten pixels — before a single facial feature resolves.** Scale the jaw asymmetrically: a heavy man's
jaw is where the weight shows, while a light man's chin must not narrow to the point it reads soft. Move
the skull barely at all; heads do not grow much with bodyweight.

**Leave everything above the jaw untouched and at fixed coordinates** — eyes, brows, nose, mouth, hair,
beard, skin. **The same seed must get the same face it always got, re-proportioned.** A call site that
passes no body must land exactly on the neutral build, reproducing the original geometry to the pixel.

**Decide for yourself whether to keep avatars in table rows.** An internal design review named the
portraits as the product's one real art-direction error at table sizes: at 20px in a table the portrait
is a coloured smudge costing 28px of row width and conveying nothing, and at 145px on the player card a
cartoon bust sits beside a jersey-back name lockup and a genuinely good piece of scouting prose. The
reference implementation keeps them at 13 call sites and the owner never ruled against them, so this
brief documents what ships — but **if you cut them from dense tables, cut them centrally and keep them at
hero sizes**, and do not treat it as licence to change a row's other contents.

## 7. BUILD THE DESIGN SYSTEM — "STADIUM NIGHT"

Put the whole system in two files: the Tailwind config as **the single source of truth for every colour
in the application**, and a global stylesheet holding the component classes, the motion tokens, and a
set of `--c-*` custom properties.

**Read those custom properties back out of the config through `theme()`. Do not hand-copy the hexes.**
Plain CSS needs them because a pseudo-element gradient, a `color-mix()` and the moments stylesheet
cannot spell `bg-card` — and before they existed those places carried raw hexes, **which is exactly how
a re-skin reaches nine tenths of an app and leaves the reactions painted in the previous palette.**
Change a colour in the config and every one of them must follow.

### 7.1 The twelve semantic colours

| Token | Hex | Role |
|---|---|---|
| `ink` | `#070a0f` | page background — also the mobile browser's theme colour, which must track it or it shows as a seam above the page |
| `surface` | `#0c111a` | header and tooltip surface |
| `card` | `#111925` | primary plate |
| `raised` | `#1b2634` | secondary surface — inputs, table heads, stat tiles |
| `line` | `#2e3d51` | borders and dividers |
| `muted` | `#a3b4c8` | muted text |
| `chalk` | `#eef4fb` | primary text |
| `accent` | `#3ddc84` | positive |
| `accent2` | `#63cbff` | info / house blue |
| `warn` | `#ffc043` | warning |
| `bad` | `#ff8383` | negative |
| `gold` | `#ffd24a` | elite / gold tier |

Add two **paired-ink** tokens, and name them:

| Token | Hex | On |
|---|---|---|
| `onAccent2` | `#04202e` | the info-blue chip |
| `onGold` | `#1a1200` | the warn/gold chip |

**A bright fill and the dark type on top of it are a pair, and half of that pair used to sit outside the
token layer as arbitrary `text-[#04202e]` classes** — so a palette change reached the fill and not the
ink on it. Name both halves so they move together.

Add the analytics categorical ramp, **in fixed order, never cycled or reassigned per chart**:

`viz1 #5fa8f5` · `viz2 #f0793f` · `viz3 #37c48f` · `viz4 #e3a92b` · `viz5 #f078a4` · `viz6 #39b859` ·
`viz7 #a89cff` · `viz8 #ff8f8f` · `viz9 #b48ce0` · `vizGood #5fa8f5` · `vizBad #ff8f8f`

Re-key these for the dark plate rather than carrying a lighter palette's steps over: the graphite-era
steps were mixed for a `#18181b` plate and go muddy on `#111925`. Keep the same hue order — **identity,
not value-rank, drives the colour for a categorical scale** — and lift lightness and chroma so eight
fills stay separable. Build the ninth step for the one scale that needs nine: the cap page's nine
position groups, which otherwise reaches past the palette for a raw hex, **and that chart alone would
then survive a re-skin in the previous app's colours.**

**Make the ramp blue-black, not neutral, and make it deeper than you think you need.** The graphite it
replaced read as a dark SaaS dashboard **because it was neutral**; every step now carries a blue cast,
because a stadium at night is lit blue-white and photographs blue-black, not grey. The deep dark end
gives the field grid and the club rail somewhere to sit, and it buys contrast headroom on every
light-on-dark pair: `muted` on `card` measures **8.35:1** here against **5.52:1** before. **That
headroom is exactly what pays for the denser type scale** — the type got smaller and every pair on the
page got *more* legible, not less.

**Make `line` markedly lighter than a neutral-skin border would be.** This is a flat skin: the shadows
that used to separate one plate from the next are gone, so the border does that work alone and has to be
visible at 1px.

**Lift `muted` and drop `chalk`'s surface in the same pass.** Every text pair in the app is
light-on-dark, so raising the light end and dropping the dark end move in the same direction.

### 7.2 `--team-accent`, the club rail, and `.text-team`

```css
:root { --team-accent: #38bdf8; }                               /* house blue fallback */
--rail: color-mix(in srgb, var(--team-accent) 62%, #7fe9e0 38%);
.text-team { color: color-mix(in srgb, var(--team-accent) 45%, theme('colors.chalk') 55%); }
```

Have a page or section set `--team-accent` via an inline style once it knows which club it is showing,
and have everything downstream read `var(--team-accent)` instead of hardcoding a colour — **so
recolouring one wrapper recolours every accent use inside it.** Fall back to the house blue when no team
is in scope.

**Do not give team-coloured text its own custom property. This is the single most important mechanical
note in the system.** A `var()` inside a custom property is substituted at **computed-value time on the
element where that property is declared** — so a `--team-text` declared on `:root` bakes in `:root`'s own
`--team-accent` (the house blue) and inherits that already-computed colour down, **ignoring every
per-team `--team-accent` set further in.** Nothing team-coloured is correct until this is right. Use a
utility class that does the `color-mix` in a **real property**, which resolves against the nearest
`--team-accent` at use time. `--team-accent` itself is still the right token for fills, borders and
watermarks.

**Mix 45% club colour into `chalk`, not 50% into white, and do not carry a previous skin's ratio over.**
The lightening is not cosmetic: several curated primaries — oxblood `#5c0f1a`, midnight `#1e1e2e`,
forest `#1e5f3a` — sit around **1.6:1** against this background and are unreadable as small text raw. A
50/50 mix into pure **white** measured against a lighter palette; at 60/40 it left **six of the twenty**
primaries short of 4.5:1, bottoming out at **4.04:1** on midnight over `raised`. Stadium Night changes
both halves of the sum: the light end is `chalk` rather than raw white, because a club colour mixed into
`#ffffff` on this page is brighter than the headings around it and **reads as a highlight rather than as
a name**; and all three surfaces underneath got darker. Re-measured across the same twenty primaries on
the same surfaces, **45/55 into chalk puts the worst case at 5.31:1** — better than the old 50/50
managed — so **the club keeps more of its own colour than before and every team still clears the
floor.** That is why it is 45 and not 50. **Re-measure it yourself if you change any surface.**

**Build the club rail as the skin's one structural device**: a 3px bar of the club's own colour down the
left edge of every plate, a band across the masthead, a rule under the sticky nav, the underline on the
live nav tab, the rule under a table head, and the mark on a hovered row.

**Do not use the raw primary for it.** Several curated primaries sit near 1.6:1 on this page and a 3px
bar of them **reads as a smudge rather than as a colour.** Lift it 62/38 toward a cold stadium-light
teal, which is enough to make every club legible as structure while still being unmistakably that
club's.

### 7.3 Typefaces

Three faces, all through the framework's font pipeline so each is **self-hosted, preloaded and
size-adjusted against its fallback.** A raw `@import` costs a render-blocking round trip to a third
party and a visible reflow on every navigation.

| Variable | Face | Weights | Use for |
|---|---|---|---|
| `--font-display` | **Oswald** | 500, 600, 700 | headings, nav, buttons, pills, every stat number |
| `--font-sans` | **IBM Plex Sans** | 400–700 | body copy, tables |
| `--font-mono` | **IBM Plex Mono** | 400–700 | money, ratings, every aligned figure |

Wire them on `<html>` and read them through `theme('fontFamily.*')`. **Keep the full system fallback on
every family**, so a blocked font request degrades rather than breaks.

Use a condensed display face, and **cap it at 700 for stat numbers, not 800.** Oswald is condensed
enough that its heaviest weight closes the counters of 6, 8 and 9 at fact-tile sizes, and **a cap figure
that cannot be read is worse than one that is a shade lighter.** For the same reason, set its tracking
**slightly positive** (`0.005em`) rather than negative: pulling it in further ran the digits of a
nine-figure cap number into each other. Give headings `letter-spacing: 0.02em`, because a condensed face
takes **more** tracking than a wider one to stop a long uppercase heading closing up into a block.

**Move body copy off the system sans stack.** That stack is a different typeface on every platform,
which is the one thing a 13px table of twenty columns cannot afford. Use a grotesque drawn for dense
technical reading: open apertures, unambiguous 1/l/I. Use its **monospaced sibling** for figures, so a
cap number in mono beside a label in sans reads as one voice rather than two.

**Set body at 13px / 1.4.** 13px against 14px is the single change that buys the most — a roster row, a
cap table and a fact strip all get shorter at once, and more of the board fits on one screen. **It is
only affordable because the palette moved with it in the same pass.** Bring line-height down with it;
Plex's x-height is large enough to carry the tighter setting.

### 7.4 Scales

**Radius — build a hard-edged skin.** 2px everywhere a plate meets the page, so the club rail and the
painted notch have a square enough corner to sit against. **Leave `full` untouched**: pills, crests and
the slider thumb are still circles.

| Step | Value |
|---|---|
| `md` | 2px |
| `lg` | 2px |
| `xl` | 3px |
| `2xl` | 4px |

**Shadow — build flat plates.**

| Step | Value | Use |
|---|---|---|
| `card` | `0 1px 0 0 rgba(255,255,255,0.05) inset` | the only plate shadow: a 1px top highlight reading as a bevel under stadium light |
| `elevated` | `0 18px 44px -22px #000, 0 1px 0 0 rgba(255,255,255,0.08) inset` | **genuinely elevated surfaces only** — open menus and popovers, the masthead, the on-the-clock state. Not every panel; reach for `card` first |

A 16px drop under every card read as **fog**, and fog over a yard grid reads as a rendering fault. Keep
`elevated` deep and much darker than the plate: on a near-black page a soft grey shadow is invisible.

**Container — widen it to 90rem** from the 80rem default. This is a dense skin, and at 80rem the roster
and cap boards had gone from full to half-empty. 90rem is what keeps a 20-column board reading as a
board on a 1440 screen.

**Body type:** `xs 11.5px/1.35` · `sm 12.5px/1.4` · `base 13.5px/1.4`.

**The stat-number scale.** Give big sports numbers sizes distinct from the body scale, and always pair
them with the stat-value class. **Make every step larger than a previous scale's even though the body
type shrank** — that widening gap is the skin's whole hierarchy, and a condensed face is narrow enough to
spend it.

| Step | Size | Line height |
|---|---|---|
| `3xl` | `clamp(1.6rem, 5.4vw, 2.35rem)` | 0.95 |
| `stat-sm` | `clamp(1.2rem, 4.4vw, 1.5rem)` | 0.95 |
| `stat-md` | `clamp(1.5rem, 5.6vw, 2.15rem)` | 0.92 |
| `stat-lg` | `2.75rem` | 0.9 |
| `stat-xl` | `clamp(2.9rem, 11vw, 4.6rem)` | 0.85 |

**Make every step above `sm` a clamp, and treat that as a fix rather than a flourish.** These sizes land
in fact tiles and metric tiles that sit two abreast at 390px — a track about 180px wide — and a figure
set at a fixed `2.15rem` does not fit one. **It cannot wrap either, so it pushed the whole document
sideways instead:** the cap page's four metric tiles were measurably the largest remaining source of
horizontal scroll on a handset. Make the floors the sizes that fit that track and the ceilings the sizes
the skin wants; every viewport past about 615px then gets the ceilings.

### 7.5 The body texture — the yard grid

```css
body::before {
  content: ''; position: fixed; inset: 0; z-index: 0; pointer-events: none;
  background:
    repeating-linear-gradient(90deg, rgba(255,255,255,0.026) 0 1px, transparent 1px 120px),
    repeating-linear-gradient(0deg,  rgba(255,255,255,0.016) 0 1px, transparent 1px 120px),
    radial-gradient(ellipse 90% 45% at 50% -8%,
      color-mix(in srgb, var(--rail) 16%, transparent), transparent 70%);
}
body > div.min-h-screen { position: relative; z-index: 1; }
```

**Build it as a fixed pseudo-element, not a `background-attachment: fixed` image on `body`.** That paints
the texture into the body box, so the grid **stopped at the end of the content and a short page showed
bare ink below the fold.** A fixed layer covers the viewport whatever the document height, and it costs
the compositor one layer instead of re-rasterising a fixed background on every scroll frame.

**Draw both axes, not just horizontals.** A field has yard lines **and** hash marks, and the cross-hatch
is what stops a 90rem-wide dark page reading as a void.

**Tint the top wash with the club rail, not plain white.** It is the stadium light itself, and it is the
one place the club's colour reaches the whole page.

Give it `pointer-events: none` and `z-index: 0` so it can neither take a click nor enter layout, and
**raise the app shell above it explicitly** — without that rule the fixed layer paints over the page
instead of under it.

Set `::selection` to a 25% accent mix.

### 7.6 The component classes

**`.card` — a flat plate.** `bg-card border border-line rounded-lg shadow-card`. Separate surfaces with
a border and a colour step, never with a drop shadow. **Give `.card` no club rail:** the rail marks a
*section of the front office*, and `.card` marks *one object inside it* — a player, a trade offer, a
matchup. `.card-pad` is `p-5`.

**`.panel` — the plate with the club rail.** This is the app's section container: a table, a chart, a
block of controls. `bg-card border border-line rounded-md`, `position: relative`, `box-shadow: none`.

**Make it opaque, not `bg-card/60`.** The yard grid behind the page shows through a 60% plate as a moiré
over every table.

Three decorations, and **make every one an absolutely-positioned pseudo-element so none of them can
enter layout, take a click, or change what is on the page.** `position: relative` is load-bearing for
all three.

| Part | Build |
|---|---|
| `::before` | the 3px club rail down the left edge, `opacity: .85`, `z-index: 3` |
| `::after` | a notched top-right corner. **Paint it, do not clip it** — a `clip-path` corner would also cut any tooltip that opens near it, and these panels are full of them. Draw a 13px triangle in the page's own `ink` laid over the corner instead. `z-index: 4` |
| the header band | the panel's own header row becomes a lit band: a `raised` gradient with the club rail bleeding out of its left edge. **Match it structurally** — the first child that draws a bottom border *is* the header — rather than asking every panel in the app to adopt a new class it does not need |

**Usage discipline: make section-based layout (heading plus divider) the default, and reach for `.card`
only when the content represents a genuinely distinct object.** Write the rule down in the stylesheet,
because the reference's codebase overwhelmingly followed it once it was written — `.panel` 122 times,
`.section` 86, `.card` 10 — and **the one screen that ignored it was the dashboard, which rendered seven
equal-weight cards: nothing primary, nothing receding.**

**`.stat-tile`.** `bg-raised border border-line rounded-md`, padding `0.3rem 0.6rem`. It is the densest
thing in the header strip — five or six abreast — so **shed most of its padding while making the figure
inside bigger.** Shrinking the box and growing the number is what makes a tile read as a scoreboard cell
rather than as a form field.

**`.btn` and variants.** `inline-flex items-center justify-center gap-1.5 rounded-md text-sm
font-display font-semibold uppercase`, padding `0.36rem 0.8rem`, `letter-spacing: 0.06em`, and
`disabled:opacity-40 disabled:pointer-events-none`.

**Set buttons in the display face.** Uppercase condensed type with real tracking is the difference
between a control that looks like stadium signage and one that looks like a link with a background — and
the tighter box is what lets a button sit inside a 12px table row **without setting the row height.**

| Variant | Definition |
|---|---|
| `.btn-primary` | `bg-accent text-ink hover:bg-accent/90` |
| `.btn-secondary` | `bg-raised text-chalk border border-line hover:bg-line` |
| `.btn-danger` | `bg-bad/15 text-bad border border-bad/30 hover:bg-bad/25` |
| `.btn-ghost` | `text-muted hover:text-chalk hover:bg-raised` |
| `.btn-tertiary` | `text-accent2 hover:underline px-1.5` |
| `.btn-icon` | `w-8 h-8 p-0 text-muted hover:text-chalk hover:bg-raised` |

**Depress buttons on press:** `.btn:active:not(:disabled) { transform: translateY(1px) }`, over the tick
duration. Nothing in this application depressed when it was clicked — the button was colour transitions
and nothing else, so **every control felt like a link rather than a button.** One pixel, 140ms,
sub-perceptual, and it is the whole difference.

**Write the transition property list out in full rather than replacing it**, so no button loses a
transition it had: an icon button's fill must still ease exactly as before.

**`.pill`.** `inline-flex items-center text-xs font-bold border`, radius 2px, padding
`0.02rem 0.42rem`, `letter-spacing: 0.04em`. **Square, not round**, and tight enough to sit inline in a
table cell: a pill-shaped chip is a SaaS tag; a hard-cornered one with heavy tracking is a jersey patch,
which is what these actually label.

**`.input`.** `bg-raised border border-line rounded-md px-3 py-2 text-sm text-chalk
placeholder:text-muted`, with a focus ring in the info blue at 60%.

**Set the placeholder at full `muted`, not `muted/60`.** On this control's own surface `muted/60`
composites to **2.81:1** — and a placeholder is text, often the only statement of what a field wants, so
that is below the floor. Full `muted` measures **5.33:1** there and is still plainly dimmer than the
value the user types, which is `text-chalk` at **14.5:1**.

**`.label-sm`.** `uppercase text-muted font-display font-semibold`, **10px**, `letter-spacing: 0.18em`.
Use it for every small-caps label in the app. On the display face at 10px with wide tracking it reads as
a broadcast strap rather than as shrunken body copy, and a condensed face fits the same tracking in less
width than the body face could. **Keep the colour at full `muted`**, which on this palette is a long way
clear of the floor on every surface it lands on.

**`.nav-link`.** `relative text-sm font-display font-semibold uppercase text-muted hover:text-chalk`,
padding `0.5rem 0.7rem`, `letter-spacing: 0.11em`. Build it as a **broadcast lower-third tab, not a
rounded pill.**

Build the indicator as an `::after` bar: 3px, no radius, and **inset to the item's own padding**
(`left/right: 0.7rem`) **so it measures the word, not the gap.** Hover shows it in `line`.

**Mark the active tab in the CLUB's colour, not the house green** — the rail is the same device that runs
down every panel, and the point of it is that the whole front office is that club's. Add a soft wash of
the same colour (a `180deg` gradient to 22% of the rail) to lift the tab off the band behind it.

**`.section` / `.section-head` / `.section-title` / `.section-eyebrow` / `.divider`.** `space-y-3`; a
flex head with `pb-2 border-b border-line/70`; a title in `font-display font-bold uppercase text-chalk`
at **14px** with `letter-spacing: 0.09em`; an eyebrow built on `.label-sm` but opened to
`letter-spacing: 0.2em` — **wider than `.label-sm`'s own tracking**, because an eyebrow sits directly
above a title in the same face and opening it further is what keeps the two from reading as one block of
caps; and a `border-t border-line/60` rule.

**`.stat-value`.** The display face, weight 700, `font-variant-numeric: tabular-nums`,
`letter-spacing: 0.005em`, `line-height: 0.95`. **Always tabular**, so digits do not jiggle across a
row. Pair it with the stat scale or an explicit size.

**`.table-clean` — build THE BOARD.** This is the densest surface in the app and the one that must change
most from a generic table. A roster, a cap sheet and a draft board are all twenty-odd columns of figures,
and a generic skin sets them as a **list**: one padding, one rule, no vertical structure. Four things
make it read as a board instead:

1. **A banded header** on `raised` with a 2px club rail under it, so the head is a strap rather than a
   row that happens to be bold.
2. **Zebra striping at 4.2% white** — enough to track a row across twenty columns, far too little to
   read as a colour.
3. **Column rules between cells.** *This is the one that does the work:* a grid of figures with no
   verticals is a wall of numbers.
4. **The hovered row marked in the club colour**, plus a 3px rail on its first cell — the same device as
   the panel edge.

```
.table-clean      w-full border-separate border-spacing-0 text-left; 12px; tabular-nums
.table-clean th   .label-sm, sticky top-0, text-chalk, bg-raised,
                  border-b-2 coloured var(--rail), padding .34rem .6rem,
                  9.5px, letter-spacing .1em, white-space nowrap
.table-clean td   padding .28rem .6rem, border-bottom 1px of line at 55%
```

**Two specificity rules, both of which shipped as live bugs. Get them right once:**

- **Put `text-left` on the table, not on `th`.** `.table-clean th` is specificity (0,1,1), so a plain
  `text-right` utility on a header — which is (0,1,0) — **silently lost to it, and every numeric column
  in the app rendered a left-aligned header over right-aligned figures.** Inherited from the table, any
  explicit alignment on a cell wins.
- **Put tabular figures on the table, not on the cells that happen to remember.** Every one of these
  tables stacks digits in a column — age, years left, record, snap counts. The ones carrying money or a
  rating already opted in individually; the plain cells did not, so **`Age` rendered proportional on the
  roster, cap, draft and free-agency boards while the OVR column right beside it rendered tabular: the
  same role, two treatments, on four of the busiest pages.** Setting it once on the table is what makes
  a column of numbers a column. Digits only — leave letters untouched so no label or player name shifts.

**Scale the row portrait, and know that it — not the padding — is what sets row height.** A 28px crest
holds a row open however tight the cells are, so bring it to 22px rather than pretending padding alone
did the work. Give a button inside a row `nowrap` and tighter padding.

**Other utilities to build:**

- `.watermark-logo` — `absolute pointer-events-none opacity-[0.07] -z-0`; **the wrapper controls
  clipping**, not this class.
- `.rating-chip` and `.rating-chip-flag` — the **proprietary rating shape**: a notched top corner instead
  of a plain rounded square, echoing the shield/hexagon crest language, with the notch filled by a
  separate tier-coloured flag positioned absolutely inside.
- `.scoreboard-digits` — the draft clock: each MM/SS pair in its own dark well, so it reads like a
  stadium game clock rather than a plain number in text.
- `.scroll-shadow-y` — a scroll affordance **with no JavaScript and no scroll listener**: two `local`
  opaque cover gradients that scroll **with** the content so they sit over the shadows only when you are
  already at that end, plus two `scroll` radial shadows pinned to the container. It auto-hides top and
  bottom independently. **Without it a max-height list slices its last row in half with no signal that
  there is more below**, and the trade builder's roster panels read as broken rather than scrollable.
  **Track the cover colour to the config through `theme()`** and expose it as a property for scrollers on
  other surfaces — a stale literal here is a seam that survives a whole re-skin.
- `.slider` — the negotiator's range input. Native range styling is inconsistent across engines and none
  of it matches this app, so **draw the track and thumb explicitly for both WebKit and Gecko.** Make the
  thumb deliberately large: this is a control the user drags repeatedly while watching a meter, not a
  set-and-forget form field.
- `.ticker-track` — the marquee.

**The feedback layer.** Build these to answer one gap: **the app told you what a number IS and never
what it CHANGED BY.** A cut takes cap space from $21.1M to $22.1M and the screen had never once said
`+$1.04M`. Give them all new names and restyle nothing existing.

| Class | Build |
|---|---|
| `.delta-chip` + `.delta-chip-in` | **sits beside a value, never replaces it**, and states the change in the user's own units. Rounded, bold, tabular, `pointer-events: none`, rising 4px over the state duration |
| `.delta-up` / `.delta-down` / `.delta-info` | accent / alarm / info blue |
| `.delta-tint` + `-up` / `-down` | **the tint channel — the half that still fires under reduced motion**, which is why polarity must never be carried by the rise alone |
| `.spinner-ring` | the in-flight ring, in `currentColor` so it works on primary, secondary and danger **without a variant each**. **Run it only while a request is actually open** — it is not ambient motion — and stop it dead under reduced motion, where the verb label carries it |
| `.range-sweep` | the scouting reveal: the band's edges sweep to the new low/high instead of simply **being** narrower on the next render. **The numeric label is already the new range at frame one** — this animates the transition *to* the answer, never the arrival *of* it. Make it opt-in, because the same component draws rows on list surfaces that must stay dead still |
| `.pip-well` / `.pip-fill` / `.pip-spent` | a patience pip that **drains** rather than just greying. Dragging a slider is free; submitting an offer is not, and the cost should be felt |
| `.rank-pip` | a purchased upgrade locking in — the pip **fills** rather than simply being filled on the next render |
| `.commit-flash` | a one-shot confirmation on a surface that just changed. **Colour only — nothing moves**, so it is identical under reduced motion (where it is switched off entirely anyway, because the delta chip beside it already carries the fact). **Paint it as an inset shadow rather than a `background-color`**, so it can overlay any surface without briefly erasing that surface's own background |

**The micro-interaction layer.** A flat, dense skin takes away the two things that used to tell a reader
a surface was live — the drop shadow and the hover glow. Put that back as movement: lift a table row
**1px** under the pointer, and lift a linked stat tile the same.

On a board of fifty rows the row lift is what separates "the row I am reading" from "the row the cursor
is over", **without a colour the zebra striping is already using.** Half the fact tiles are links — cap
space, workouts, the depth chart's open slots — **and none of them looked like it until it was clicked.**

**Put both on the shared component classes, so no page has to be edited to get them**, and **animate
`transform` only** — never a width, a height or an offset — **so neither can reflow a neighbour or move a
figure.** Take the durations from the same tokens, so all of it collapses under reduced motion without a
rule of its own, and note that none of it gates a click: these are hover and press states, so the pointer
is already where the user put it.

## 8. THE RULES THAT ARE NOT NEGOTIABLE

### 8.1 The motion rules

Write these three at the top of the global stylesheet, in these words, and hold every animation in the
app to them:

> 1. Animation never gates input. Buttons re-enable when the server answers, not when an animation
>    ends.
> 2. Animation never delays information. Final values render at frame one; only decoration moves.
>    **There are no count-ups anywhere.**
> 3. Reduced motion loses the movement, never the information. Every effect has a colour/opacity
>    channel that fires regardless.

And beside the tokens: *"These describe DECORATION only. No number in this app is ever gated behind
one: final values are in the DOM at frame one and every button accepts the next click the instant the
server responds."*

**Build no count-up, anywhere, and do not accept the argument for one.** A scouting-confidence figure
animated upward from zero and was defended as a receipt for a purchase. It broke *"final values render
at frame one"* and *"there are no count-ups anywhere"*, and **the cost fell exactly where it hurt
most: the one number on the page the reader was looking at was the one the screen would not yet say.**
If you want a receipt, move the reveal **off the digits and onto the decoration around them** — one
pass of a lift and a brightening on the surrounding node. The DOM shape, the accessible name and the
rendered characters must be exactly what they would have been.

### 8.2 The four motion tokens

```css
:root {
  --dur-tick:   140ms;   /* press, hover, pip */
  --dur-state:  220ms;   /* a value or bar changing */
  --dur-reveal: 450ms;   /* the two or three earned moments */
  --ease-out:   cubic-bezier(.2,.7,.3,1);
}
@media (prefers-reduced-motion: reduce) {
  :root { --dur-tick: 1ms; --dur-state: 1ms; --dur-reveal: 1ms; --ease-out: linear; }
}
```

**Four numbers, and every timed effect in the app reads them.** Honouring `prefers-reduced-motion` is
then **one override rather than a rule per animation.** Keep `--dur-state` and `--dur-reveal` inside
the 200–500ms interface band and `--dur-tick` under the 100ms direct-manipulation threshold.

**Audit for any animation that does not read a token.** Any duration or curve written anywhere else is,
by construction, the one animation that keeps running at full length for a reader who asked for reduced
motion.

The two animations that cannot collapse through a token — the spinner ring and the commit flash — each
need their own reduced-motion block: stop the ring and hold a static two-tone border, and switch the
flash off entirely.

**Verify like this:** emulate `prefers-reduced-motion` across every page and assert that **element
count, rendered text and interactive-control count are identical to the normal-motion run on every
one.** The movement is lost and no information is.

### 8.3 Legibility

**Every piece of text must clear 4.5:1 against the surface it *actually* sits on — computed through
every alpha layer and every ancestor `opacity`, not against its nominal token.**

**This is the rule because every failure found was a composite failure, not a token failure.** On
`card`, the tokens measure: chalk 15.8:1, accent 10.2:1, warn 10.6:1, accent2 8.3:1, gold 9.2:1, bad
6.4:1, muted 5.8:1 — **every base token clears AA and most clear AAA. A sweep that checks tokens finds
nothing.** The four failures that shipped anyway:

| Failure | Measured | Cause |
|---|---|---|
| A chart caption, `text-muted` at 60% opacity | **2.99:1** | an opacity on an already-muted token, for no reason beyond habit — the words already said the thing the dimming was there to say |
| The standings' other-club rows at 70%, with a losing streak in the alarm colour | **4.23:1** | an ancestor opacity over a mid-contrast token |
| An input placeholder at `muted/60` | **2.81:1** | an alpha on the token, on the control's own surface |
| Team-coloured text at 60/40 into white | **4.04:1** worst of twenty | a mix whose ratio was measured against a different palette |

So: **make the sweep automatic, and make it compute the background actually composited behind each
element** — walking up through every ancestor's background colour, every alpha, and every `opacity` —
**at 1440 and 390, across every route.**

**And validate the sweep itself by deliberately breaking a token and confirming it reports failures.**
A contrast checker that silently passes everything is indistinguishable from one that works, and it is
the more likely of the two. Break one colour, watch the sweep go red, put it back.

Ship against this standard: **zero rendered text below 4.5:1 across every page at both widths, worst
pair no lower than 5.15:1.**

### 8.4 Mobile

**Everything works at 390px. No horizontal page scroll. 40px+ hit targets.**

Four mechanical causes of sideways scroll were found. **Fix each where it starts, never mask it at the
root** — an `overflow-x: hidden` on a container hides the symptom and leaves the oversized track in
place.

1. **Never write a responsive grid without an explicit base.** `grid-cols-N` is
   `repeat(N, minmax(0, 1fr))`, so `grid lg:grid-cols-2` with no `grid-cols-1` base leaves **one
   implicit column** below the breakpoint — and an implicit track is sized to its content's
   `min-width: auto`, its max-content. Eleven call sites had this, and the player card's depth chart
   held such a track open at **607px inside a 390px viewport.**
2. **Never ship a fixed-width popover unclamped.** The help bubble is 18rem — 288px inside 390px — and
   it opens from wherever its trigger happens to sit. Clamp it to the viewport at every size and pin it
   inside the viewport below 520px, **matched on `[role='tooltip']` so both popovers and any future one
   are covered without either having to know the rule exists.** Hiding the bubbles was measured as
   taking the dashboard from 410px of document width to exactly 390.
3. **Never set a large figure at a fixed rem in a tile that sits two abreast at 390px.** It cannot
   wrap, so it pushes the document instead. Clamp it.
4. **Anchor a bubble on the last item of a wrapping row to its own edge.** A centred one pushed the
   league home page 85px sideways **at 1440**.

The handset pin, and the one line in it that is the whole repair:

```css
[role='tooltip'] { max-width: calc(100vw - 1.5rem); }
@media (max-width: 520px) {
  [role='tooltip'] {
    position: fixed !important;          /* ← the repair */
    left: .75rem !important; right: .75rem !important;
    top: auto !important; bottom: 1rem !important;
    width: auto !important; max-width: none !important;
    transform: none !important; margin: 0 !important;
  }
}
```

**Put `!important` on the position, and understand why before you remove it.** This rule lives in the
components layer; `absolute` on the bubble is a **utility**, and the utilities layer is emitted after
the components layer. So `position: fixed` lost, every other line won, and **the result was worse than
doing nothing**: `left: 12px` and `right: 12px` resolved against the 14px trigger instead of the
screen, `width: auto` then shrank to fit what was left, and **every help bubble in the game rendered on
a handset as a 22px sliver of wrapped text.** Measured on the live DOM at 390px, where the computed
position read `absolute`.

**Pin the vertical too, for the same reason.** Placement comes from `bottom-full` / `top-full` — 100% of
the **containing block**, which is the trigger while the bubble is absolute and the whole **viewport**
once it is fixed. Left alone, the corrected `position: fixed` would put every bubble exactly one screen
above, or one screen below, the screen. Pinned to the foot of the viewport it becomes a **sheet**: full
width, no word lost, never clipped by an ancestor, and — because a fixed box is out of flow against the
viewport — **it can no longer push the document sideways.**

Give every control a 40px minimum touch target, explicitly where the surrounding type would otherwise
set a smaller box — the advance control's stop button is the worked example.

**Measure, do not assume.** The reference's result after this pass: zero horizontal scroll at 1440 on
nine of ten pages, and at 390 the four worst offenders — roster, both player-card views and free agency
— go to zero, with 2–34px remaining on five pages. **Take the target as zero and close the remainder;
the honest measured state is recorded here rather than claimed away.**

### 8.5 Copy

**Write useful, informative copy in a front-office voice, never a tutorial one. No "click here". No
exclamation marks.**

Concretely:

- **Never let a screen explain its own implementation.** The analytics subtitle said *"Everything below
  is read-only arithmetic over what this save already produced… Nothing on this screen feeds the
  simulation back"* — an engineer reassuring another engineer, on the screen a player opens to feel
  like a front office. **Say what the room is for.** The point is a universe the player can get lost
  in, and nothing breaks that faster than the game explaining its own implementation.
- **Keep the honesty, change the register.** The alternative to saying what you cannot compute is a
  screen that quietly omits it. A real analytics department says "we don't track that" and moves on; it
  does not apologise for its schema.
- **Write no instruction and no verb aimed at the reader** where a description will do. *"N seasons on
  one card, sized for a screenshot."* — not "Click to generate your card".
- **Take the player's own words when he gives them to you.** "Already expired", in red, about men still
  on the roster became **"Expiring This Offseason"** after the owner said *"the term 'expired' on
  re-sign makes it feel like the contract is lost"*. **Twice is the words being wrong, not the
  reader.**
- **A sentence that names a consequence must name the price.** The cap panel's branches each end on what
  it costs, because *"the week advances anyway"* was true and was read, correctly, as *"and nothing
  happens"*.
- **A control's label must say what it does at every stage**, including mid-action.
- **An empty state states a fact about the league, not a failure** — and which of the three sentences
  you get **is** the information.
- **Never make a tooltip or a caption quote a benchmark this league cannot produce.** That is the
  lying-metric failure in its purest form.

### 8.6 Decluttered

**Length is not clutter; duplication is. The same figure must not appear twice on one screen.** Treat
this as a standing rule, not a one-off request.

Cut three things: **a second reading of a fact already on the screen**, **a panel that reports
nothing**, and **anything with no job on the page it is on.** The worked example is the draft-complete
pass: it cut a selection feed that was a **third** rendering of the same 224 picks, a "Best Available"
panel that was the first eight rows of the table directly beneath it re-laid-out, a war-room ledger
reading all zeros by definition once the board was empty, and a private-workout line offering a budget
nobody could spend. **4,971px to 2,771px, and nothing a GM would go looking for was lost.**

**Do not cut depth.** The owner, on the GM career page: *"I would rather have a lot of really cool data
on GM career across 2 or 3 tabs rather than minimal on one tab to save room."* A long panel with one
job, a clear hierarchy and room to breathe is good; a short one where four things fight is not.

Apply it like this, and these are all real edits:

- Replace a "Best Season" panel with **a clause on the Season Log's header plus a lit row** — all three
  of its figures were already in the row below it, verbatim.
- **Move a headline tile to the top of the tab that carries its evidence**, rather than leaving the
  number three screens from the table that proves it.
- Print a caveat **once** at full weight, not again under the tabs.
- Replace a "Board Leader" tile with **"We Disagree"** — the board leader was row one of the table 200px
  below.
- **Delete a tooltip that explains a denominator the cell already prints.**
- **Omit a category nobody has produced in yet rather than showing a zero** — an empty leader board reads
  as broken, a shorter one does not.
- **Drop a tile that would read `—`.** An em-dash tile is a tile saying nothing; the Scouting Department
  drops three of five before the class lands rather than printing placeholders.
- **Never build two counters for one number.** That is how they end up disagreeing.

### 8.7 One definition per fact, read everywhere

This is the rule the previous six keep running into, so make it explicit: **when two surfaces state the
same fact, compute it once and have both read that.**

Every one of these was a shipped bug caused by breaking it: a nav badge reading 3 above a trade page
listing 2; a "starter" defined three different ways; a twelve-man defence in two duplicated tables; a
power-ranking note contradicting its own table; a rookie price written out twice inside the draft
function, once at the cap check and once at the contract write; the roster page and the depth chart
disagreeing about who starts; a card claiming "Best Deal" over a trade the panel below graded as fair; a
"Trades Made" tally that could disagree with the verdicts it was summarising.

The three forms this takes:

- **Shared function.** Starters, cap hits, lineup gaps, rookie pools, trade fit, scouted views — one
  function, called by the sim, the pages and the components alike.
- **Shared constant.** Award types, position groups, file limits, cap-growth rates, power weights,
  glossary text — one list, spread into every consumer, never typed out twice.
- **Read, never recompute.** A frozen all-star snub, a stored power-rank movement, a written cap charge,
  a ranking a verdict sentence was written from. **If a value could have changed since it was decided,
  recomputing it lets the page change its mind.**

## 9. WHAT NOT TO REDESIGN, AND WHY IT FAILED

Nine rounds of design exploration were put in front of the owner before one was accepted. **Every
rejected round changed layout, structure or workflow, and the verdict each time was that functionality
and playability got worse.** What was finally accepted was a **re-skin**: same bones, new look.

So: **treat layout as expensive and skin as cheap.** A palette, a typeface, a radius scale and a set of
pseudo-element decorations can be swapped in a few commits and verified mechanically. Moving a panel,
merging two tiles or re-ordering a page cannot be verified mechanically at all — it has to be played —
and nine rounds of this project's history say that is where the losses are.

**The contract the accepted round held itself to, and the one to hold yourself to:** no element changed
order, presence, wording or count. Only colour, type, radius, shadow, density and texture changed. In
the commits' own words: *"No page was touched and no markup moved; three files gain one class name
each"*, and *"every decoration is an absolutely-positioned pseudo-element so none of it can enter
layout, take a click, or change what is on the page."*

Where a figure was re-measured rather than carried over — the team-text mix, the border step, the muted
and chalk ends — it was re-measured **so the same element could keep doing the same job more legibly.**
Never so it could do a different one.

Verify a re-skin as **a diff of behaviour, not of pixels**: element count, rendered text and
interactive-control count identical to the pre-change run on every page.

### Specific things not to do

Each of these was proposed, defensible as design, and wrong here.

- **Do not surface a player's underlying attribute values where the fog is meant to withhold them.**
  Hiding them is what makes scouting a decision. Where a value is known exactly, print it plainly;
  where it is not, print a band — and never put a confidence figure under a band that cannot narrow, or
  the reader will spend charges trying to narrow it.
- **Do not collapse the dashboard's panels into one grid of equal cards.** The reference's dashboard
  did exactly that — seven identical bordered cards, nothing primary and nothing receding — and the
  most saturated element on the whole page was Roster Needs: five identical full-width red bars, each
  labelled "Urgent". **A meter pegged at 100% for every row carries zero bits, and the loudest thing on
  the page was the least informative one.** Rank and differentiate instead: "LB — none rostered", "QB —
  −13.9 ovr".
- **Do not render a constant column at full weight.** "Active" on 27 of 28 roster rows, "Unevaluated" on
  300 of 300 draft rows, a "Negotiate" button on all 100 free-agency rows. **A column whose value never
  varies carries no information; make it blank-unless-notable.**
- **Do not spend the colour budget on a continuous scale.** Rendering a rating in four hues tells a new
  player nothing about whether blue outranks green, and it leaves nothing left to spend on things that
  genuinely need attention. If you keep a tier ramp, **carry the tier with a glyph as well, so colour
  never works alone — and put the legend somewhere on every page that shows a coloured rating.**
- **Do not spend 512px of a draft board on furniture.** On the reference's draft page, the masthead band
  plus ticker, header, nav, sub-nav, class outlook and filter row consumed 512px before the first of 400
  rows, so you saw 18 rows on a 1400px screen. **Information density is this genre's defining metric.**
  Fix it by capping and scrolling the board, and by compacting the band — **not by deleting the band,
  which is how every screen stops introducing itself.**
- **Do not remove the week-by-week cadence or make the skip the headline control.** Watching a season go
  past one week at a time **is** the game.
- **Do not turn a warning into a block.** Real clubs play short-handed; tell the GM, do not refuse to
  run the week.
- **Do not add an instruction to a tile that reports a condition the game already handles.** The
  "reorder before kickoff" line on Injured Starters was false, and obeying it was worse than ignoring
  it.
- **Do not let a design route drift from production.** A design system that is not the source of truth
  is a style guide, and the gap between a specimen with no avatars and a production row with them is
  the whole diagnosis.

### Build the design routes as real routes

When you do propose a change, build it the way the broadcast and the three negotiation directions were
built: **a real route, at a real URL, running on a real save, with real functions behind it**, so it can
be opened beside the screen it would replace and judged against it rather than against a description.
**A mockup with invented numbers answers nothing**, because the question is always whether the real
numbers read well. Touch nothing in the live flow while it is under review, and keep the route after it
merges so a saved link still lands somewhere real.

## 10. VERIFY

Check all of the following before calling these screens done.

**Routes.** All 39 routes exist at the exact URL patterns in §1. Every query parameter accepts the
listed values and falls back as listed on anything else. The broadcast route redirects. An unknown
negotiation direction 404s. The rebuild page 404s unless the run was won. A save the viewer does not own
404s. A team, game or player id from another league 404s. An unplayed game 404s.

**Panels and facts.** Every masthead carries the same eyebrow/title/subtitle logic and the same fact
tiles in the same order, with the same colour rules, the same glossary keys and the same links — and
**no tile links to the page it is on.**

**Empty states.** Every state in §2–§5 renders its own sentence. In particular: a brand-new league shows
a pitch, not a bare save list; a drawn-but-unplayed schedule never says "season complete"; an undrawn
schedule says so in all four tiles **and** the body; free agency with nobody on the wire gives one of
three reasons; the scouting department with no class in drops three of five facts and replaces the body;
the power rankings say which of three movement states is true; the leaderboard's Rebuild board says none
has **finished**, not that nobody has played one.

**Cross-cutting.** The nav has eight categories with the listed items, the hover-and-focus sub-row
preview, and exactly three badges. The advance control builds its menu from the live phase, shows a
progress popover with a stop for multi-week runs only, halts at a week boundary, and reports the week it
actually landed on. The ticker returns nothing on an empty list and is never padded. The lineup-gap
banner is dismissible, scoped by signature, and absent in the building phases. Tooltips reset their
typography, are 18rem, open downward inside scrollers, and pin to the viewport foot below 520px.

**Design system.** Every token in §7 matches to the hex. Team-coloured text is a 45/55 mix into `chalk`
and resolves per-section at use time. The rail is a 62/38 mix. Every panel decoration is a
pseudo-element. The table has all four board devices and both specificity fixes. Radius is 2px, the only
plate shadow is a 1px inset highlight, the container is 90rem, body is 13px/1.4, and every stat step
above `sm` is a clamp.

**The non-negotiables.** The four motion tokens exist and collapse to 1ms/linear under
`prefers-reduced-motion`, and no timed effect anywhere reads a duration written outside them. **There is
not one count-up anywhere.** An automatic contrast sweep computes through every alpha and ancestor
opacity at 1440 and 390, reports zero text below 4.5:1, **and has been validated by deliberately
breaking a token.** Zero horizontal page scroll at 390px, with 40px minimum touch targets. No "click
here" and no exclamation marks in product copy. No figure appears twice on one screen, and every fact
stated on two surfaces is computed once.

## 11. WHAT IS NOT PINNED DOWN HERE — DECIDE IT YOURSELF

- **Avatars in dense tables.** §6.10 has the argument both ways. The reference ships them at 13 call
  sites; an internal review called them the product's one real art-direction error at 20px. Decide, cut
  centrally if you cut, and change nothing else about the row.
- **Exact glossary wording.** §6.7 gives the shape, the standard, the key style and the term count
  (about 138). The 138 individual strings are not reproduced here. Write them to the standard, and
  re-measure every quoted band against **your** engine, not against the figures quoted here — the
  reference's own bands went stale once when its drive simulation was recalibrated.
- **Exact design-route specimen content.** §5 gives every route, its stage label, its specimen list and
  its purpose. The mock data inside them is yours.
- **The analytics panels' internal layouts.** §4.5 pins the ten titles, their spans and their views;
  what each panel draws inside its boundary is specified with the analytics engine, not here.
- **Chart internals.** The bar, line and scatter components are named and their call sites are listed
  with their axis labels, formats and quadrant lines; their rendering is yours, subject to §7.1's fixed
  categorical order.
- **The remaining 2–34px of horizontal scroll on five pages at 390px.** §8.4 records it honestly rather
  than claiming zero. Close it; the target is zero.
