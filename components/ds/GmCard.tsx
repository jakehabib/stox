import { TeamLogo } from '../TeamLogo';
import { RatingBadge } from './RatingBadge';
import { generateTeamLogoParams } from '@/lib/gen/teamLogo';
import { PLAYOFF_RESULT_LABEL, type GmCareerSummary } from '@/lib/gmCareer';

/**
 * ===========================================================================
 * THE GM CARD
 * ===========================================================================
 * The one artefact of this game other people will ever see. It is designed to
 * be SCREENSHOTTED — phone or OS, straight into a group chat — so it is a
 * single self-contained rectangle at trading-card proportions, not a strip of
 * dashboard. Everything about it follows from that:
 *
 *   * ONE SCREEN, ONE SHAPE. ~380x580, roughly 2:3, and it holds that shape
 *     down to a 390px phone. Nothing scrolls, nothing wraps out of the frame.
 *   * FEW, BIG NUMBERS. The record is the hero at 3.4rem; six figures follow
 *     it, and that is the whole card. A card with fourteen stats on it is a
 *     card nobody shares.
 *   * IT IS A FOOTBALL CARD, NOT A UI. No control, no hint, no sentence
 *     explaining the artefact to itself lives inside this rectangle. The only
 *     non-fact on it is the wordmark along the bottom, which is what a card
 *     manufacturer's mark has always been.
 *   * IT BORROWS THE HOUSE LANGUAGE, IT DOES NOT INVENT ONE. Team-tinted band
 *     with the crest watermark and the hash texture (PageMasthead), the
 *     notched rating chip for the Dynasty level (RatingBadge / .rating-chip),
 *     .stat-value figures, .label-sm labels, the same team accent token every
 *     other screen sets.
 *
 * EVERY NUMBER HERE IS PASSED IN, NONE IS DERIVED. The whole `GmCareerSummary`
 * arrives as one object — the same object the career page prints its own tiles
 * from — plus the Dynasty level the Dynasty screen shows and the best deal the
 * retrospectives panel below already graded. There is deliberately no
 * arithmetic in this file beyond the win-rate line, which is the same
 * expression the page's Record tile uses. A card that disagreed with the page
 * behind it would be worse than no card.
 * ===========================================================================
 */

export interface GmCardBestDeal {
  /** Season the deal was struck. */
  year: number;
  /** The club on the other end. */
  partnerAbbr: string;
  /** What came back, already summarised by the caller from the graded row. */
  received: string;
  /**
   * How far his return has outgained what he gave up, in points of growth —
   * retroEdgeFor's own number, rounded, never re-derived here. This is what
   * "he won the deal" is worth as a figure rather than a sentence, and the
   * app owner asked for it on the card: *"under 'best deal' it should show
   * like, the gain in value for example"*.
   */
  edgePct: number;
}

