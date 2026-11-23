import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DB } from "@/server/db/open";
import { cardImages } from "@/server/db/schema";
import { ServiceError } from "@/server/errors";
import { createTestDb } from "../helpers/db";
import { makeCards, makeStudy } from "../helpers/factories";
import { SVG_BYTES, makePng } from "../helpers/card-images";

const state = vi.hoisted(() => ({ db: null as unknown as DB, isAdmin: true }));

vi.mock("@/server/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/server/session", () => ({
  requireAdmin: async () => {
    if (!state.isAdmin) throw new ServiceError("unauthorized", "Admin login required");
  },
}));

import * as imageRoute from "@/app/api/admin/studies/[id]/cards/[cardId]/image/route";
import * as publicImageRoute from "@/app/api/images/cards/[cardId]/route";

const ctx = <P extends Record<string, string>>(params: P) => ({ params: Promise.resolve(params) });

function upload(bytes: Buffer | null, opts: { name?: string; type?: string; field?: string } = {}) {
  const form = new FormData();
  if (bytes) {
    form.append(
      opts.field ?? "file",
      new Blob([new Uint8Array(bytes)], { type: opts.type ?? "image/png" }),
      opts.name ?? "image.png",
    );
  } else {
    form.append("other", "x");
  }
  return new Request("http://localhost/api/admin/studies/x/cards/y/image", {
    method: "PUT",
    body: form,
  });
}

let studyId: string;
let cardIds: string[];

beforeEach(() => {
  state.db = createTestDb();
  state.isAdmin = true;
  const study = makeStudy(state.db, { status: "draft", sortType: "open" });
  studyId = study.id;
  cardIds = makeCards(state.db, study.id, ["Apples", "Bananas"]).map((c) => c.id);
});

describe("card image API", () => {
  it("AUTH-03: the admin image routes return 401 without a session and change nothing", async () => {
    state.isAdmin = false;
    const params = ctx({ id: studyId, cardId: cardIds[0] });
    for (const res of [
      await imageRoute.PUT(upload(makePng()), params),
      await imageRoute.DELETE(new Request("http://localhost", { method: "DELETE" }), params),
    ]) {
      expect(res.status).toBe(401);
      expect((await res.json()).error.code).toBe("unauthorized");
    }
    expect(state.db.select().from(cardImages).all()).toHaveLength(0);
  });

  it("STU-13: PUT uploads a multipart image and returns the AdminCardDTO; DELETE removes it", async () => {
    const params = ctx({ id: studyId, cardId: cardIds[0] });
    const res = await imageRoute.PUT(
      upload(makePng(), { type: "application/octet-stream" }),
      params,
    );
    expect(res.status).toBe(200);
    const dto = await res.json();
    expect(dto).toMatchObject({ id: cardIds[0], label: "Apples", position: 0 });
    expect(dto.imageUrl).toMatch(new RegExp(`^/api/images/cards/${cardIds[0]}\\?v=\\d+$`));
    const row = state.db.select().from(cardImages).where(eq(cardImages.cardId, cardIds[0])).get();
    expect(row?.mimeType).toBe("image/png"); // sniffed, not the declared type

    const del = await imageRoute.DELETE(
      new Request("http://localhost", { method: "DELETE" }),
      params,
    );
    expect(del.status).toBe(200);
    expect((await del.json()).imageUrl).toBeNull();
    expect(state.db.select().from(cardImages).all()).toHaveLength(0);
  });

  it("STU-13: rejects non-multipart bodies and a missing file with 400", async () => {
    const params = ctx({ id: studyId, cardId: cardIds[0] });
    const json = await imageRoute.PUT(
      new Request("http://localhost", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      params,
    );
    expect(json.status).toBe(400);
    const raw = await imageRoute.PUT(
      new Request("http://localhost", {
        method: "PUT",
        headers: { "content-type": "image/png" },
        body: new Uint8Array(makePng()),
      }),
      params,
    );
    expect(raw.status).toBe(400);
    const missing = await imageRoute.PUT(upload(null), params);
    expect(missing.status).toBe(400);
    expect((await missing.json()).error.message).toMatch(/file/i);
  });

  it("STU-13: an SVG (even named .png) is rejected with 422 and a clear message", async () => {
    const res = await imageRoute.PUT(
      upload(SVG_BYTES, { name: "logo.png", type: "image/png" }),
      ctx({ id: studyId, cardId: cardIds[0] }),
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("unprocessable");
    expect(body.error.message).toMatch(/PNG, JPEG, WebP or GIF/);
  });

  it("STU-13: unknown card → 404; locked study → 409 study_locked", async () => {
    const missing = await imageRoute.PUT(upload(makePng()), ctx({ id: studyId, cardId: "nope" }));
    expect(missing.status).toBe(404);
    const live = makeStudy(state.db, { status: "live" });
    const [liveCard] = makeCards(state.db, live.id, ["X"]);
    const locked = await imageRoute.PUT(
      upload(makePng()),
      ctx({ id: live.id, cardId: liveCard.id }),
    );
    expect(locked.status).toBe(409);
    expect((await locked.json()).error.code).toBe("study_locked");
  });

  it("BRD-09: GET serves the image with long-lived caching and security headers; 404 without one", async () => {
    const png = makePng();
    const put = await (
      await imageRoute.PUT(upload(png), ctx({ id: studyId, cardId: cardIds[0] }))
    ).json();
    const res = await publicImageRoute.GET(
      new Request(`http://localhost${put.imageUrl}`),
      ctx({ cardId: cardIds[0] }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'");
    expect(Buffer.compare(Buffer.from(await res.arrayBuffer()), png)).toBe(0);

    // Public: works without an admin session.
    state.isAdmin = false;
    const again = await publicImageRoute.GET(
      new Request("http://localhost"),
      ctx({ cardId: cardIds[0] }),
    );
    expect(again.status).toBe(200);

    const none = await publicImageRoute.GET(
      new Request("http://localhost"),
      ctx({ cardId: cardIds[1] }),
    );
    expect(none.status).toBe(404);
    const unknown = await publicImageRoute.GET(
      new Request("http://localhost"),
      ctx({ cardId: "nope" }),
    );
    expect(unknown.status).toBe(404);
  });
});
