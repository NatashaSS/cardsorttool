// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Board } from "@/components/board";
import { boardTokenKey } from "@/lib/storage-keys";
import { boardState, card, group } from "./fixtures";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ revision: 1, lastActivityAt: "t" })));
  vi.stubGlobal("fetch", fetchMock);
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const populated = (extra: Parameters<typeof boardState>[0] = {}) =>
  boardState({
    cards: [
      card("card-a", "predefined", "A long explanation"),
      card("card-b"),
      card("own-card", "participant"),
    ],
    groups: [group("group-1", ["card-b"], "participant", "Fruit")],
    unsortedCardIds: ["card-a", "own-card"],
    ...extra,
  });

describe("Board", () => {
  it("BRD-01: shows the participant note, instructions and a small-screen notice", () => {
    render(
      <Board
        initialState={populated({
          study: {
            participantFields: [
              { key: "name", mode: "required" },
              { key: "seniority", mode: "optional" },
            ],
          },
          board: { participant: { name: "Ada Lovelace", seniority: "senior" } },
        })}
      />,
    );
    const note = screen.getByTestId("participant-note");
    expect(note.textContent).toContain("Ada Lovelace");
    expect(note.textContent).toContain("Senior");
    expect(screen.getByTestId("instructions").textContent).toBe("Please sort the cards");
    expect(screen.getByTestId("small-screen-notice").textContent).toContain(
      "Please use a larger screen",
    );
  });

  it("BRD-04 / BRD-08: shows group names, card counts and progress", () => {
    render(<Board initialState={populated()} />);
    const g = screen.getByRole("region", { name: "Group Fruit" });
    expect(within(g).getByLabelText("1 card")).toBeTruthy();
    expect(screen.getByTestId("progress").textContent).toBe("1 of 3 cards sorted");
  });

  it("PART-03: stores the token for resuming", () => {
    render(<Board initialState={populated()} />);
    expect(window.localStorage.getItem(boardTokenKey("study-slug"))).toBe("token-0001");
  });

  it("BRD-06: controls follow the permission settings", () => {
    render(<Board initialState={populated({ settings: { allowParticipantCards: true } })} />);
    expect(screen.getByRole("button", { name: "+ New group" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "+ Add card" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete group Fruit" })).toBeTruthy();
    expect(screen.getByLabelText("Group name")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit card Label own-card" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit card Label card-a" })).toBeNull();
  });

  it("BRD-06: closed sorts show no group controls and no add card when PERM-01 is off", () => {
    render(
      <Board
        initialState={populated({
          study: { sortType: "closed" },
          groups: [group("group-1", ["card-b"], "predefined", "Fruit")],
        })}
      />,
    );
    expect(screen.queryByRole("button", { name: "+ New group" })).toBeNull();
    expect(screen.queryByRole("button", { name: "+ Add card" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Delete group/ })).toBeNull();
    expect(screen.queryByLabelText("Group name")).toBeNull();
  });

  it("STU-06: shows a hint when the group limit is reached", () => {
    render(<Board initialState={populated({ study: { maxParticipantGroups: 1 } })} />);
    expect(screen.queryByRole("button", { name: "+ New group" })).toBeNull();
    expect(screen.getByText(/maximum of 1 group/)).toBeTruthy();
  });

  it("DONE-01: the complete button is disabled with an explanation while rules are unmet", () => {
    render(<Board initialState={populated({ settings: { requireAllSorted: true } })} />);
    const button = screen.getByRole("button", { name: "Complete card sort" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByTestId("completion-blockers").textContent).toContain(
      "Sort all cards before completing (2 cards left).",
    );
  });

  it("BRD-05: adding a group sends addGroup and focuses its name input", async () => {
    render(<Board initialState={populated()} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "+ New group" })));
    const inputs = screen.getAllByLabelText("Group name");
    expect(inputs).toHaveLength(2);
    expect(document.activeElement).toBe(inputs[1]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/boards/token-0001/ops");
    expect(JSON.parse(init.body)).toMatchObject({
      revision: 0,
      op: { type: "addGroup", name: "" },
    });
  });

  it("PERM-09: shows a card description on hover when enabled", () => {
    render(<Board initialState={populated()} />);
    fireEvent.mouseEnter(screen.getByRole("button", { name: "Label card-a" }));
    expect(screen.getByRole("tooltip").textContent).toBe("A long explanation");
  });

  it("PERM-09: hides card descriptions when disabled", () => {
    render(<Board initialState={populated({ settings: { showCardDescriptions: false } })} />);
    fireEvent.mouseEnter(screen.getByRole("button", { name: "Label card-a" }));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("PART-05: a completed board is read-only with a thank-you banner", () => {
    render(
      <Board initialState={populated({ board: { status: "completed", completedAt: "t" } })} />,
    );
    expect(screen.getByTestId("readonly-banner").textContent).toBe(
      "You have completed this card sort — thank you.",
    );
    expect(screen.queryByRole("button", { name: "Complete card sort" })).toBeNull();
    expect(screen.queryByRole("button", { name: "+ New group" })).toBeNull();
    expect(screen.queryByLabelText("Group name")).toBeNull();
    expect(screen.queryByRole("button", { name: "Label card-a" })).toBeNull(); // not draggable
  });

  it("PART-06: a board of a closed study shows the closed message", () => {
    render(<Board initialState={populated({ study: { status: "closed" } })} />);
    expect(screen.getByTestId("readonly-banner").textContent).toContain(
      "This study has been closed",
    );
    expect(screen.queryByRole("button", { name: "Complete card sort" })).toBeNull();
  });

  it("RES-02: admin read-only mode renders everything without API calls or completion", () => {
    render(
      <Board
        initialState={populated({ settings: { allowParticipantCards: true } })}
        readOnly
        mode="admin"
      />,
    );
    expect(screen.getByRole("region", { name: "Group Fruit" })).toBeTruthy();
    expect(screen.getByTestId("progress").textContent).toBe("1 of 3 cards sorted");
    expect(screen.queryByRole("button", { name: "Complete card sort" })).toBeNull();
    expect(screen.queryByRole("button", { name: "+ Add card" })).toBeNull();
    expect(screen.queryByTestId("save-status")).toBeNull();
    expect(screen.queryByTestId("readonly-banner")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(boardTokenKey("study-slug"))).toBeNull();
  });
});