export function GmCard({ team, leagueName, seasonYear, gmName, summary, dynastyLevel, bestDeal }: {
  team: { id: string; abbr: string; city: string; nickname: string };
  leagueName: string;
  seasonYear: number;
  /** The account's username, when the save has been claimed. Nothing is invented if not. */
  gmName: string | null;
  summary: GmCareerSummary;
  /** `state.level.level` from lib/dynasty.ts — the figure on the Dynasty screen. */
  dynastyLevel: number;
  bestDeal: GmCardBestDeal | null;
}) {
  const s = summary;
  const accent = generateTeamLogoParams(team.abbr).primary;
  // Same expression as the career page's Record tile, so the two can never
  // round to different percentages for the same record.
  const games = s.wins + s.losses + s.ties;
  const winPct = games > 0 ? s.wins / (s.wins + s.losses || 1) : 0;

  // Two named lines, in the order they say the most about a front office: the
  // player he found, then the deal he won. Best season fills in for a GM who
  // has not yet drafted or dealt, so the card is never left with a hole.
  const lines: { label: string; value: string; detail: string; chip?: number; edgePct?: number }[] = [];
  if (s.signaturePick) {
    lines.push({
      label: 'Signature Pick',
      value: s.signaturePick.name,
      detail: `${s.signaturePick.position} · Round ${s.signaturePick.round}, ${s.signaturePick.year}`,
      chip: s.signaturePick.ovr,
    });
  }
  if (bestDeal) {
    lines.push({
      label: 'Best Deal',
      value: `${bestDeal.partnerAbbr}, ${bestDeal.year}`,
      detail: bestDeal.received,
      edgePct: bestDeal.edgePct,
    });
  }
  if (lines.length < 2 && s.bestSeason) {
    lines.push({
      label: 'Best Season',
      value: `${s.bestSeason.year} · ${s.bestSeason.wins}-${s.bestSeason.losses}${s.bestSeason.ties ? `-${s.bestSeason.ties}` : ''}`,
      detail: PLAYOFF_RESULT_LABEL[s.bestSeason.result] ?? s.bestSeason.result,
    });
  }

  return (
    <div
      className="relative flex flex-col w-[380px] min-h-[560px] max-w-[calc(100vw-1.5rem)] rounded-lg border-2 shadow-elevated overflow-hidden bg-card"
      style={{
        ['--team-accent' as never]: accent,
        borderColor: 'var(--team-accent)',
        background: `linear-gradient(175deg, color-mix(in srgb, ${accent} 22%, #101012), #0d0d0f 46%, #0a0a0b)`,
      }}
    >
      {/* Decoration only, clipped to the card: the stadium-light hash and the
          crest watermark, exactly as the page mastheads carry them. */}
      <div aria-hidden className="absolute inset-0 pointer-events-none overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage: 'repeating-linear-gradient(115deg, currentColor 0px, currentColor 1px, transparent 1px, transparent 14px)',
            color: accent,
          }}
        />
        <TeamLogo seed={team.id} abbr={team.abbr} size={300} className="watermark-logo opacity-[0.05] -right-24 top-24" />
      </div>

      {/* ---- Identity ------------------------------------------------------ */}
      <div
        className="relative px-5 pt-4 pb-4 border-b"
        style={{ borderColor: 'color-mix(in srgb, var(--team-accent) 45%, transparent)' }}
      >
        <div className="flex items-baseline justify-between gap-2">
          <div className="label-sm">General Manager</div>
          <div className="font-mono text-[10px] text-muted truncate max-w-[45%]">{leagueName}</div>
        </div>
        <div className="flex items-center gap-3 mt-2">
          <TeamLogo seed={team.id} abbr={team.abbr} size={46} className="shrink-0" />
          <div className="min-w-0">
            <div className="font-display font-extrabold uppercase tracking-wide text-[1.45rem] leading-[0.95] text-team">
              {team.city}
            </div>
            <div className="font-display font-extrabold uppercase tracking-wide text-[1.45rem] leading-[0.95] text-team">
              {team.nickname}
            </div>
          </div>
        </div>
        <div className="font-mono text-[11px] text-muted mt-2.5 truncate">
          {gmName ? `${gmName} · ` : ''}{s.firstYear}–{seasonYear} · {s.tenureYears} season{s.tenureYears === 1 ? '' : 's'}
        </div>
      </div>

      {/* ---- The hero: what he has actually done ----------------------------
          The one section that GROWS. A first-year GM has no signature pick and
          no graded deal, and without this his card came out nearly square —
          the shape is part of the artefact, so the slack goes here, behind the
          biggest number, rather than shortening the rectangle. */}
      <div className="relative flex-1 px-5 py-4 flex flex-col justify-center">
        <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="label-sm">Career Record</div>
          <div className="stat-value text-[3.4rem] leading-[0.85] mt-1.5">
            {s.wins}-{s.losses}{s.ties ? `-${s.ties}` : ''}
          </div>
          <div className="font-mono text-[11px] text-muted mt-2">
            {games > 0 ? `${(winPct * 100).toFixed(0)}% win rate` : 'No games yet'}
          </div>
        </div>
        {/* The notched chip is this app's rating shape. Carrying the Dynasty
            level in it — not an OVR — is why it is drawn here in the team
            accent rather than through RatingBadge's OVR tier colours: a level
            14 is not a 14-rated anything. */}
        <div className="shrink-0 text-center">
          <div
            className="rating-chip relative w-[74px] h-[74px] flex items-center justify-center border-2"
            style={{
              borderColor: 'var(--team-accent)',
              background: 'color-mix(in srgb, var(--team-accent) 30%, transparent)',
              ['--chip-notch' as never]: '13px',
            }}
          >
            <div className="rating-chip-flag" style={{ borderTopColor: accent }} />
            <span className="stat-value text-stat-md text-chalk">{dynastyLevel}</span>
          </div>
          <div className="label-sm text-[10px] mt-1.5">Dynasty Lv</div>
        </div>
        </div>
      </div>

      {/* ---- The three figures that separate one front office from another --- */}
      <div className="relative grid grid-cols-3 border-y border-line/70 divide-x divide-line/50 bg-ink/40">
        <Cell
          label="Rings"
          value={String(s.championships)}
          detail={`${s.playoffAppearances} playoff trip${s.playoffAppearances === 1 ? '' : 's'}`}
          gold={s.championships > 0}
        />
        <Cell
          label="Draft"
          value={s.draftHitRate !== null ? `${Math.round(s.draftHitRate * 100)}%` : '—'}
          detail={s.draftPicksMade === 0 ? 'No picks yet' : `${s.draftHits} of ${s.draftPicksMade} hit`}
        />
        <Cell
          label="All-Stars"
          value={String(s.allStars.players)}
          detail={`${s.allStars.selections} selection${s.allStars.selections === 1 ? '' : 's'}`}
          gold={s.allStars.players > 0}
        />
      </div>

      {/* ---- The two lines with a name in them ------------------------------ */}
      <div className="relative divide-y divide-line/50">
        {lines.map((l) => (
          <div key={l.label} className="px-5 py-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="label-sm text-[10px]">{l.label}</div>
              <div className="font-display font-bold uppercase tracking-wide text-[0.95rem] leading-tight mt-1 truncate">{l.value}</div>
              <div className="font-mono text-[10px] text-muted mt-0.5 truncate">{l.detail}</div>
            </div>
            {l.chip !== undefined && (
              <div className="shrink-0">
                <RatingBadge value={l.chip} size="sm" filled />
              </div>
            )}
            {/* Not a RatingBadge: that shape means a 0-99 player rating
                everywhere else in this app, and a growth figure wearing it
                would read as one. Same column, its own mark. "Outgained" is
                the retrospective panel's own verb for this quantity, so the
                card and the panel describe it with one word rather than two. */}
            {l.edgePct !== undefined && (
              <div className="shrink-0 text-right">
                <div className="stat-value text-[1.35rem] leading-none text-accent">+{l.edgePct}%</div>
                <div className="label-sm text-[9px] mt-1">outgained</div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* ---- Known for ------------------------------------------------------ */}
      <div className="relative px-5 pt-3 pb-3 border-t border-line/70 flex flex-wrap gap-1.5">
        {s.badges.slice(0, 2).map((b) => (
          <span
            key={b.title}
            className="pill text-[11px] font-display font-bold uppercase tracking-wide"
            style={{
              borderColor: 'color-mix(in srgb, var(--team-accent) 55%, transparent)',
              background: 'color-mix(in srgb, var(--team-accent) 12%, transparent)',
            }}
          >
            <span className="mr-1.5 not-italic">{b.icon}</span>
            <span className="text-team">{b.title}</span>
          </span>
        ))}
      </div>

      <div className="relative px-5 py-2 border-t border-line/70 bg-ink/50 flex items-baseline justify-between gap-2">
        <span className="font-display font-extrabold uppercase tracking-[0.2em] text-[10px] text-muted">Dynasty GM</span>
        <span className="font-mono text-[9px] text-muted/70">dynastygm.gg</span>
      </div>
    </div>
  );
}

function Cell({ label, value, detail, gold }: { label: string; value: string; detail: string; gold?: boolean }) {
  return (
    <div className="px-3 py-3 text-center">
      <div className="label-sm text-[10px]">{label}</div>
      <div className={`stat-value text-stat-md mt-1 ${gold ? 'text-gold' : ''}`}>{value}</div>
      <div className="font-mono text-[10px] text-muted mt-1 truncate">{detail}</div>
    </div>
  );
}
