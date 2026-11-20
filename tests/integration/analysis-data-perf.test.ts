import { describe, expect, it } from "vitest";
import { getAnalysisView } from "@/app/api/admin/studies/[id]/analysis/view";
import { getStudyAnalysis } from "@/server/services/analysis-data";
import { openDatabase, runMigrations } from "@/server/db/open";
import { makeStudy } from "../helpers/factories";

const CARDS = 200;
const GROUPS = 30;
const BOARDS = 1000;

/** Deterministic PRNG so the run is reproducible. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("analysis performance", () => {
  it("NFR-04: 200 cards × 30 groups × 1 000 boards analysed in under 3 s", () => {
    const { db, sqlite } = openDatabase(":memory:");
    runMigrations(db);
    const study = makeStudy(db, { sortType: "closed" });
    const now = new Date().toISOString();
    const rand = mulberry32(42);

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
        "INSERT INTO board (id, study_id, token, status, participant, card_order, revision, excluded, started_at, last_activity_at, completed_at) VALUES (?, ?, ?, 'completed', '{}', '[]', 0, 0, ?, ?, ?)",
      );
      const placement = sqlite.prepare(
        "INSERT INTO placement (board_id, card_id, group_id, position) VALUES (?, ?, ?, ?)",
      );
      for (let b = 0; b < BOARDS; b++) {
        const id = `b${b}`;
        board.run(id, study.id, `t${b}`, now, now, now);
        cardIds.forEach((cardId, i) => {
          if (rand() < 0.05) return; // ~5 % left unsorted
          placement.run(id, cardId, groupIds[Math.floor(rand() * GROUPS)], i);
        });
      }
    })();

    const start = performance.now();
    const result = getStudyAnalysis(db, study.id, { includeInProgress: false });
    const serviceMs = performance.now() - start;
    // The page/API path: also counts boards and serialises the payload.
    const viewStart = performance.now();
    const json = JSON.stringify(getAnalysisView(db, study.id, { includeInProgress: false }));
    const viewMs = performance.now() - viewStart;

    expect(result.n).toBe(BOARDS);
    expect(result.dendrogram.leafOrder).toHaveLength(CARDS);
    expect(result.placement?.columns).toHaveLength(GROUPS + 1);
    expect(json.length).toBeGreaterThan(0);
    expect(serviceMs).toBeLessThan(3000);
    expect(viewMs).toBeLessThan(3000);
  }, 60_000);
});
