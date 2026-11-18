import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cache Components is intentionally OFF: every page in this app reads the
  // database or the session at request time. Pages that read data export
  // `dynamic = "force-dynamic"` (see AGENTS.md).
  serverExternalPackages: ["better-sqlite3"],
  // Self-contained server bundle in .next/standalone — only for the Docker image (its build stage
  // sets NEXT_OUTPUT=standalone); `npm run start` keeps using `next start`.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
