import { randomBytes } from "node:crypto";
import { customAlphabet, nanoid } from "nanoid";

/** Primary keys for rows created on the server. */
export const newId = () => nanoid();

/** Board token: 144 bits of randomness, URL-safe (PART-02). */
export const newBoardToken = () => randomBytes(18).toString("base64url");

/** Study slug for participant links: 12 chars of [a-z0-9] (~62 bits) (STU-11). */
export const newStudySlug = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 12);

export const nowIso = () => new Date().toISOString();
