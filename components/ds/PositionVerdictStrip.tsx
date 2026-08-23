import Link from 'next/link';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { TeamLogo } from '@/components/TeamLogo';
import { Tooltip } from '@/components/Tooltip';
import { positionBadgeClass } from './positionColor';
import { RankChip } from './RankChip';
import type { StatRank } from '@/lib/statRanks';

/**
 * ===========================================================================
 * THE POSITION STRIP — SIX POSITIONS, SIX ANSWERS, ONE LOOK
 * ===========================================================================
 * (The exported names still say "Verdict". The graded word they were named
 * after is gone — see below — and the file keeps its name only because a
 * rename would touch imports on a page another change is already sitting in.
 * It is a strip of positions, not of verdicts.)
 * The app owner, on what the stats tabs are actually for:
 *
 *   *"it would be cool to have like a few large boxes at the top with your top
 *   players, some cool stats on them and where they rank vs the league"*, then
 *   *"WE want to see if our QB is doing good or bad vs the league"*, and later
 *   *"we could also add hero cards for the 'league' too showing the leaders"*.
 *
 * ONE COMPONENT, TWO TABS. My Team fills these with the six men your depth
 * chart has on the field; League fills them with the six men leading those
 * positions. Same order, same three stats, same chips — a GM flipping between
 * the tabs is comparing like with like, which is the whole value and is why
 * there is no second component here. The only difference is a prop: a League
 * card carries its man's club name, because on My Team every man is yours.
 *
 * WHY SIX FIXED POSITIONS AND NOT YOUR SIX BEST MEN. The owner's call:
 * *"It should be the most important positions, not your best player. It should
 * be QB, RB, WR, TE, EDGE, CB if there's room"*. A row of your best-ranked men
 * answers "who is good here", which you can already read off the tables below.
 * A fixed row answers "how is my team AT EACH KEY POSITION" — including, and
 * especially, the ones where the answer is bad. It is also the only version
 * that stays comparable: week to week, and against any other club's six.
 *
 * A THIN POSITION STILL GETS ITS CARD. An unmanned slot or a starter with no
 * production is the most useful card on the row, not an embarrassment to hide,
 * so the card says so in the depth chart's own words rather than disappearing.
 *
 * THE FRAME NEVER CHANGES, ONLY THE CONTENTS. Every card carries exactly three
 * stat rows whatever the position, and an empty one carries three empty rows,
 * because six cards side by side have to scan as one row. Nothing here is
 * sized by its content: names truncate, figures are tabular, and the rank chip
 * keeps its slot even when there is no rank to put in it.
 *
 * ---------------------------------------------------------------------------
 * THERE IS NO VERDICT WORD ON THESE CARDS ANY MORE
 * ---------------------------------------------------------------------------
 * Each card used to print a graded word in its corner — ELITE / STRONG /
 * AVERAGE / BELOW / BOTTOM — coloured, glyphed, with a line under the name
 * naming the stat it graded. The owner killed it: *"Its unclear what the
 * actual colors mean. They say average + below: but what does that mean? my WR
 * has 1300 yds! Thats insane - how is that below? LEts remove those titles."*
 *
 * He is right and the mechanism is worth writing down, because the failure was
 * not a wrong number. The verdict graded the position's RATE, never its
 * volume, deliberately: `allocateStats()` hands offensive volume out by game
 * plan, so a receiver on a pass-first club is busy rather than good. His man
 * was 1,328 yards, T-9th of 148 at the position — and 10.1 yards a catch,
 * T-108th of 127 qualifiers. "Below" was arithmetically true of the rate and
 * a lie about the season, and no amount of naming the basis under the name
 * repaired it. The basis line went with it: it existed only to say what the
 * verdict was a verdict ON, and with no verdict it had no job.
 *
 * THE RANKS STAYED. They are what he is actually reading, and they are per
 * stat, so nothing has to be collapsed into one word to be shown at all: the
 * same card now says 1,328 yards ★/blue/ink at T-9th and 10.1 a catch at
 * T-108th, side by side, and the reader does the collapsing.
 *
 * HOUSE SHAPE, NOT A NEW WIDGET. The notched top-left corner is this app's
 * rating shape (RatingBadge / `.rating-chip`). Its flag used to be the verdict
 * tier's colour — "the corner of the card IS the answer" — and is now the
 * neutral line colour, because a coloured corner IS a grade and the grade is
 * what came off. Team accent, crest watermark and player avatars are the same
 * identity kit the GM card and the page mastheads use.
 * ===========================================================================
 */

export interface VerdictStatLine {
  /** Column header language, not a sentence — "Pass Yds", "yards/carry". */
  label: string;
  /** Already formatted by the page, at the precision its rank was taken at. */
  value: string;
  rank: StatRank | null;
  /** Glossary text for the one number whose own name cannot explain it. */
  tip?: string;
}

export interface PositionVerdictCard {
  position: string;
  /** Which starting slot this is, when a position starts more than one. */
  slotLabel: string;
  player: {
    id: string;
    firstName: string;
    lastName: string;
    age: number;
    ovr: number;
    weightLb?: number | null;
    heightIn?: number | null;
  } | null;
  href: string | null;
  /** Games he has in this split. Zero is a real answer. */
  games: number;
  /** Always three, so every card in the row is the same height. */
  stats: VerdictStatLine[];
  /** Why this card has no numbers — unmanned slot, no snaps, season too young. */
  note: string | null;
  /**
   * The club whose colours and crest this card wears. Per card rather than per
   * strip, because the League row is six different clubs.
   */
  club: { id: string; abbr: string } | null;
  /**
   * Printed beside the crest in the card's top corner when set — the League
   * tab passes the club's abbreviation, because half of a league leader's
   * identity is who he plays for. My Team passes nothing: every man on that
   * row is yours and the masthead already says which club, so six copies of
   * your own badge is the duplication principle 7 is about.
   */
  clubLabel?: string;
  /** The club's primary, so a card wears the same colours as that club's masthead. */
  accent: string;
}

