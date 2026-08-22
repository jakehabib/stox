import { PlayerAvatar } from '../PlayerAvatar';
import { TeamLogo } from '../TeamLogo';
import { positionBadgeClass } from '../ds/positionColor';
import { generateTeamLogoParams } from '@/lib/gen/teamLogo';

/**
 * The job title a commissioner reads out, not the two letters on the badge.
 * Nothing else in the app needs these — a board row has three characters of
 * space and the badge is the whole point there — so they live here, with the
 * one sentence that is spoken aloud.
 */
const SPOKEN: Record<string, string> = {
  QB: 'quarterback', RB: 'running back', FB: 'fullback', WR: 'wide receiver', TE: 'tight end',
  LT: 'offensive tackle', RT: 'offensive tackle', LG: 'guard', RG: 'guard', C: 'center',
  EDGE: 'edge rusher', DT: 'defensive tackle', LB: 'linebacker', CB: 'cornerback', S: 'safety',
  K: 'kicker', P: 'punter',
};

/** "an offensive tackle", "a quarterback" — the commissioner does not misread it. */
function article(word: string): string {
  return /^[aeiou]/i.test(word) ? 'an' : 'a';
}

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

export interface SelectionCardData {
  pickId: string;
  year: number;
  round: number;
  overall: number;
  team: { id: string; abbr: string; city: string; nickname: string };
  isUser: boolean;
  player: { id: string; firstName: string; lastName: string; position: string; college: string; age: number; heightIn: number; weightLb: number };
  /** The public board's read on him, as it stood before anybody was drafted. */
  board?: { rank: number; grade: number; bandLabel: string };
  /**
   * OUR file — the one we had a second ago, never a rebuilt one. Selection
   * clears Player.isDraftee, which is the gate lib/scouting.ts reads, so a
   * view built after the pick would print his true rating on the one screen
   * that exists to celebrate not knowing.
   */
  our?: { rank?: number; ovrLow: number; ovrHigh: number; potLow: number; potHigh: number; confidence: number; label: string; labelClass: string };
  shortlisted: boolean;
  /** Positive: he sat past where the board had him. Negative: taken ahead of it. */
  slide?: number;
  /** What the pick means in this room, in one line. */
  note?: string;
  leagueId: string;
}

/**
 * THE PICK THAT IS ON SCREEN RIGHT NOW.
 *
 * The draft page has a selection card and it is a good one, but it fires for
 * exactly one pick a year — the GM's own. Every other name in the draft
 * arrives as a row of grey text at the bottom of the page reading "Kansas City
 * selects...". This is the same ceremony extended to all 224 of them, because
 * the other clubs' picks are the part of draft day you actually watch.
 *
 * It states three things and stops: who took him, where the room had him, and
 * where WE had him. The third is the only one that costs anything to know.
 */
