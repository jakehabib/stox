import { Position } from './tuning';

/**
 * Coarse position groups for analytics views — 17 individual positions is
 * too many categorical series to chart legibly (or safely under CVD); these
 * 8 groups match how real cap-allocation reports are usually cut, and land
 * exactly at the categorical token ceiling from the dataviz skill.
 */
export const POSITION_GROUPS = ['QB', 'RB', 'WR/TE', 'OL', 'DL', 'LB', 'DB', 'ST'] as const;
export type PositionGroup = (typeof POSITION_GROUPS)[number];

const GROUP_BY_POSITION: Record<Position, PositionGroup> = {
  QB: 'QB',
  RB: 'RB', FB: 'RB',
  WR: 'WR/TE', TE: 'WR/TE',
  LT: 'OL', LG: 'OL', C: 'OL', RG: 'OL', RT: 'OL',
  EDGE: 'DL', DT: 'DL',
  LB: 'LB',
  CB: 'DB', S: 'DB',
  K: 'ST', P: 'ST',
};

export function positionGroup(position: string): PositionGroup {
  return GROUP_BY_POSITION[position as Position] ?? 'DB';
}