export function PositionVerdictStrip({ cards, footnote }: {
  cards: PositionVerdictCard[];
  footnote: React.ReactNode;
}) {
  return (
    <section className="space-y-2.5">
      {/* Six across only from xl up. Below that they wrap — three, then two —
          rather than squashing to slivers, and QB leads the array so the
          quarterback is never the card that falls off the end of a row. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        {cards.map((c) => <Card key={c.position} card={c} />)}
      </div>
      <p className="text-[11px] text-muted px-1 leading-relaxed">{footnote}</p>
    </section>
  );
}

function Card({ card }: { card: PositionVerdictCard }) {
  const accent = card.accent;
  return (
    <div
      className="rating-chip relative flex flex-col bg-card border border-line/70 shadow-card min-h-[236px]"
      style={{
        ['--team-accent' as never]: accent,
        ['--chip-notch' as never]: '20px',
        background: `linear-gradient(168deg, color-mix(in srgb, ${accent} 13%, #18181b), #141416 55%)`,
      }}
    >
      {/* The cut corner keeps the house shape; the flag in it is the line
          colour and nothing else. See the block comment — it used to be the
          verdict tier and a coloured corner is a grade. */}
      <div className="rating-chip-flag" style={{ borderTopColor: '#2d2d32' }} />
      {card.club && (
        <div aria-hidden className="absolute inset-0 overflow-hidden pointer-events-none">
          <TeamLogo seed={card.club.id} abbr={card.club.abbr} size={120} className="watermark-logo opacity-[0.045] -right-7 -bottom-7" />
        </div>
      )}

      {/* ---- Who this card is about ------------------------------------- */}
      <div className="relative px-3 pt-3 pb-2.5">
        <div className="flex items-center justify-between gap-1.5 min-h-[20px]">
          <span className={`font-display font-bold text-sm uppercase tracking-wide ${positionBadgeClass(card.position)}`}>
            {card.slotLabel}
          </span>
          {/* THE CLUB, ON THE LEAGUE TAB ONLY — see `clubLabel`. The
              abbreviation and not the full name: "San Diego Sentinels" in the
              ~100px this corner has came out as "San …", and the three-letter
              badge is what this app identifies a club by everywhere else. */}
          {card.clubLabel && card.club && (
            <span className="inline-flex items-center gap-1 min-w-0">
              <TeamLogo seed={card.club.id} abbr={card.club.abbr} size={14} className="shrink-0" />
              <span className="font-mono text-[10px] text-muted truncate">{card.clubLabel}</span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 mt-2 min-h-[38px]">
          {card.player ? (
            <>
              <PlayerAvatar
                seed={card.player.id}
                age={card.player.age}
                size={34}
                weightLb={card.player.weightLb ?? undefined}
                heightIn={card.player.heightIn ?? undefined}
                position={card.position}
                className="shrink-0"
              />
              <div className="min-w-0">
                {/* THE NAME IS A DOOR — every man on this page opens his own
                    card, the same rule the depth chart states. */}
                {/* THE SURNAME IS THE NAME. Six cards across a wide screen
                    leaves about 210px each, and "Darius Massenburg" on one
                    line came out as "Darius Masse…" — the half that identifies
                    him truncated away. Stacked, the given name rides small
                    above and the surname gets the whole width. */}
                {card.href ? (
                  <Link href={card.href} className="block min-w-0 hover:text-accent2">
                    <Name first={card.player.firstName} last={card.player.lastName} />
                  </Link>
                ) : (
                  <Name first={card.player.firstName} last={card.player.lastName} />
                )}
                <span className="block font-mono text-[10px] text-muted mt-1 truncate">
                  {card.player.ovr} OVR · {card.games} G
                </span>
              </div>
            </>
          ) : (
            /* ONE SENTENCE, NOT TWO. This block used to print "nobody to
               start here" and the note below printed it again — the card said
               the same thing twice, three lines apart. The note is the single
               source now, and it says whichever empty this is: an unmanned
               slot on My Team, or a position with no stat line at all on the
               League tab. */
            <div className="min-w-0">
              <span className="block font-semibold text-sm leading-tight text-muted">Unmanned</span>
            </div>
          )}
        </div>

        {card.note && (
          <div className="font-mono text-[10px] text-muted/80 mt-1.5 leading-snug">{card.note}</div>
        )}
      </div>

      {/* ---- The evidence ------------------------------------------------ */}
      <div className="relative mt-auto border-t border-line/60 divide-y divide-line/40">
        {card.stats.map((s, i) => (
          <div key={`${s.label}-${i}`} className="px-3 py-1.5 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="stat-value text-[1.15rem] leading-none">{s.value}</div>
              <div className="label-sm text-[9px] mt-1 inline-flex items-center gap-1 truncate">
                {s.label}
                {s.tip && <Tooltip placement="top" text={s.tip} />}
              </div>
            </div>
            <RankChip rank={s.rank} />
          </div>
        ))}
      </div>
    </div>
  );
}

function Name({ first, last }: { first: string; last: string }) {
  return (
    <>
      <span className="block font-mono text-[10px] text-muted leading-none truncate">{first}</span>
      <span className="block font-display font-bold uppercase tracking-wide text-[0.95rem] leading-tight truncate mt-0.5">{last}</span>
    </>
  );
}
