// STU-13: add / replace (PUT, multipart/form-data field "file") or remove (DELETE) the image of
// a predefined card. Both return the updated AdminCardDTO. DESIGN §11a.
import { CARD_IMAGE_MAX_BYTES, CARD_IMAGE_SIZE_MESSAGE } from "@/lib/card-images";
import { getDb } from "@/server/db/client";
import { ServiceError, badRequest } from "@/server/errors";
import { route } from "@/server/http";
import { removeCardImage, setCardImage } from "@/server/services/card-images";
import { requireAdmin } from "@/server/session";

type Params = { id: string; cardId: string };

/** Allowance for multipart overhead on top of the image limit before refusing to parse. */
const MAX_REQUEST_BYTES = CARD_IMAGE_MAX_BYTES + 256 * 1024;

export const PUT = route<Params>(async (req, { id, cardId }) => {
  await requireAdmin();
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    throw badRequest('Upload the image as multipart/form-data with a "file" field');
  }
  const length = Number(req.headers.get("content-length") ?? "0");
  if (length > MAX_REQUEST_BYTES) throw new ServiceError("unprocessable", CARD_IMAGE_SIZE_MESSAGE);
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw badRequest("The upload could not be read as multipart/form-data");
  }
  const file = form.get("file");
  if (!(file instanceof Blob)) throw badRequest('Choose an image file to upload (field "file")');
  if (file.size > CARD_IMAGE_MAX_BYTES) {
    // Refuse before reading the bytes; the service checks again.
    throw new ServiceError("unprocessable", CARD_IMAGE_SIZE_MESSAGE);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  return setCardImage(getDb(), id, cardId, bytes);
});

export const DELETE = route<Params>(async (_req, { id, cardId }) => {
  await requireAdmin();
  return removeCardImage(getDb(), id, cardId);
});
