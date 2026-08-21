# Feel & feedback — proposals

Companion to `findings.md`. Nine proposals, ranked. Every one is **additive**:
nothing on any current screen is removed, shrunk, greyed or flattened. No
proposal touches avatars, logos, badges, the rating ramp or row height.

## How to read the ranking

Ranked by **(felt improvement) ÷ (work × risk)**, with a hard veto on anything
that makes an experienced player slower. Each entry carries:

- **Cost to an informed player** — the honest number. Measured as: how much
  longer until the value they came for is readable, and how much longer until
  the next input is accepted. **Both must be zero or the proposal is out.**
- **Work** — S (an afternoon), M (a day or two), L (more).

## The three rules every proposal obeys

1. **Animation never gates input.** The next click is accepted the instant the
   server responds, animation running or not. (Slay the Spire — see findings §2.2.)
2. **Animation never delays information.** Final values are in the DOM at frame
   one. Only *decoration* moves. No count-ups, ever.
3. **Reduced motion loses the motion, never the information.** Every effect has a
   colour/opacity expression that fires at the same moment. (Val Head — §5.1.)

## Shared foundation (build once, ~half a day)

Every proposal below reads the same four tokens. This goes in `app/globals.css`
next to the existing ticker block.

```css
:root {
  --dur-tick:   140ms;  /* press, hover, pip */
  --dur-state:  220ms;  /* a value or bar changing */
  --dur-reveal: 450ms;  /* the two or three earned moments */
  --ease-out:   cubic-bezier(.2,.7,.3,1);
  --ease-spring: linear(0,.42 12%,.86 25%,1.05 36%,1.08 44%,1.02 60%,1); /* meters only */
}
@media (prefers-reduced-motion: reduce) {
  :root { --dur-tick:1ms; --dur-state:1ms; --dur-reveal:1ms;
          --ease-out:linear; --ease-spring:linear; }
}
```

Durations sit inside NN/g's 200–500 ms interface band; `--dur-tick` is under the
100 ms direct-manipulation threshold (findings §2.1).

---

# 1. Delta ribbons — every number that changed says so

**Rank 1. Work: M. Cost to informed player: 0 ms — it *adds* information.**

## What it is

When a value on screen changes as a direct result of an action the user just
took, a small chip appears beside it stating the change — `−$8.2M`, `+2`, `−45`,
`+3 revealed` — and the value itself briefly tints toward the delta's polarity
(green for gain, red for loss) before settling back to its normal colour. The
chip holds ~2.5 s and fades.

This is the core answer to the brief's question about state transitions. A value
going 71 → 74 currently just *is* 74. The problem is not that 74 arrived without
ceremony; it is that **the "+3" was never shown at all**. Fixing that is not
decoration, it is missing data.

Layering per "Juice it or lose it" (findings §1.2): three channels on one event —
the new value, the delta chip, the tint — none of which is load-bearing alone.

## Where it lives

- **Masthead cap-space tile** (visible on every league page). Fires after any cut,
  signing, restructure, tag or trade.
- **Scouting focus counter** (`ScoutButton`, Scouting Dept header) after a pass.
- **Team overall / unit ratings** on the roster page after a roster move.
- **Player OVR on the player page** after a development checkpoint.

## What it requires

A ~40-line client component:

```tsx
<DeltaValue value={capSpace} format={formatMoney} />
```

It keeps the last rendered value in a `useRef`, diffs on re-render, and renders
the chip when the diff is non-zero *and* the change happened within ~1.2 s of a
transition finishing (so a plain page navigation to a different team never fires
it). No new server work — `revalidatePath` already delivers the new value, and
the component is not remounted by `router.refresh()`, so the ref survives.

**Honest constraint:** with `useOptimistic` unavailable on React 18.3 (findings
§6.1), the chip appears when the *server* result lands, not on click. That is
correct behaviour anyway — an optimistic cap number that the server then rejects
would violate principle 6. The 100 ms causality gap is covered by proposal 3's
press state.

## Reduced motion

Chip appears in place instead of rising 4 px. Tint still fires. Nothing is lost.

## Where it must NOT go