export function TheSelection({ data }: { data: SelectionCardData }) {
  const { player, team, board, our } = data;
  const accent = generateTeamLogoParams(team.abbr).primary;
  const height = `${Math.floor(player.heightIn / 12)}'${player.heightIn % 12}"`;
  const spoken = SPOKEN[player.position] ?? player.position;
  const slide = data.slide ?? 0;

  return (
    <div
      key={data.pickId}
      className="relative rounded-lg border shadow-card animate-fadeUp"
      style={{
        ['--team-accent' as never]: accent,
        borderColor: 'color-mix(in srgb, var(--team-accent) 55%, transparent)',
        background: 'radial-gradient(ellipse 110% 160% at 0% 0%, color-mix(in srgb, var(--team-accent) 14%, transparent), transparent 65%)',
      }}
    >
      <div className="absolute inset-0 overflow-hidden rounded-lg pointer-events-none">
        <TeamLogo seed={team.id} abbr={team.abbr} nickname={team.nickname} size={190} className="watermark-logo opacity-[0.05] -right-10 -top-10" />
      </div>

      <div className="relative p-5">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <TeamLogo seed={team.id} abbr={team.abbr} nickname={team.nickname} size={26} />
            <span className="label-sm truncate">
              With the {ordinal(data.overall)} selection of the {data.year} draft, {team.city} take {article(spoken)} {spoken}
            </span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {data.isUser && <span className="pill border-accent text-accent bg-accent/10 text-[10px]">Your Selection</span>}
            {data.shortlisted && <span className="pill border-gold text-gold bg-gold/10 text-[10px]">★ Shortlisted</span>}
          </div>
        </div>

        <div className="flex flex-wrap items-start gap-5">
          <div className="flex items-center gap-4 min-w-[19rem] flex-1">
            <PlayerAvatar
              seed={player.id}
              age={player.age}
              size={76}
              weightLb={player.weightLb}
              heightIn={player.heightIn}
              position={player.position}
              teamColor={accent}
            />
            <div className="min-w-0">
              <a
                href={`/league/${data.leagueId}/player/${player.id}`}
                className="font-display font-extrabold text-2xl uppercase tracking-wide leading-none text-chalk hover:text-accent2 block"
              >
                {player.firstName} {player.lastName}
              </a>
              <div className="flex items-center gap-2 mt-2">
                <span className={`pill text-[11px] font-semibold ${positionBadgeClass(player.position)}`}>{player.position}</span>
                <span className="text-xs text-muted">{player.college}</span>
              </div>
              <div className="text-xs text-muted mt-1.5 font-mono">
                {player.age} yrs · {height} · {player.weightLb} lb
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-px bg-line/60 rounded-md overflow-hidden shrink-0">
            <div className="bg-card/80 px-4 py-2.5 min-w-[7.5rem]">
              <div className="label-sm">The Room</div>
              <div className="stat-value text-stat-sm leading-none mt-1.5">{board ? `#${board.rank}` : '—'}</div>
              <div className="text-[11px] text-muted mt-1.5 truncate">{board ? board.bandLabel : 'ungraded'}</div>
            </div>
            <div className="bg-card/80 px-4 py-2.5 min-w-[7.5rem]">
              <div className="label-sm">Our Board</div>
              <div className={`stat-value text-stat-sm leading-none mt-1.5 ${our?.rank ? 'text-accent2' : 'text-muted'}`}>
                {our?.rank ? `#${our.rank}` : '—'}
              </div>
              <div className="text-[11px] text-muted mt-1.5 truncate">{our?.rank ? 'on our own board' : 'never written up'}</div>
            </div>
            <div className="bg-card/80 px-4 py-2.5 min-w-[7.5rem]">
              <div className="label-sm">Our File</div>
              {/* Greyed out when there is no real file behind it. The range is
                  still the honest thing to print — it is what our staff would
                  say if asked — but a wide baseline guess must not read like
                  knowledge we paid for. */}
              <div className={`stat-value text-stat-sm leading-none mt-1.5 ${our && our.rank !== undefined ? 'text-chalk' : 'text-muted'}`}>
                {our ? `${our.ovrLow}–${our.ovrHigh}` : '—'}
              </div>
              <div className={`text-[11px] mt-1.5 truncate ${our?.labelClass ?? 'text-muted'}`}>{our?.label ?? 'no read'}</div>
            </div>
          </div>
        </div>

        {(data.note || slide !== 0) && (
          <div className="mt-4 pt-3 border-t border-line/50 flex flex-wrap items-center gap-x-4 gap-y-1.5">
            {slide >= 8 && (
              <span className="text-xs font-medium text-accent2">
                He sat {slide} picks past where the room had him.
              </span>
            )}
            {slide <= -8 && (
              <span className="text-xs font-medium text-warn">
                Taken {-slide} picks ahead of the room&apos;s grade.
              </span>
            )}
            {data.note && <span className="text-xs text-chalk/80">{data.note}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
