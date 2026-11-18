import type { AnalysisBoard, AnalysisInput, AnalysisPlacement } from "@/lib/api-types";
import type { GroupKind } from "@/lib/types";

/** Shorthand for a placement. */
export const at = (
  groupId: string,
  groupName = groupId,
  groupKind: GroupKind = "participant",
): AnalysisPlacement => ({ groupId, groupKind, groupName });

/** Builds a board; cards missing from `placements` are unsorted (null). */
export function board(
  id: string,
  cardIds: string[],
  placements: Record<string, AnalysisPlacement | null>,
  participantCards: AnalysisBoard["participantCards"] = [],
): AnalysisBoard {
  const full: Record<string, AnalysisPlacement | null> = {};
  for (const c of cardIds) full[c] = placements[c] ?? null;
  return { id, placements: full, participantCards };
}

export function input(
  cardIds: string[],
  boards: AnalysisBoard[],
  groups: { id: string; name: string }[] = [],
): AnalysisInput {
  return { cards: cardIds.map((id) => ({ id, label: `Card ${id}` })), groups, boards };
}

/** Small deterministic PRNG (mulberry32) for generated fixtures. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random open-sort input: each card is unsorted with p = 0.1, else in one of `groups` groups. */
export function randomInput(cards: number, boards: number, groups: number, seed: number) {
  const rand = rng(seed);
  const cardIds = Array.from({ length: cards }, (_, i) => `c${i}`);
  const bs: AnalysisBoard[] = [];
  for (let b = 0; b < boards; b++) {
    const placements: Record<string, AnalysisPlacement | null> = {};
    for (const c of cardIds) {
      if (rand() < 0.1) placements[c] = null;
      else {
        const g = Math.floor(rand() * groups);
        placements[c] = at(`b${b}g${g}`, `Group ${g}`);
      }
    }
    bs.push({ id: `b${b}`, placements, participantCards: [] });
  }
  return input(cardIds, bs);
}
