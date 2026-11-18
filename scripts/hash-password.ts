// Usage: npm run hash-password -- 'my password'   → prints a bcrypt hash for ADMIN_PASSWORD_HASH
import bcrypt from "bcryptjs";

const password = process.argv[2];
if (!password) {
  console.error("Usage: npm run hash-password -- '<password>'");
  process.exit(1);
}
const hash = bcrypt.hashSync(password, 12);
// Next.js expands $VARS in .env files (even quoted), so "$" must be escaped there.
// Next.js expands $ sequences in .env files (and in real env vars that .env also defines),
// so always use the escaped form; the server unescapes it (src/server/env.ts).
console.log("Add this line to your .env file (or set the variable to this value):\n");
console.log(`ADMIN_PASSWORD_HASH=${hash.replace(/\$/g, "\\$")}`);
