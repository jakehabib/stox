# Feel, feedback and the moment-to-moment — research findings

**Lens:** how the interface responds to the player, second by second. Not season
pacing, not player/team identity — those are two other researchers' briefs.

**The question:** every action in this game resolves as a server round-trip and a
re-rendered table. What would make the act of playing — clicking, choosing,
committing — feel good?

**The constraint that shaped everything below:** the last design pass failed
because it treated "better" as "denser". This one is additive only. Nothing here
removes a pixel of what is on screen today. And the second half of that
constraint is just as binding: *most* of what the juice literature recommends is
wrong for this app, and saying so precisely is the useful part of the research.

---

## Part 1 — What the game-feel canon actually says

### 1.1 Swink's three building blocks, and which ones this app even has

Steve Swink's *Game Feel* (Morgan Kaufmann, 2008) decomposes feel into three
components: **real-time control** of an object, a **simulated space** giving
motion physical context, and **polish** — the art, sound and animation that sell
the first two without changing the underlying simulation. Real-time control is
defined precisely: the correction cycle (player reads feedback -> decides -> acts
-> system reads the action -> delivers new feedback) must close in **under ~100 ms**.

Applied honestly to Dynasty GM:

| Swink block | Does this app have it? |
|---|---|
| Real-time control | **In exactly one place.** `components/NegotiationPanel.tsx` — `evaluateOffer` is pure and the context is resolved server-side up front, so dragging the salary slider re-reads the interest meter with zero round trips. That is a genuine sub-100 ms correction cycle. Nowhere else in the app has one. |
| Simulated space | **No, and it should not get one.** There is no avatar, no camera, no physics. Every technique in the canon that depends on spatial motion — squash-and-stretch, screen shake, camera kick, particle bursts, trails — is either meaningless or actively harmful here. |
| Polish | **Almost none.** `.btn` in `app/globals.css` carries `transition-colors duration-150` and nothing else. One `fadeUp` keyframe in `tailwind.config.ts`. One infinite marquee (`.ticker-track`). That is the entire motion vocabulary of the application. |

**The conclusion that follows:** two of Swink's three blocks are unavailable, so
this app cannot be juiced the way an action game is juiced. What it *can* do is
(a) protect and extend the one real-time control surface it already has, and
(b) build a polish layer that operates on **state change** rather than on
**motion through space** — colour, opacity, scale, and small purposeful
displacement.

