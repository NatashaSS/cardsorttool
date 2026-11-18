import "server-only";

/** Server configuration from environment variables (see .env.example). */
export const env = {
  get databasePath() {
    return process.env.DATABASE_PATH || "data/cardsort.db";
  },
  get adminEmail() {
    return process.env.ADMIN_EMAIL ?? "";
  },
  /** bcrypt hash. In .env files each "$" must be escaped as "\$" (Next expands $VARS); accept both. */
  get adminPasswordHash() {
    return (process.env.ADMIN_PASSWORD_HASH ?? "").replace(/\\\$/g, "$");
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
