import { describe, expect, it } from "vitest";
import { getAnalysisView } from "@/app/api/admin/studies/[id]/analysis/view";
import { openDatabase, runMigrations } from "@/server/db/open";
import { makeStudy } from "../helpers/factories";

const CARDS = 200;
const GROUPS = 30;
const BOARDS = 1000;
const SENIORITY = ["junior", "mid", "senior", "lead"];

describe("analysis filter performance", () => {
  it("NFR-04 ANL-09: 1 000 boards with participant details, filtered and unfiltered, under 3 s", () => {
    const { db, sqlite } = openDatabase(":memory:");
    runMigrations(db);
    const study = makeStudy(db, {
      sortType: "closed",
      participantFields: [
        { key: "name", mode: "required" },
        { key: "seniority", mode: "optional" },
        { key: "organisation", mode: "optional" },
      ],
    });
    const now = new Date().toISOString();
    let seed = 11;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const cardIds = Array.from({ length: CARDS }, (_, i) => `c${i}`);
    const groupIds = Array.from({ length: GROUPS }, (_, i) => `g${i}`);
    sqlite.transaction(() => {
      const card = sqlite.prepare(
        "INSERT INTO card (id, study_id, board_id, label, position, created_at) VALUES (?, ?, NULL, ?, ?, ?)",
      );
      cardIds.forEach((id, i) => card.run(id, study.id, `Card ${i}`, i, now));
      const group = sqlite.prepare(
        "INSERT INTO study_group (id, study_id, board_id, kind, name, position) VALUES (?, ?, NULL, 'predefined', ?, ?)",
      );
      groupIds.forEach((id, i) => group.run(id, study.id, `Group ${i}`, i));
      const board = sqlite.prepare(
        "INSERT INTO board (id, study_id, token, status, participant, card_order, revision, excluded, started_at, last_activity_at, completed_at) VALUES (?, ?, ?, 'completed', ?, '[]', 0, 0, ?, ?, ?)",
      );
      const placement = sqlite.prepare(
        "INSERT INTO placement (board_id, card_id, group_id, position) VALUES (?, ?, ?, ?)",
      );
      for (let b = 0; b < BOARDS; b++) {
        const id = `b${b}`;
        const participant = JSON.stringify({
          name: `Participant ${b}`,
          seniority: SENIORITY[b % SENIORITY.length],
          ...(b % 5 ? { organisation: `Org ${b % 37}` } : {}),
        });
        board.run(id, study.id, `t${b}`, participant, now, now, now);
        cardIds.forEach((cardId, i) => {
          if (rand() < 0.05) return;
          placement.run(id, cardId, groupIds[Math.floor(rand() * GROUPS)], i);
        });
      }
    })();

    const filters: Record<string, string[]>[] = [
      {},
      { seniority: ["senior", "lead"], organisation: ["org 1", ""] },
    ];
    for (const filter of filters) {
      const start = performance.now();
      const json = JSON.stringify(
        getAnalysisView(db, study.id, { includeInProgress: false, filter }),
      );
      const ms = performance.now() - start;
      expect(json.length).toBeGreaterThan(0);
      expect(ms).toBeLessThan(3000);
    }
    const view = getAnalysisView(db, study.id, {
      includeInProgress: false,
      filter: { seniority: ["senior"] },
    });
    expect(view.result.n).toBe(BOARDS / 4);
    // Names: 1 000 distinct answers are capped in the options.
    expect(view.filterOptions[0].hiddenValues).toBeGreaterThan(0);
  }, 60_000);
});
