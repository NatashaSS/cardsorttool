// Load .env for CLI scripts (Next.js loads it itself for the app).
try {
  process.loadEnvFile(".env");
} catch {
  // no .env file — rely on the real environment
}
