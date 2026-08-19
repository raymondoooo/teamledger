// Splitting a season into two halves that each have to pay for themselves.
//
// A club that bills for the whole year still spends it in two lumps: an autumn
// of games and practices, then a spring of them. Collecting enough overall is
// not the same as collecting enough by December, and a treasurer who only sees
// one annual total finds that out the hard way.
//
// The boundary is one date on the season. Everything dated before it is fall,
// everything on or after is spring — so games, dated expenses and instalments
// all work out their own half and the only thing anyone types is how many
// sessions they *expect*, which by definition has no date yet.

export type Segment = 'fall' | 'spring';

// Plain 'YYYY-MM-DD' strings compare correctly as strings, which is the whole
// reason the dates are stored that way. No Date object goes near this: parsing
// '2027-01-01' would make it midnight UTC and shift the boundary by a day for
// anyone west of Greenwich.
export function segmentOfDate(
  date: string | null | undefined,
  springStartsOn: string | null | undefined,
): Segment | null {
  if (!springStartsOn || !date) return null;
  return date < springStartsOn ? 'fall' : 'spring';
}

// Same boundary for a timestamp, which is what events carry.
export function segmentOfInstant(
  at: Date | null | undefined,
  springStartsOn: string | null | undefined,
): Segment | null {
  if (!springStartsOn || !at) return null;
  // Compared in local time on purpose: a 7pm game on the last day of the
  // boundary belongs to the half the treasurer thinks it does, not to whatever
  // UTC makes of it.
  const y = at.getFullYear();
  const m = String(at.getMonth() + 1).padStart(2, '0');
  const d = String(at.getDate()).padStart(2, '0');
  return segmentOfDate(`${y}-${m}-${d}`, springStartsOn);
}

export const SEGMENT_LABEL: Record<Segment, string> = {
  fall: 'fall',
  spring: 'spring',
};

// A rule's expected counts per half. Falls back to the old single total while
// both halves are zero, so a rule written before the split keeps its forecast
// until someone fills the halves in — and lands it all in the fall, which is
// the half that starts first and so the one a stale figure most likely meant.
export function expectedCountsFor(rule: {
  expectedFallCount: number;
  expectedSpringCount: number;
  expectedCount: number;
}): Record<Segment, number> {
  const split = rule.expectedFallCount + rule.expectedSpringCount;
  if (split > 0) {
    return { fall: rule.expectedFallCount, spring: rule.expectedSpringCount };
  }
  return { fall: rule.expectedCount, spring: 0 };
}

// The same, for a trainer's four counts.
export function expectedSessionsBySegment(trainer: {
  expectedFallGames: number;
  expectedFallPractices: number;
  expectedSpringGames: number;
  expectedSpringPractices: number;
  expectedSessions: number;
}): Record<Segment, number> {
  const fall = trainer.expectedFallGames + trainer.expectedFallPractices;
  const spring = trainer.expectedSpringGames + trainer.expectedSpringPractices;
  if (fall + spring > 0) return { fall, spring };
  return { fall: trainer.expectedSessions, spring: 0 };
}