Not on table cells. Not on 28 roster rows at once. It marks **the one or two
figures that summarise the consequence of what you just did** — not everything
that differs from the last render.

---

# 2. Commitment cards — weight for the four irreversible moments

**Rank 2. Work: M. Cost to informed player: 0 extra clicks (one *fewer* for Full Scout).**

## What it is

Signing, cutting, drafting and spending a Full Scout are the emotional beats of a
GM game and they are currently form submissions. Weight does not come from
delay — it comes from **the decision being staged as an object**: the player's
face at size, the consequence stated in the app's own voice, and a confirm button
whose *label carries the cost*.

`components/CutButton.tsx` already does 80% of this and does it well — it fetches
`cutImpactAction` and shows dead money, net cap freed, cap space after, plus the
restructure-trap warning in plain English. This proposal is: **make that a
system**, and apply it to the three places it is missing.

Slay the Spire's intent telegraph (findings §3.3): tension belongs in the
decision, not in the concealment.

## Where it lives

| Action | Today | After |
|---|---|---|
| Full Scout | `window.confirm()` — a native OS dialog | Commitment card: avatar, name, position, current range, "charges left: 2 → 1", confirm reads **"Spend a charge on Devereaux"** |
| Draft pick | `Draft` button, `Drafting…`, row vanishes | Card: prospect, your board rank vs consensus, rookie cap hit, confirm reads **"Draft Devereaux — R1 P14"** |
| Sign / re-sign | inline result sentence | Card: contract summary, cap space before → after, confirm reads the total |
| Release | already good | Reuse as-is; adopt the shared shell |

The two visible cues that create weight, both static:

1. **The button label states the consequence**, not the verb. "Confirm" is a
   form. "Release Rutkowski — $8.2M dead" is a decision.
2. **A destructive/irreversible card gets a 2 px accent edge** in `bad` or `gold`
   and the player's avatar at 48–56 px. Identity at size is what makes it feel
   like a person rather than a row (principle 2, applied to a moment).

**Explicitly rejected: hold-to-confirm.** It is friction that punishes the
hundredth cut as much as the first, it is awkward for keyboard and switch users,
and the confirm step already exists. Weight comes from composition, not seconds.

## What it requires

One shared `<CommitmentCard>` shell (title, avatar slot, ledger rows, warning
slot, confirm/cancel). `CutButton` refactors into it; `DraftPickButton` and
`FullScoutPanel` adopt it. `FullScoutPanel` needs one small server addition —
the panel already returns the player list, so it needs the current scouting
range for the selected player to display "before". `getScoutPanelAction`
already returns that shape; it is a wiring job, not new logic.

## Cost to informed player

Full Scout: **faster** — no native modal, no context switch out of the app.
Draft: one extra click on a decision the user makes ~7 times per league year and
cannot undo. That is the correct trade, and it can be skipped with a
"don't confirm my draft picks" setting if the owner wants it.

---

# 3. Press state + the three-state action button

**Rank 3. Work: S. Cost to informed player: 0 ms. Highest value-per-hour in the document.**

## What it is

Two things, both tiny, both everywhere.

**(a) Physicality on press.** `.btn` today is `transition-colors duration-150`
and nothing else. Nothing in this application depresses when clicked. Add:

```css
.btn { transition: background-color var(--dur-tick), color var(--dur-tick),
                   transform var(--dur-tick), box-shadow var(--dur-tick); }
.btn:active:not(:disabled) { transform: translateY(1px); }
```

Sub-perceptual, 140 ms, respects reduced motion via the token, and it is the
difference between clicking a link and pressing a control. This is the closest
thing to genuine Swink "polish" available to a UI with no simulated space
(findings §1.1).

**(b) The success beat.** Every mutation currently has trigger, rules and no
success feedback (findings §1.3). Standardise a three-state primary action:

`idle → working (existing spinner + verb) → done (✓ + one-clause result, ~900 ms) → idle`

The done state is what turns "the row disappeared" into "you did that". It runs
*after* the server responds and *while* the page has already refreshed, so it
costs nothing — the button is clickable again immediately (rule 1).

## Where it lives

