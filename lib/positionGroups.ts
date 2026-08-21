import { Position } from './tuning';

/**
 * Coarse position groups for analytics views — 17 individual positions is
 * too many categorical series to chart legibly (or safely under CVD).
 *
 * TE is its own group, not folded in with the receivers. They are not the
 * same job: a tight end blocks, and a roster carrying four wideouts and no
 * tight end reads as fully stocked when the two are counted together. That
 * is the roster-construction panel telling you something untrue about your
 * own team, which is worse than a chart with one more series in it.
 */
export const POSITION_GROUPS = ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'DB', 'ST'] as const;
export type PositionGroup = (typeof POSITION_GROUPS)[number];

const GROUP_BY_POSITION: Record<Position, PositionGroup> = {
  QB: 'QB',
  RB: 'RB', FB: 'RB',
  WR: 'WR', TE: 'TE',
  LT: 'OL', LG: 'OL', C: 'OL', RG: 'OL', RT: 'OL',
  EDGE: 'DL', DT: 'DL',
  LB: 'LB',
  CB: 'DB', S: 'DB',
  K: 'ST', P: 'ST',
};

export function positionGroup(position: string): PositionGroup {
  return GROUP_BY_POSITION[position as Position] ?? 'DB';
}
