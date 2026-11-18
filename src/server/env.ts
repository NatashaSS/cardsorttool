import "server-only";

/** Server configuration from environment variables (see .env.example). */
export const env = {
  get databasePath() {
    return process.env.DATABASE_PATH || "data/cardsort.db";
  },
  get adminEmail() {
    return process.env.ADMIN_EMAIL ?? "";
  },
  /**
   * bcrypt hash. Recommended form: "b64:<base64 of the hash>" (no "$", so nothing — Next's .env
   * loader, Docker Compose, shells — can mangle it). Also accepted: the raw hash, or the hash with
   * each "$" escaped as "\$".
   */
  get adminPasswordHash() {
    const raw = (process.env.ADMIN_PASSWORD_HASH ?? "").trim();
    if (raw.startsWith("b64:")) return Buffer.from(raw.slice(4), "base64").toString("utf8");
    return raw.replace(/\\\$/g, "$");
  },
  get sessionSecret() {
    const secret = process.env.SESSION_SECRET ?? "";
    if (secret.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters");
    return secret;
  },
  get publicBaseUrl() {
    return (process.env.PUBLIC_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
  },
  get isProduction() {
    return process.env.NODE_ENV === "production";
  },
};
