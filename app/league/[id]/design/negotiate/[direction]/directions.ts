import type { DirectionKey } from '@/components/negotiate/DesignNegotiationScreen';

/** The three directions, named once so the index and the pages agree. */
export const DIRECTIONS: { key: DirectionKey; name: string; pitch: string; detail: string }[] = [
  {
    key: 'table',
    name: 'The Table',
    pitch: 'Him on one side, your books on the other, the deal down the middle.',
    detail: 'A negotiation has two parties. The drag sits between the two things it changes — what he thinks of it and what it costs you — instead of above one and below the other.',
  },
  {
    key: 'sheet',
    name: 'The Term Sheet',
    pitch: 'The deal as a document that rewrites itself as you move it.',
    detail: 'Clauses in plain sentences with the controls set into the words they change, and Schedule A — every season, base, bonus and cap hit — as part of the contract rather than a panel beside it.',
  },
  {
    key: 'room',
    name: 'The Room',
    pitch: 'The negotiation as the series of calls it actually is.',
    detail: 'Every offer you make and every answer you get stacks up as the record of the talks, so a spent pip has a sentence attached to it. One column, and the only one of the three that works on a phone.',
  },
];
