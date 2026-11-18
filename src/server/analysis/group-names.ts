// ANL-04 / ANL-05 — participant group names and participant-created cards. Pure.
import type { AnalysisInput, GroupNameStat, ParticipantCardRow } from "@/lib/api-types";

export const TOP_CARDS_LIMIT = 10;

/** Trim, collapse internal whitespace, lowercase. */
export function normalizeGroupName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Plain code-unit comparison: locale-independent, hence deterministic. */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Over placements of predefined cards into groups of kind "participant" or "placeholder"
 * (predefined groups are skipped), keyed by normalised name; empty names are skipped.
 * - boardCount: distinct boards with at least one card in a group of that name;
 * - displayName: most common trimmed spelling, counted once per (board, group); ties →
 *   alphabetical by code unit;
 * - topCards: cards most often placed in groups of that name (count desc, then card order),
 *   at most TOP_CARDS_LIMIT.
 * Sorted by boardCount desc, then normalizedName (code-unit order). Groups holding no predefined
 * cards are not visible in AnalysisInput and therefore not counted.
 */
export function groupNameStats(input: AnalysisInput): GroupNameStat[] {
  type Acc = {
    boards: Set<string>;
    groups: Set<string>;
    spellings: Map<string, number>;
    cardCounts: Map<number, number>;
  };
  const byName = new Map<string, Acc>();

  for (const board of input.boards) {
    input.cards.forEach((card, cardIndex) => {
      const p = board.placements[card.id];
      if (!p || (p.groupKind !== "participant" && p.groupKind !== "placeholder")) return;
      const key = normalizeGroupName(p.groupName);
      if (key === "") return;
      let acc = byName.get(key);
      if (!acc) {
        acc = { boards: new Set(), groups: new Set(), spellings: new Map(), cardCounts: new Map() };
        byName.set(key, acc);
      }
      acc.boards.add(board.id);
      const groupKey = `${board.id}\u0000${p.groupId}`;
      if (!acc.groups.has(groupKey)) {
        acc.groups.add(groupKey);
        const spelling = p.groupName.trim();
        acc.spellings.set(spelling, (acc.spellings.get(spelling) ?? 0) + 1);
      }
      acc.cardCounts.set(cardIndex, (acc.cardCounts.get(cardIndex) ?? 0) + 1);
    });
  }

  const stats: GroupNameStat[] = [];
  for (const [normalizedName, acc] of byName) {
    const displayName = [...acc.spellings.entries()].sort(
      (a, b) => b[1] - a[1] || cmp(a[0], b[0]),
    )[0][0];
    const topCards = [...acc.cardCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .slice(0, TOP_CARDS_LIMIT)
      .map(([cardIndex, count]) => ({ cardId: input.cards[cardIndex].id, count }));
    stats.push({ normalizedName, displayName, boardCount: acc.boards.size, topCards });
  }
  return stats.sort(
    (a, b) => b.boardCount - a.boardCount || cmp(a.normalizedName, b.normalizedName),
  );
}

/** ANL-05: one row per participant-created card, board order then given order. */
export function participantCardRows(input: AnalysisInput): ParticipantCardRow[] {
  return input.boards.flatMap((board) =>
    board.participantCards.map((c) => ({
      boardId: board.id,
      label: c.label,
      groupName: c.groupName,
    })),
  );
}
