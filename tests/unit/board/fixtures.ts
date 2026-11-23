// BoardStateDTO fixtures for board UI unit tests.
import type { BoardStateDTO, CardDTO, GroupDTO } from "@/lib/api-types";
import { DEFAULT_SETTINGS, type StudySettings } from "@/lib/schemas";

export const card = (
  id: string,
  origin: CardDTO["origin"] = "predefined",
  description: string | null = null,
  imageUrl: string | null = null,
): CardDTO => ({
  id,
  label: `Label ${id}`,
  description,
  origin,
  imageUrl,
});

export const group = (
  id: string,
  cardIds: string[] = [],
  kind: GroupDTO["kind"] = "participant",
  name = `Name ${id}`,
): GroupDTO => ({
  id,
  name,
  kind,
  cardIds,
});

export function boardState(
  overrides: Partial<Omit<BoardStateDTO, "study" | "board">> & {
    study?: Partial<BoardStateDTO["study"]>;
    board?: Partial<BoardStateDTO["board"]>;
    settings?: Partial<StudySettings>;
  } = {},
): BoardStateDTO {
  const { study, board, settings, ...rest } = overrides;
  return {
    board: {
      id: "board-0001",
      token: "token-0001",
      status: "in_progress",
      revision: 0,
      participant: { name: "Ada Lovelace" },
      startedAt: "2026-01-01T00:00:00.000Z",
      lastActivityAt: "2026-01-01T00:00:00.000Z",
      completedAt: null,
      ...board,
    },
    study: {
      status: "live",
      sortType: "open",
      groupMode: "unbounded",
      fixedGroupCount: null,
      maxParticipantGroups: null,
      settings: { ...DEFAULT_SETTINGS, ...settings },
      slug: "study-slug",
      title: "Study",
      instructions: "Please sort the cards",
      participantFields: [{ key: "name", mode: "required" }],
      ...study,
    },
    cards: [],
    groups: [],
    unsortedCardIds: [],
    ...rest,
    // Default ranking: DTO card order (what the server does when PERM-08 is off).
    trayOrder: rest.trayOrder ?? (rest.cards ?? []).map((c) => c.id),
  };
}
