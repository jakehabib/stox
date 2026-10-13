# PART 5 — BUILD EVERY SCREEN, AND THE DESIGN SYSTEM

Build 39 routes and roughly 159 components. This part is the feature inventory: tick every
route and every control off. Where a figure is given, use that figure — every number here
was read out of the reference implementation. Where you are told to decide something
yourself, decide it, and read the reasoning before you do.

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