`app/globals.css` for (a) — one rule, applies app-wide instantly.
A shared `<ActionButton>` for (b), adopted by `DraftPickButton`, `CutButton`,
`ShortlistStar`, `FillRosterButton`, `LetAiResignButton`, `AutoSortButton`,
`RestructureForm`, `ExtendContractForm`.

## What it requires

Nothing new. The spinner markup already exists in `AdvanceWeekButton`; lift it.

---

# 4. The scouting reveal — the app's one true anticipation moment

**Rank 4. Work: M. Cost to informed player: 0 ms (final numbers render at frame one).**

## What it is

`components/ds/ScoutingRange.tsx` draws an uncertainty band (`82–98`) that
narrows as you spend focus. That band is the single best-designed anticipation
object already in this codebase and it currently resolves as a re-render — the
bar simply *is* narrower.

On a successful pass:

1. The band's two edges **sweep inward** to the new low/high over `--dur-reveal`
   (450 ms). The numeric label shows the *new* range from frame one; only the bar
   moves.
2. Newly-locked attributes (`revealed[]` from the action result) **fade in on a
   60 ms stagger**, capped at 6 items so a big pass never becomes a queue.
3. Confidence gain arrives as a delta ribbon (proposal 1): `LOW → MEDIUM +18%`.
4. If `devTrait` came back, the trait chip lands last, at ~250 ms, with a colour
   flare and no motion.

Balatro's sequential reveal (findings §3.1) is the model — the pleasure is in the
watching. The critical difference: **Balatro withholds the answer; we do not.**
The number is legible the whole time. We animate the *transition to* the answer,
never the *arrival of* it.

## Ethics — stated, not assumed

Everything I would refuse to do here is in findings §3.2, and it matters because
this is the one screen where the loot-box grammar would fit uncomfortably well.
No suspense pause. No near-miss framing. No rarity ceremony. No shuffled reveal
order. The scouting economy is a *resource decision with a known price list*
(the Scouting Dept page literally prints the price list) — dressing it as a pull
would reframe a budget choice as a gamble.

## What it requires

The enabling fact is already true: `scoutPlayerAction` returns
`{ confidence, confidenceGained, revealed[], devTrait, remaining }` (findings
§6.2). The client component holds the previous range in its props and the new one
in the result. **Nothing server-side changes.**

`ScoutingRange` becomes a client component with an optional `from` prop; when
present it renders at `from`, then transitions to `low/high` on the next frame.

## Reduced motion

Band jumps to the new span; revealed attributes appear all at once with a colour
flash instead of a stagger. The confidence delta still shows. Same information,
zero movement.

---

# 5. Live negotiation feel — protect and extend the one real-time surface

**Rank 5. Work: S–M. Cost to informed player: 0 ms.**

## What it is

`NegotiationPanel` is the only place in this game that meets Swink's real-time
control criterion — `evaluateOffer` is pure and client-side, so the meter reads
back in well under 100 ms (findings §1.1, §6.4). It is the most game-like
interaction in the product and it is under-dressed.

Three additions, all client-only:

1. **Threshold crossings become events.** `InterestMeter` already draws marks at
   45 / 68 / 82. When the fill crosses one, that mark **flares for 200 ms** and
   the verdict label crossfades rather than swapping. Crossing from CONSIDERING
   into CLOSE should feel like something happened, because mechanically it did.
2. **The fill gets a spring.** This is the *one* place `--ease-spring` (a
   `linear()` overshoot — findings §5.3) is appropriate: it is a meter the user
   is physically dragging, and slight overshoot reads as physical resistance.
   Overshoot is banned everywhere else in the app.
