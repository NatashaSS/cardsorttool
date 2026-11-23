// BRD-09: public image of a card (card ids are unguessable, like board links). The `v` query
// (image updated_at in ms) busts the long-lived cache on replace. DESIGN §11a.
import { getDb } from "@/server/db/client";
import { notFound } from "@/server/errors";
import { route } from "@/server/http";
import { getCardImage } from "@/server/services/card-images";

export const dynamic = "force-dynamic";

export const GET = route<{ cardId: string }>(async (_req, { cardId }) => {
  const image = getCardImage(getDb(), cardId);
  if (!image) throw notFound("Image not found");
  return new Response(new Uint8Array(image.data), {
    status: 200,
    headers: {
      "Content-Type": image.mimeType,
      "Content-Length": String(image.data.byteLength),
      "Cache-Control": "public, max-age=31536000, immutable",
      "Last-Modified": new Date(image.updatedAt).toUTCString(),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
});
