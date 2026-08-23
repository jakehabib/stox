import Link from 'next/link';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { TeamLogo } from '@/components/TeamLogo';
import { Tooltip } from '@/components/Tooltip';
import { positionBadgeClass } from './positionColor';
import { RankChip, rankTierGlyph, rankTierHex, rankTierLabel } from './RankChip';
import type { StatRank } from '@/lib/statRanks';

/**
 * ===========================================================================
 * THE VERDICT STRIP — SIX POSITIONS, SIX ANSWERS, ONE LOOK
 * ===========================================================================
 * The app owner, on what the My Team stats tab is actually for:
 *
 *   *"it would be cool to have like a few large boxes at the top with your top
 *   players, some cool stats on them and where they rank vs the league"* and,
 *   decisively, *"WE want to see if our QB is doing good or bad vs the
 *   league"*.
 *
 * That second sentence is the specification. These are not box scores with a
 * rank bolted on; the production is the EVIDENCE and the standing is the
 * point, which is why the rank rides in a coloured, glyphed chip and the
 * verdict word sits in the header where a rating would.
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
 * HOUSE SHAPE, NOT A NEW WIDGET. The notched top-left corner with a coloured
 * flag in the cut is this app's rating shape (RatingBadge / `.rating-chip`),
 * borrowed here so the verdict reads as a grade at a glance the way an OVR
 * does — and the flag is the tier colour, so the corner of the card IS the
 * answer. Team accent, crest watermark and player avatars are the same
 * identity kit the GM card and the page mastheads use.
 * ===========================================================================
 */

export interface VerdictStatLine {
  /** Column header language, not a sentence — "Pass Yds", "Rate". */
  label: string;
  /** Already formatted by the page, at the precision its rank was taken at. */
  value: string;
  rank: StatRank | null;
  /** Glossary text for a rate nobody should have to guess at. */
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
  /**
   * The card's own good-or-bad, and WHAT IT IS A VERDICT ON. Named in the
   * card, because "strong" with no basis is the kind of number this codebase
   * has been burned by. Null when there is nothing honest to grade.
   */
  verdict: { rank: StatRank; basis: string } | null;
  /** Why this card has no numbers — unmanned slot, no snaps, season too young. */
  note: string | null;
}

export function PositionVerdictStrip({
  cards, leagueId, teamId, teamAbbr, accent, footnote,
}: {
  cards: PositionVerdictCard[];
  leagueId: string;
  teamId: string;
  teamAbbr: string;
  /** The club's primary, so the row wears the same colours as its masthead. */
  accent: string;
  footnote: React.ReactNode;
}) {
  return (
    <section className="space-y-2.5">
      {/* Six across only from xl up. Below that they wrap — three, then two —
          rather than squashing to slivers, and QB leads the array so the
          quarterback is never the card that falls off the end of a row. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        {cards.map((c) => (
          <Card key={c.position} card={c} leagueId={leagueId} teamId={teamId} teamAbbr={teamAbbr} accent={accent} />
        ))}
      </div>
      <p className="text-[11px] text-muted px-1 leading-relaxed">{footnote}</p>
    </section>
  );
}

function Card({ card, leagueId, teamId, teamAbbr, accent }: {
  card: PositionVerdictCard; leagueId: string; teamId: string; teamAbbr: string; accent: string;
}) {
  void leagueId;
  // One source for the tier colour — RankChip's measured ramp — so the corner
  // flag, the verdict word and the rosettes below cannot drift apart.
  const flag = card.verdict ? rankTierHex(card.verdict.rank) : '#2d2d32';

  return (
    <div
      className="rating-chip relative flex flex-col bg-card border border-line/70 shadow-card min-h-[236px]"
      style={{
        ['--team-accent' as never]: accent,
        ['--chip-notch' as never]: '20px',
        background: `linear-gradient(168deg, color-mix(in srgb, ${accent} 13%, #18181b), #141416 55%)`,
      }}
    >
      {/* The cut corner's flag is the verdict. Same device as RatingBadge, so
          a reader who knows what a gold corner means on an OVR chip already
          knows what it means here. */}
      <div className="rating-chip-flag" style={{ borderTopColor: flag }} />
      <div aria-hidden className="absolute inset-0 overflow-hidden pointer-events-none">
        <TeamLogo seed={teamId} abbr={teamAbbr} size={120} className="watermark-logo opacity-[0.045] -right-7 -bottom-7" />
      </div>

      {/* ---- Who this card is about ------------------------------------- */}
      <div className="relative px-3 pt-3 pb-2.5">
        <div className="flex items-center justify-between gap-1.5 min-h-[20px]">
          <span className={`font-display font-bold text-sm uppercase tracking-wide ${positionBadgeClass(card.position)}`}>
            {card.slotLabel}
          </span>
          {card.verdict ? (
            <span className="inline-flex items-center gap-1 font-display font-bold uppercase tracking-wide text-[11px]" style={{ color: flag }}>
              <span aria-hidden>{rankTierGlyph(card.verdict.rank)}</span>
              {rankTierLabel(card.verdict.rank)}
            </span>
          ) : (
            <span className="font-mono text-[10px] text-muted/70">no grade</span>
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
            <div className="min-w-0">
              <span className="block font-semibold text-sm leading-tight text-muted">Unmanned</span>
              <span className="block font-mono text-[10px] text-muted/70 mt-0.5">nobody to start here</span>
            </div>
          )}
        </div>

        {card.verdict && (
          <div className="font-mono text-[10px] text-muted/80 mt-1.5 truncate">by {card.verdict.basis}</div>
        )}
        {!card.verdict && card.note && (
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

