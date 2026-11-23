import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { config, proxy } from "@/proxy";
import { cardImageUrl, sniffImageType } from "@/server/services/card-images";
import { precheckCardImage } from "@/components/admin/study-editor/CardImageControls";
import { CARD_IMAGE_MAX_BYTES } from "@/lib/card-images";
import { GIF_BYTES, JPEG_BYTES, SVG_BYTES, WEBP_BYTES, makePng } from "../helpers/card-images";

describe("sniffImageType", () => {
  it("STU-13: recognises PNG, JPEG, GIF and WebP by their magic bytes", () => {
    expect(sniffImageType(makePng())).toBe("image/png");
    expect(sniffImageType(JPEG_BYTES)).toBe("image/jpeg");
    expect(sniffImageType(GIF_BYTES)).toBe("image/gif");
    expect(sniffImageType(Buffer.concat([Buffer.from("GIF87a"), Buffer.alloc(4)]))).toBe(
      "image/gif",
    );
    expect(sniffImageType(WEBP_BYTES)).toBe("image/webp");
  });

  it("STU-13: rejects SVG, text, other RIFF files, truncated headers and empty input", () => {
    expect(sniffImageType(SVG_BYTES)).toBeNull();
    expect(sniffImageType(Buffer.from("hello, world"))).toBeNull();
    expect(sniffImageType(Buffer.from("RIFF\0\0\0\0WAVEfmt "))).toBeNull();
    expect(sniffImageType(Buffer.from([0x89, 0x50, 0x4e]))).toBeNull();
    expect(sniffImageType(Buffer.from("GIF8"))).toBeNull();
    expect(sniffImageType(new Uint8Array(0))).toBeNull();
  });

  it("STU-13: ignores what the file claims to be (an SVG named .png is still an SVG)", () => {
    const fakePng = Buffer.concat([Buffer.from("<?xml version='1.0'?>"), SVG_BYTES]);
    expect(sniffImageType(fakePng)).toBeNull();
  });
});

describe("cardImageUrl", () => {
  it("BRD-09: builds a cache-busted URL from the image timestamp", () => {
    expect(cardImageUrl("abc123", "2026-01-02T03:04:05.678Z")).toBe(
      `/api/images/cards/abc123?v=${Date.parse("2026-01-02T03:04:05.678Z")}`,
    );
  });
});

describe("precheckCardImage (editor)", () => {
  it("STU-13: flags unsupported declared types and oversize files; leaves unknown types to the server", () => {
    expect(precheckCardImage({ type: "image/png", size: 100 })).toBeNull();
    expect(precheckCardImage({ type: "", size: 100 })).toBeNull();
    expect(precheckCardImage({ type: "image/svg+xml", size: 100 })).toMatch(
      /PNG, JPEG, WebP or GIF/,
    );
    expect(precheckCardImage({ type: "image/png", size: CARD_IMAGE_MAX_BYTES + 1 })).toMatch(
      /2 MB/,
    );
  });
});

describe("proxy and card image routes", () => {
  it("AUTH-03 / BRD-09: the admin image API is protected; the public image route is not matched", async () => {
    const saved = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = "unit-test-session-secret-at-least-32-chars";
    try {
      const res = await proxy(
        new NextRequest(new URL("/api/admin/studies/s1/cards/c1/image", "http://localhost:3000"), {
          method: "PUT",
        }),
      );
      expect(res.status).toBe(401);
    } finally {
      process.env.SESSION_SECRET = saved;
    }
    // The proxy only runs for /admin/** and /api/admin/**, so /api/images/** stays public.
    for (const m of config.matcher) {
      expect(m.startsWith("/admin") || m.startsWith("/api/admin")).toBe(true);
    }
  });
});
