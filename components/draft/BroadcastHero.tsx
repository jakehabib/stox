import { TeamLogo } from '../TeamLogo';
import { generateTeamLogoParams } from '@/lib/gen/teamLogo';

export interface UpcomingSlot {
  overall: number;
  round: number;
  teamId: string;
  abbr: string;
  isUser: boolean;
  isOnClock: boolean;
}

/**
 * The top of the broadcast: who is on the clock, in their colours, and how
 * many names go in before yours does.
 *
 * The draft page answers the first question and answers the second one three
 * panels further down, in a different unit ("next in 12 selections") from the
 * strip of crests that shows the same thing. Here they are one object: the
 * club on the clock, the clock itself, your own selection stated as a round
 * and a number, and the order of selection running out to it with your slot
 * lit up. Watching your pick come toward you is most of what draft day feels
 * like, and it should be legible from across the room.
 */
export function BroadcastHero({ eyebrow, headline, team, complete, clock, yourNext, upcoming }: {
  eyebrow: string;
  headline: string;
  /** The club on the clock. Absent once the draft is over — the band goes house-coloured. */
  team?: { id: string; abbr: string; city: string; nickname: string };
  complete: boolean;
  clock?: React.ReactNode;
  /**
   * The club's own next selection. `picksAway` is the count of names that go
   * in before it — 0 means the room is already waiting on you.
   */
  yourNext?: { round: number; overall: number; picksAway: number };
  /** The running order from the clock forward. */
  upcoming: UpcomingSlot[];
}) {
  const accent = team ? generateTeamLogoParams(team.abbr).primary : undefined;

  return (
    <div
      className="relative rounded-lg border-2 shadow-elevated"
      style={{
        ['--team-accent' as never]: accent ?? '#38bdf8',
        borderColor: 'var(--team-accent)',
        background: 'radial-gradient(ellipse 120% 140% at 0% 50%, color-mix(in srgb, var(--team-accent) 18%, transparent), transparent 70%)',
      }}
    >
      {/* Decoration is clipped, the card is not — the same split PageMasthead
          uses, so nothing that opens out of the band gets cut off. */}
      <div className="absolute inset-0 overflow-hidden rounded-lg pointer-events-none">
        <div
          className="absolute inset-0 opacity-[0.05]"
          style={{ backgroundImage: 'repeating-linear-gradient(115deg, currentColor 0px, currentColor 1px, transparent 1px, transparent 14px)', color: 'var(--team-accent)' }}
        />
        {team && <TeamLogo seed={team.id} abbr={team.abbr} nickname={team.nickname} size={240} className="watermark-logo opacity-[0.06] -right-16 -top-16" />}
      </div>

      <div className="relative flex flex-wrap items-center justify-between gap-6 px-6 py-6">
        <div className="flex items-center gap-4 min-w-0">
          {team && <TeamLogo seed={team.id} abbr={team.abbr} nickname={team.nickname} size={60} />}
          <div className="min-w-0">
            <div className="label-sm">{eyebrow}</div>
            <h1 className="font-display font-extrabold text-3xl uppercase tracking-wide leading-none mt-1.5 text-team">
              {headline}
            </h1>
          </div>
        </div>
        {clock && <div className="shrink-0">{clock}</div>}
      </div>

      {!complete && (
        <div className="relative border-t border-line/60 bg-ink/40 flex items-stretch">
          <div className="px-5 py-3 shrink-0 border-r border-line/40 w-[13.5rem]">
            <div className="label-sm">Your Next Selection</div>
            {yourNext ? (
              <>
                <div className={`stat-value text-stat-sm leading-none mt-1.5 ${yourNext.picksAway === 0 ? 'text-accent' : ''}`}>
                  R{yourNext.round} · #{yourNext.overall}
                </div>
                <div className="text-[11px] text-muted mt-1.5">
                  {yourNext.picksAway === 0
                    ? 'the room is waiting on you'
                    : yourNext.picksAway === 1
                      ? 'one name to go'
                      : `${yourNext.picksAway} names to go`}
                </div>
              </>
            ) : (
              <>
                <div className="stat-value text-stat-sm leading-none mt-1.5 text-muted">—</div>
                <div className="text-[11px] text-muted mt-1.5">nothing left to spend</div>
              </>
            )}
          </div>

          <div className="min-w-0 flex-1 px-5 py-3">
            <div className="label-sm mb-2">Order Of Selection</div>
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {upcoming.map((s) => (
                <div
                  key={s.overall}
                  title={`Pick ${s.overall} · ${s.abbr}`}
                  className={`shrink-0 flex flex-col items-center gap-1 px-2 py-1.5 rounded-lg border ${
                    s.isOnClock
                      ? 'border-accent bg-accent/10'
                      : s.isUser
                        ? 'border-gold bg-gold/10'
                        : 'border-line bg-raised/60'
                  }`}
                >
                  <TeamLogo seed={s.teamId} abbr={s.abbr} size={20} />
                  <span className={`text-[10px] font-mono font-semibold ${s.isUser ? 'text-gold' : ''}`}>{s.abbr}</span>
                  <span className="text-[9px] text-muted font-mono">#{s.overall}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
