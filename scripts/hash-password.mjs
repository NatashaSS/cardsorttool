// Usage:  npm run hash-password -- 'my password'
//   or:   docker compose run --rm --no-deps cardsort node scripts/hash-password.mjs 'my password'
// Prints the ADMIN_PASSWORD_HASH line for .env. Plain JS so it also runs inside the Docker image.
//
// "$" in a bcrypt hash gets mangled by Next's .env loader and by Docker Compose, so we print a
// base64 form with no "$"; the server decodes the "b64:" prefix (src/server/env.ts).
import bcrypt from "bcryptjs";

const password = process.argv[2];
if (!password) {
  console.error("Usage: npm run hash-password -- '<password>'");
  process.exit(1);
}
const hash = bcrypt.hashSync(password, 12);
console.log("Add this line to your .env file (works for npm, systemd and Docker Compose):\n");
console.log(`ADMIN_PASSWORD_HASH=b64:${Buffer.from(hash, "utf8").toString("base64")}`);