Sources: [Game Feel — Swink (Goodreads)](https://www.goodreads.com/book/show/3385050-game-feel),
[The Three Building Blocks and us — Vojlock](https://vojlock.wordpress.com/2015/11/16/the-three-building-blocks-and-us/),
[Game Feel notes — aefreedman/GameDevFall2017](https://github.com/aefreedman/GameDevFall2017/blob/master/GameFeel.md).

### 1.2 "Juice it or lose it" — and the part everyone skips

Martin Jonasson & Petri Purho, GDC Europe 2012. The famous demo: a deliberately
dull Breakout clone, layered live on stage with squash, tweening, particles,
trails, screen shake and sound until it feels alive. The important structural
claim is not any single effect — it is that the effects are **layered and
compositional**: no single channel carries the experience, they stack.

The equally important counter-literature exists and is worth naming, because it
is precisely the failure mode this codebase already suffered once in a different
form: Game Developer ran
[*Indies, resist the urge to 'juice it or lose it'*](https://www.gamedeveloper.com/design/video-indies-resist-the-urge-to-juice-it-or-lose-it-),
arguing that juice applied to a design that does not need it produces noise that
obscures the game underneath. A roster table with 28 rows is exactly the surface
where that failure lands hardest.

**What I take from it:** the *layering* principle is transferable — a single
event should be marked in more than one channel (e.g. value change + delta chip +
brief tint, not just one of the three). The *specific effects* are almost all
untransferable. Screen shake on a cap sheet would be absurd.

Sources: [GDC Vault — Juice It or Lose It](https://www.gdcvault.com/play/1016487/Juice-It-or-Lose),
[talk video](https://www.youtube.com/watch?v=Fy0aCDmgnxg),
[Roblog write-up](https://roblog.co.uk/2024/03/juicy-games/).

### 1.3 Saffer's microinteraction model — the structure to hang all of this on

Dan Saffer, *Microinteractions* (O'Reilly, 2013), gives the cleanest vocabulary
for what a single action in this app is: **trigger -> rules -> feedback -> loops
and modes**. Feedback is defined as the part that "confirms or explains the
rules to the user".

Auditing the app against this model is where the concrete gap shows up. Take
`components/DraftPickButton.tsx`:

- **Trigger** — present and fine (a button).
- **Rules** — present and *good*: the pick can be refused by the cap, and the
  refusal is surfaced inline instead of blanking the board.
- **Feedback** — the label changes to `Drafting…`, then the page re-renders and
  the row is gone. There is no feedback for the *success* case at all. Success
  is communicated by absence.
- **Loops/modes** — none.

That pattern repeats across `CutButton`, `ScoutButton`, `ShortlistStar`,
`FillRosterButton`, `LetAiResignButton`. **The app is systematically missing the
feedback leg of the model on the success path.** That single observation
generates half the proposals in the companion document.

Sources: [Microinteractions (O'Reilly)](https://www.oreilly.com/library/view/microinteractions/9781449342760/),
[The 4 Components of a Microinteraction — ZURB](https://blog.prototypr.io/the-4-components-of-a-microinteraction-836732173c7c),
[Structure of microinteractions — Cieden](https://cieden.com/book/sub-atomic/microinteractions/structure-of-microinteractions).

---

## Part 2 — Timing: the numbers that bound every proposal

### 2.1 Nielsen's three limits

Jakob Nielsen's response-time limits (NN/g, restating Miller 1968 and Card et al.
1991): **0.1 s** is the limit for the user to feel they are directly manipulating
the object; **1 s** is the limit for uninterrupted thought, above which the user
notices the delay but still connects it to their action; **10 s** is the limit of
attention, above which a percent-done indicator is mandatory.

NN/g's interface-animation guidance narrows this further: keep interface
animations in the **200–500 ms** band — 200–350 ms for small elements, 400–500 ms
for larger motion — and, critically, **the effect must begin within 0.1 s of the
user action** for the animation to read as caused by that action.

That last clause is the one with teeth here. In a server-action app the *result*
often does not arrive for 200–600 ms. So a reveal animation triggered by the
server response has already blown the causality budget — unless something else
started within 100 ms to bridge it. **This is why every proposal that animates a
result also specifies an immediate press/pending acknowledgement.** The pending
state is not a nicety; it is what makes the later animation read as consequence
rather than as a random event.

Sources: [Response Time Limits — NN/g](https://www.nngroup.com/articles/response-times-3-important-limits/),
[Animation for Attention and Comprehension — NN/g](https://www.nngroup.com/articles/animation-usability/),
[Designing Interface Animation — UXmatters](https://www.uxmatters.com/mt/archives/2016/12/designing-interface-animation.php).

### 2.2 The rule that overrides all of the above

From the Slay the Spire design analyses: *"Players can cast cards as quickly as
they'd like, and the animations will do their own pace without waiting for an
animation to finish."*

This is the single most important sentence in the whole research pass. Slay the
Spire is one of the most-praised UIs in the genre and it achieves that by
**decoupling animation duration from input acceptance entirely**. The animation
is a display of what happened; it is never a gate on what happens next.

Every proposal in the companion document is written to that rule. If the tenth
roster edit is slower than the first, the design is wrong — not "a tradeoff",
wrong.

Sources: [Flash Thoughts: Slay the Spire's UI — Cloudfall Studios](https://www.cloudfallstudios.com/blog/2018/2/20/flash-thoughts-slay-the-spires-ui),
[Slay the Spire UX redesign study](https://medium.com/@n01578837/final-deliverable-632cfc09e673).

### 2.3 The labor illusion — when a wait is legitimate

Buell & Norton, *The Labor Illusion: How Operational Transparency Increases
Perceived Value* (Management Science 57:9, 2011). Across five experiments, users
shown a narration of the work being done ("searching United… searching Delta…")
valued the service **more** than users given an identical instant result. The
mechanism is perceived effort inducing reciprocity.

The ethical line the paper itself draws, and which I hold to: this works because
the labour is **real and is being narrated**. Padding a fast operation with a
fake progress bar to manufacture the same effect is deception, and it directly
contradicts this project's own standing principle 6 ("No lying metrics").

**Where it applies here, legitimately:** `AdvanceWeekButton` already drives the
sim one week at a time from the client specifically so real progress is visible
("Simulating week 3…") rather than one opaque spinner. That is textbook
operational transparency and it was already the right call. It should be
*extended* with what actually happened, not replaced.

**Where it does not apply:** scouting, drafting, signing, cutting. Those resolve
in one round trip. Narrating them would require inventing a delay. Don't.

Sources: [HBS working paper PDF](https://www.hbs.edu/ris/Publication%20Files/Norton_Michael_The%20labor%20illusion%20How%20operational_f4269b70-3732-4fc4-8113-72d0c47533e0.pdf),
[Management Science listing](https://pubsonline.informs.org/doi/10.1287/mnsc.1110.1376).

---

## Part 3 — Anticipation and reveal

### 3.1 Balatro: sequential reveal as the entire product

Balatro's scoring phase is the most-cited recent example of a numerically simple
game feeling enormous. The analyses converge on three mechanisms:

1. **The player is not told the answer up front.** The game does not display the
   final score of the hand being played — the player watches it accumulate. The
   waiting *is* the payoff.
2. **Layered, multiplicative feedback.** Card flip, number pop, size scaling,
   chip sound, screen shake, fire effect — no single channel carries it.
3. **Typography is mechanics.** Large numbers are treated as gameplay objects;
   size and motion are tied to magnitude, so the player reads *significance*
   before they read the digits.

**What transfers to Dynasty GM:** exactly one thing, and it transfers strongly —
mechanism 1, applied to **the scouting range**. `components/ds/ScoutingRange.tsx`
draws an uncertainty band (`82–98`) that narrows as you spend focus. That band
narrowing is the single best-designed anticipation object already in this
codebase, and it currently resolves as a re-render: the bar simply *is* narrower.
Animating the narrowing costs nothing informationally (the numbers are legible
the whole time) and turns a table update into a reveal.

**What does not transfer:** mechanism 3, mostly. The app already has a
`.stat-value` scale and a rating ramp; scaling a number by magnitude on a roster
table would fight principle 3 (rating colour is the meaning channel) and make
columns jitter.

Sources: [Balatro Design Analysis: Visual Packaging and Interactive Feedback](https://medium.com/@yyh19971004/balatro-design-analysis-visual-packaging-and-interactive-feedback-cc6fa6a65370),
[Balatro Art Direction Breakdown](https://halabaojia.com/collection/20260212-balatro-visual-design-analysis/),
[Game UI Database — Balatro](https://www.gameuidatabase.com/gameData.php?id=1935).

### 3.2 Loot-box psychology — the technique, and the line I will not cross

The research base here is unambiguous. Loot boxes run on **variable-ratio
reinforcement**, the same schedule as a slot machine, and produce persistent
behaviour precisely because the payoff is unpredictable. The reveal animation is
not decoration: *"The chest animation creates a deliberate anticipation window —
a pause before the reveal that extends the dopamine buildup."* **Near-miss**
framing (a rare animation beginning before a common item lands) is read by the
reward system as a partial win. The 2019 *Nature Human Behaviour* work links
loot-box spending to problem-gambling measures. A systematic review catalogues
136 distinct loot-box design features across six dimensions including
*Obfuscation* and *Psychological Manipulation*.

**Where I would not go, stated explicitly:**

- **No artificial suspense pause.** A scout result that is already in the client
  must not be withheld for dramatic effect. Animate the *transition* to the
  answer, never delay the *arrival* of it.
- **No near-miss theatre.** No "the range almost collapsed to a single number!"
  framing. No rarity flare that starts and then downgrades.
- **No randomised reveal ordering** designed to make a mediocre result feel like
  it might have been a good one.
- **No escalating-tier reveal ceremony** (common/rare/epic) on scouting results.
  The scouting economy has real costs and a real repeat-pass penalty
  (`scoutCost` rises ~60% per pass and reveals ~18% less) — dressing that as a
  gacha pull would be reframing a resource decision as a gamble.

**Why the app is structurally safe here, and this is worth writing down:**
`lib/dynasty.ts` states the principle in its own header — XP is *derived, never
stored*, recomputed from `TeamSeasonRecord` and `Transaction` rows, so *"there is
no '+5 XP for clicking Scout' to grind, because XP is not an event stream."*
There is no currency, no purchase, no random drop table gated behind repetition.
**That is the licence to celebrate progress hard when it happens** — there is no
compulsion loop for the celebration to reinforce. Any future proposal that
introduces a per-action XP award would remove that licence, and every reward
animation in this document would become suspect the moment it did.

Sources: [Rare Loot Box Rewards Trigger Larger Arousal and Reward Responses — PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC7882574/),
[The Science of Loot Boxes](https://www.geniuscrate.com/the-science-of-loot-boxes-psychology-behind-random-rewards),
[Psychology of Loot Boxes — Intenta Digital](https://intenta.digital/game-design/psychology-of-loot-boxes/),
[An Overview of Gambling-Related Psychological Features of Loot Boxes](https://www.researchgate.net/publication/396700323_An_Overview_of_Gambling-Related_Psychological_Features_of_Loot_Boxes).

### 3.3 Slay the Spire: telegraph before, not surprise after

The enemy-intent system telegraphs what will happen *before* the player commits,
so *"players never feel cheated when they die"* — the game gives near-perfect
information and derives tension from the decision, not from concealment.

This is already the design philosophy of the best component in this codebase.
`components/CutButton.tsx` fetches `cutImpactAction` on entering the confirm step
and shows dead money, net cap freed, cap space after, and — when the restructure
trap applies — a plain-English warning that releasing costs *more* than keeping.
That is a perfect intent telegraph.

**The finding is that this pattern exists once and is not a system.** The Full
Scout charge — described in its own copy as "cannot be undone and you only get a
few a year" — is confirmed with `window.confirm()`, a native OS dialog
(`components/FullScoutPanel.tsx`). The most irreversible action in the scouting
system has the *least* designed commitment moment in the app.

---

## Part 4 — Progress and reward

### 4.1 Goal-gradient and endowed progress

Hull (1932), resurrected for human contexts by Kivetz, Urminsky & Zheng (2006):
effort accelerates as the goal approaches, and **visual representations of goal
progress enhance motivation**. Nunes & Drèze (2006) on endowed progress: a
10-stamp card with 2 stamps pre-filled was completed by 34% of customers versus
19% for an 8-stamp empty card — identical real effort, nearly double the
completion.

**Where this lands:** the Dynasty page (`docs/design-directions/before/dynasty.png`)
already draws a level-progress bar — `133 / 703 XP toward level 6 · 570 to go`.
The goal-gradient literature says that bar is doing real motivational work and
should be *more* prominent near completion, not less.

**Where I decline to go:** endowed progress is a persuasion technique that works
by giving credit that was not earned. Applying it here — starting a new GM at
"Level 1, 40% of the way to 2" — would be a lie about the franchise's record,
which is principle 6 again. Cite it, don't ship it.

Sources: [Goal-Gradient Hypothesis guide — Yu-kai Chou](https://yukaichou.com/behavioral-analysis/goal-gradient-hypothesis-hull-kivetz-motivation-acceleration/),
[Endowed Progress Effect — Learning Loop](https://learningloop.io/plays/psychology/endowed-progress-effect),
[Nunes & Drèze, The Endowed Progress Effect (PDF)](https://www.researchgate.net/publication/23547282_The_Endowed_Progress_Effect_How_Artificial_Advancement_Increases_Effort).

### 4.2 Apple Activity Rings and Duolingo streaks — the open-loop mechanism

The Activity Rings analysis: a 90%-complete ring creates an **open loop** — a
perceptual itch resolvable only by closing it — and the design deliberately keeps
the primary feedback low-friction, with the data-heavy tables one level down so
casual users are not overloaded. The ring-close moment gets a distinct
celebration (animation + haptic) reserved for that one event.

Duolingo: cue -> routine -> reward, with the streak counter's animation *being*
the reward, plus loss aversion doing the retention work. The colour language is
binary and emotional — vibrant when alive, grey when broken.

**What transfers:** the *reservation* principle. Both products celebrate exactly
one thing, rarely, and everything else is silent. The Dynasty level-up is this
app's ring-close: it happens a handful of times per save, it is earned by real
results, and today it produces no moment whatsoever.

**What does not transfer:** streak mechanics and loss-aversion framing. This is a
single-player, offline-capable simulator with no retention mandate. Building
"don't break your streak" pressure into a game someone plays for pleasure would
import a growth-team incentive into a product that has none.

Sources: [The Psychology of Apple Watch's "Close Your Rings"](https://trophy.so/blog/the-psychology-of-apple-watchs-close-your-rings),
[Duolingo: Gamification as Design Language](https://blakecrosley.com/guides/design/duolingo),
[The Psychology Behind Duolingo's Streak Feature](https://www.justanotherpm.com/blog/the-psychology-behind-duolingos-streak-feature).

---

## Part 5 — Accessibility: the non-negotiable half

### 5.1 What motion actually does to people

Val Head, *Designing Safer Web Animation For Motion Sensitivity* (A List Apart
#428, 2015): for millions of people with vestibular disorders, large-scale web
animation triggers **nausea, migraine and dizziness**. The prescription is not
abstinence — *"we don't need to eliminate animation; we need to apply it more
thoughtfully."*

Her follow-up (Smashing, 2020) gives the operational split, and it is the most
directly usable finding in this section:

- **Likely to be problematic:** large movement, large zooms, spinning, parallax.
- **Unlikely to be problematic:** colour fades, opacity changes, **small** scale
  changes.

**Consequence for this document:** the reduced-motion fallback for every proposal
is not "nothing happens". It is the same event expressed in the safe channels —
colour and opacity — at the same moment. A delta chip still appears; it just
appears instead of rising. A meter still changes; it changes instantly instead of
sweeping. **The reduced-motion user must never receive less information than the
default user.** That is the actual accessibility bar, and "disable all animation"
routinely fails it by hiding elements whose only reveal path was an animation.

Sources: [A List Apart — Designing Safer Web Animation](https://alistapart.com/article/designing-safer-web-animation-for-motion-sensitivity/),
[Smashing — Designing With Reduced Motion](https://www.smashingmagazine.com/2020/09/design-reduced-motion-sensitivities/),
[Smashing — Respecting Users' Motion Preferences](https://www.smashingmagazine.com/2021/10/respecting-users-motion-preferences/),
[A11Y Project — primer on vestibular disorders](https://www.a11yproject.com/posts/understanding-vestibular-disorders/).

### 5.2 The three-state media query, and the bug to avoid

`prefers-reduced-motion` has a `reduce` value and a `no-preference` value. The
codebase already gets this right once and documents a real bug it caused —
`app/globals.css` pins `overflow-y` explicitly in the ticker's reduced-motion
block because setting only `overflow-x` made the other axis compute to `auto` and
put a scrollbar on a single-line ticker. That comment is a good sign: whoever
wrote it actually tested the reduced-motion path rather than assuming it.

The pattern to standardise on (and what the mockup uses) is a **motion token
layer**, not scattered `@media` blocks:

```css
:root {
  --dur-tick: 140ms; --dur-state: 220ms; --dur-reveal: 450ms;
  --ease-out: cubic-bezier(.2,.7,.3,1);
}
@media (prefers-reduced-motion: reduce) {
  :root { --dur-tick: 1ms; --dur-state: 1ms; --dur-reveal: 1ms; --ease-out: linear; }
}
```

Every animation reads the tokens. Reduced motion is then a single change of four
values, it cannot be forgotten in a new component, and — the important part —
elements still *arrive*, they just arrive instantly.

### 5.3 Modern CSS available without a single dependency

`package.json` has exactly four runtime dependencies: `@prisma/client`, `next`,
`react`, `react-dom`. No animation library, and none is needed.

- **`linear()` easing** — interpolates linearly between listed output values;
  values above 1 overshoot, which is what produces spring and bounce. Baseline
  across modern browsers since 2024. A real spring equation (mass/stiffness/
  damping) can be sampled into points and handed to `linear()`, giving true
  spring motion with no runtime JS.
  *Where I would use it:* the negotiation meter and the patience pips only — a
  control the user is physically dragging. **Nowhere else.** Overshoot on a cap
  number reads as the number being wrong for 80 ms.
  Sources: [Chrome for Developers — linear()](https://developer.chrome.com/docs/css-ui/css-linear-easing-function),
  [Spring Physics in CSS — Carmen Ansio](https://www.carmenansio.com/articles/spring-physics-css/),
  [CSS Spring Easing Generator](https://www.kvin.me/css-springs/how-to-use).

- **`@property` + `counter()`** — registering a custom property as `<integer>`
  makes it interpolable, so a number can be counted up in pure CSS via
  `counter-set` / `content: counter(n)`.
  *Where I would use it:* **nowhere in the current app.** This is the single most
  tempting technique in the modern-CSS toolbox and it is the wrong one here — a
  count-up strictly *delays* time-to-information, and this app's numbers are the
  product. Recorded so the next person does not have to relearn it.
  Source: [Animating Number Counters — CSS-Tricks](https://css-tricks.com/animating-number-counters/).

- **View Transitions API** — same-document support is now Chrome 111+, Edge 111+,
  Firefox 133+, Safari 18+; cross-document is broadly there but Firefox lagged
  behind a flag, so it stays a progressive enhancement. Reduced-motion handling
  is a known gotcha: the default cross-fade is considered safe, but any grow/
  slide/scroll transition must be wrapped in
  `@media (prefers-reduced-motion: no-preference)`.
  *Where I would use it:* **not on route changes.** Taxing every navigation in a
  data app to make tab switches pretty is exactly the trade that makes the tenth
  interaction worse than the first. The one defensible use is a same-document
  `view-transition-name` on a *single* element — a draft-board row morphing into
  the pick card — and even that is a stretch goal, not a proposal.
  Sources: [Misconceptions about view transitions — Chrome](https://developer.chrome.com/blog/view-transitions-misconceptions),
  [Cross-Document View Transitions: The Gotchas — CSS-Tricks](https://css-tricks.com/cross-document-view-transitions-part-1/),
  [View Transitions: The Smooth Parts — Matthias Ott](https://matthiasott.com/notes/view-transitions-the-smooth-parts).

---

## Part 6 — Technical reality of this specific codebase

Findings that constrain what is even proposable. Stated here so the proposals
document can be honest about cost.

1. **React 18.3.1, Next 14.2.35 — `useOptimistic` does not exist here.** It is a
   React 19 API; so is `useFormStatus` in its stable form. Optimistic UI in this
   app means hand-rolled local state plus reconciliation on `router.refresh()`,
   or a React upgrade. Every existing mutation uses `useTransition` +
   `router.refresh()` (`AdvanceWeekButton`, `CutButton`, `DraftPickButton`,
   `ScoutButton`, `FullScoutPanel`). That pattern works and should be built on,
   not replaced.

2. **Server actions already return rich result payloads.** This is the single
   most enabling finding. `scoutPlayerAction` returns
   `{ spent, remaining, confidence, confidenceGained, revealed[], devTrait }`.
   `cutImpactAction` returns
   `{ currentHit, deadMoney, savings, capSpaceAfter, costsMoreThanKeeping, leavesOverCap }`.
   `advanceWeekAction` returns `{ summary, phase, week, blocked, capBlock, block }`.
   **A client component therefore already holds both the before-state (its props)
   and the after-state (the action result).** Every delta and every reveal in the
   proposals document is computable client-side today with no schema change, no
   new endpoint and no extra round trip.

3. **`revalidatePath(..., 'layout')` is the norm**, so most mutations invalidate
   the whole league layout. Blunt, but it means the "after" values do land; the
   animation just has to survive the re-render, which means holding the previous
   value in a `useRef` inside a client component that is not itself remounted.

4. **The negotiation panel is the app's only zero-latency surface** and it got
   there deliberately — the file's own header explains that a server round trip
   per slider pixel would destroy the feel. Any proposal that adds a server call
   to that panel is a regression.

5. **`AdvanceWeekButton` already client-drives the sim loop** one step at a time
   specifically to make real progress visible. The scaffolding for narrated
   advancement exists; only the presentation is thin.

6. **The one native-dialog escape hatch:** `FullScoutPanel` uses
   `window.confirm()`. It is the only place the app leaves its own visual
   language for a decision, and it does it for its most irreversible action.

7. **`LiveDraftTicker` already paces AI picks on a 3-second pausable clock**
   rather than batching them. Draft day is therefore the one screen that already
   has a *tempo*. It needs a payoff at the end of the tempo, not more tempo.

---

## Part 7 — The summary judgement

The app does not lack motion because motion was removed. It lacks motion because
**it has never had a feedback layer at all** — the mutation model (server action
-> `revalidatePath` -> re-render) produces correct screens and zero
acknowledgement that anything happened. Saffer's fourth leg is missing across the
board.

That is good news for this brief: nothing has to be redesigned, restyled or
densified. The screens are right. What is missing is the **50–450 ms after the
click** — and that window is currently empty on almost every action in the game.

Three things follow, and they order the proposals document:

1. **Acknowledge every action** (cheap, systemic, zero information cost).
2. **Show what changed, not just what is** (deltas — additive information, which
   is the only kind of juice that survives principle 5).
3. **Reserve real ceremony for the two or three moments that have earned it** —
   the scouting reveal, your own draft pick, the Dynasty level-up — and keep
   every table, board and list on the app dead still.
