/**
 * Position-group color coding — a fixed-order categorical assignment using
 * the app's already-validated viz palette (see app/globals.css / dataviz
 * skill), not invented colors. Used for small identity badges (draft board,
 * roster rows) so a scan of the list reads by position group at a glance.
 */
const GROUP: Record<string, string> = {
  QB: 'viz1', RB: 'viz1', FB: 'viz1', WR: 'viz1', TE: 'viz1',
  LT: 'viz3', LG: 'viz3', C: 'viz3', RG: 'viz3', RT: 'viz3',
  EDGE: 'viz2', DT: 'viz2', LB: 'viz2',
  CB: 'viz5', S: 'viz5',
  K: 'viz4', P: 'viz4',
};

const CLASS: Record<string, string> = {
  viz1: 'text-viz1 border-viz1/40', viz2: 'text-viz2 border-viz2/40', viz3: 'text-viz3 border-viz3/40',
  viz4: 'text-viz4 border-viz4/40', viz5: 'text-viz5 border-viz5/40',
};

export function positionBadgeClass(position: string): string {
  return CLASS[GROUP[position] ?? 'viz1'];
}
