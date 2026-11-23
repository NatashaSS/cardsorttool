// Card image limits (STU-13, DESIGN §11a), shared by the editor (pre-check) and the server
// (authority). No Node/DB imports: this file is bundled for the client too.

/** Accepted image types; the server decides by magic bytes, never by the declared type. */
export const CARD_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export type CardImageType = (typeof CARD_IMAGE_TYPES)[number];

/** Maximum size of one card image in bytes (2 MB). */
export const CARD_IMAGE_MAX_BYTES = 2 * 1024 * 1024;

/** For `<input type="file" accept>`. */
export const CARD_IMAGE_ACCEPT = CARD_IMAGE_TYPES.join(",");

export const CARD_IMAGE_TYPE_MESSAGE = "Images must be PNG, JPEG, WebP or GIF files.";
export const CARD_IMAGE_SIZE_MESSAGE = "Images must be at most 2 MB.";