3. **Patience pips drain, they don't just grey.** A rejected offer costs a pip
   (two if insulting). Today the dot flips `bg-accent → bg-line`. It should
   deplete — fill draining out over `--dur-state` — so the cost of submitting is
   *felt*. This is the mechanic that stops binary-searching the hidden number
   (the file's own header says so); making its cost visceral is direct support
   for an existing design intent.

## What it requires

CSS plus a `usePrevious`-style ref for the verdict. **No server changes, no new
state shape, and specifically no new server calls** — adding one here would
undo the panel's entire reason for existing.

---

# 6. Dynasty level-up — the one celebration this app has earned and does not have

**Rank 6. Work: M. Cost to informed player: 0 ms; fires a handful of times per save.**

## What it is

`lib/dynasty.ts` computes XP, level, skill points and a three-branch tree. Today
levelling up produces a longer bar the next time you happen to open the Dynasty
page. The Apple Activity Rings analysis (findings §4.2) is the model: **celebrate
exactly one thing, rarely, and stay silent otherwise.**

On first page load after `level` increases:

- A banner on the dashboard: the progress bar **fills from the old level's
  position through 100% and resets into the new level's segment** over ~600 ms,
  the level numeral crossfades `5 → 6`, and — if a skill point was granted —
  **"1 SKILL POINT"** lands last with a gold flare and a direct link to spend it.
- Fires **once per level**, tracked by last-seen level in `localStorage`. Never
  on a revisit. Never on every dashboard load.

Plus, on the skill tree itself: clicking **Unlock** currently just re-renders.
The purchased card should visibly lock in — border goes solid, the rank pip
fills, the point counter takes a delta ribbon. Spending a skill point is a
permanent choice and should read as one.

## Why this is ethically clean, and worth saying out loud

`lib/dynasty.ts` states it in its own header: XP is derived from
`TeamSeasonRecord` and `Transaction` rows, never stored, so *"there is no '+5 XP
for clicking Scout' to grind."* There is no currency, no purchase, no random
drop. **Because there is no compulsion loop, there is nothing for a celebration
to reinforce** — which is precisely the licence to make this moment loud
(findings §3.2, §4.1). If a per-action XP award is ever added, revisit this
proposal first.

The goal-gradient literature also says the existing progress bar is doing real
work and should be *more* prominent as it nears full. I am **not** proposing
endowed progress (a pre-filled head start) — that would be a lie about the
franchise's record, which is principle 6.

## What it requires

`localStorage` for last-seen level (per-browser, matching the app's existing
save-ownership boundary). A dashboard client component reading the already-derived
level. No schema change.

---

# 7. Narrated advancement — extend what already works

**Rank 7. Work: S–M. Cost to informed player: 0 ms; the wait already exists.**

## What it is

`AdvanceWeekButton` already drives the sim one week at a time from the client
*specifically* so real progress is visible ("Simulating week 3…") instead of one
opaque spinner. That is textbook operational transparency (Buell & Norton,
findings §2.3) and it was already the right call.

What it lacks is the *content* of the progress. Replace the single rotating
label with a short live scroll inside the same panel: each step appends one line
as it resolves — **your result first**, then a league line or two. Advancing
three weeks becomes three lines you watched land, not a spinner that changed
number.

**Critically: this narrates work that is genuinely happening.** No padding, no
fake stages. If a step resolves in 80 ms its line appears in 80 ms. The moment
this becomes a manufactured delay it becomes a lying metric.

## What it requires

`advanceWeekAction` already returns `summary`, `phase`, `week` per step, and the
loop already collects them. This is presentation over data that is already in
hand. Richer lines (your score, the upset of the week) would need the action's
return shape widened — worth it, but scope it separately.

---

# 8. Row-level acknowledgement on list mutations

**Rank 8. Work: S. Cost to informed player: 0 ms. Deliberately the smallest effect in the document.**

## What it is

When a row leaves a list because you acted on it (a signed free agent, a drafted
prospect, a released player, a shortlisted star), the row currently just is not
there on the next render. Give it **one beat of departure**: 180 ms fade with a
brief tinted background — accent for acquired, `bad` for released — then it is
gone.

This is the smallest possible fix for "success is communicated by absence"
(findings §1.3), and it is capped hard:

- **Departure only. Never arrival.** Rows appearing in a list never animate —
  that is a filter/sort result and must be instantaneous.
- **Only the row you acted on.** Never a stagger over a list.
- **Only lists you act on directly**: free agency, re-sign, draft board,
  shortlist. Never the roster table, never standings, never stats.

## What it requires

Local "departing" state in the row's client wrapper before `router.refresh()`.
Free agency and the draft board are the only two lists where the pattern earns
its keep; the rest are read surfaces.

---

# 9. Draft-pick reveal — your pick only, once per round

**Rank 9 (lowest of the ranked set — highest ceiling, highest risk). Work: M–L. Cost: 0 ms to next input.**

## What it is

`LiveDraftTicker` already paces AI picks on a 3-second pausable clock, so draft
day is the one screen with a genuine tempo. What it lacks is a payoff at the end
of that tempo. When **your** pick lands, the `OnTheClock` panel — already the
best-dressed component in the app, with team-colour wash, stadium-light texture
and elevated shadow — yields to a pick card over ~700 ms: avatar scales from
0.96, name and position land, and the rating chip arrives last at ~250 ms.

Strictly bounded:

- **Only your own pick.** AI picks keep streaming in `RecentPicksFeed` with
  nothing added — 31 other teams pick per round and animating them would make
  draft day unusable.
- **Once per round.** Not per prospect viewed, not per shortlist toggle.
- **The next action is live immediately.** Advance / next-pick is clickable the
  instant the server responds, animation running (rule 1). This is the proposal
  most at risk of violating that rule, which is why it is ranked last.

Why ranked last despite being the most exciting: it is the highest-effort item,
it touches the most complex client component in the app (`LiveDraftTicker` +
`OnTheClock` + the board), and everything above it improves **every** screen
whereas this improves one moment on one screen a handful of times a year.

---

# Surfaces that must stay completely still

This is the half of the brief I would defend hardest. **Adding motion to these is
a bug, not a feature.** Any future proposal touching them should be rejected on
sight.

### Dead still — no motion of any kind, ever

- **The roster table** (`table-clean`). No row enter/exit animation, no stagger,
  no hover lift, no sort transition. A GM edits this table dozens of times per
  session. It must be as fast on the fiftieth edit as the first.
- **The depth chart.** It is a drag-reorder surface — the drag is the animation.
  Anything else fights the interaction.
- **Standings, stats tables, the box score, schedule.** Pure read surfaces. The
  eye scans them; anything moving steals the scan.
- **The 300-row draft big board.** Staggered row reveal here would be the single
  worst decision available in this codebase.
- **All sorting, filtering and search.** Instantaneous, always. Never crossfade a
  filtered list. The user is *hunting*; latency is the enemy.
- **Sticky table headers, tooltips, dropdown menus.** They appear. That is all.
- **Numbers inside tables.** Never count up, never pulse, never scale by
  magnitude. Rating colour is the meaning channel (principle 3) and motion would
  compete with it.

### No page-level motion

- **No route transitions.** View Transitions on navigation would tax every single
  tab switch to make it pretty (findings §5.3). Declined.
- **Nothing animates on page load.** The dashboard is a read surface; it must be
  complete and still by the time the user's eyes land. The single exception is
  the Dynasty level-up banner (proposal 6), which fires at most a handful of
  times per save and never twice for the same level.

### One looping animation, total

`.ticker-track` (the League Wire marquee) is the app's entire ambient-motion
budget and it is already spent. **Nothing else may loop indefinitely.** No
pulsing badges, no breathing cards, no shimmer skeletons, no animated gradients.
A second perpetual motion source on the same page turns ambient into noise.

### The veto rule

> If an animation means an experienced player waits longer for a number, or for
> the next click to register, it is deleted. Not tuned — deleted.

---

# Rollout

**Phase 1 (~1 day, ships alone, improves every screen):** motion tokens +
proposal 3 (press state and success beat) + proposal 1 (delta ribbons on the
masthead cap tile and the scouting focus counter). This is the pass that turns
form submissions into actions, and it carries no risk.

**Phase 2 (~2 days, the felt moments):** proposal 4 (scouting reveal), proposal 5
(negotiation feel), proposal 2 (commitment cards — Full Scout first, since it is
the one currently using a native dialog).

**Phase 3 (as appetite allows):** proposal 6 (level-up), 7 (narrated advance),
8 (row departure), 9 (draft reveal).

Phase 1 is where most of the "it feels alive" delta lives, and it is the phase
with essentially zero chance of the previous pass's failure mode, because it
neither removes nor restyles anything — it only fills the empty 50–450 ms after
a click.
