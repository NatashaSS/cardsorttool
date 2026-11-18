// Usage: npm run hash-password -- 'my password'   → prints a bcrypt hash for ADMIN_PASSWORD_HASH
import bcrypt from "bcryptjs";

const password = process.argv[2];
if (!password) {
  console.error("Usage: npm run hash-password -- '<password>'");
  process.exit(1);
}
const hash = bcrypt.hashSync(password, 12);
// Next.js expands $VARS in .env files (even quoted), so "$" must be escaped there.
console.log("Add this line to your .env file:\n");
console.log(`ADMIN_PASSWORD_HASH=${hash.replace(/\$/g, "\\$")}`);
console.log("\n(If you set the variable directly in the environment instead, use the raw hash:)");
console.log(hash);
