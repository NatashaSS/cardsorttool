// Stream J: requirement traceability (NFR-09). Runs the same check as
// `npm run req:coverage -- --strict` and asserts every MUST requirement is referenced by a test,
// that all three test layers exist, and that CI runs them. No browser or server needed.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

const root = process.cwd();

// Browser-independent: run once, not per browser project.
test.skip(({ browserName }) => browserName !== "chromium", "Static check; runs in Chromium only");

function testFiles(dir: string, pattern: RegExp): string[] {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs, { recursive: true, encoding: "utf8" }).filter((f) => pattern.test(f));
}

test("NFR-09: every MUST requirement is covered by a test (req:coverage --strict)", () => {
  const tsx = path.join(
    root,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "tsx.cmd" : "tsx",
  );
  let output = "";
  let exitCode = 0;
  try {
    output = execFileSync(tsx, ["scripts/req-coverage.ts", "--strict"], {
      cwd: root,
      encoding: "utf8",
    });
  } catch (e) {
    const err = e as { status?: number; stdout?: string };
    exitCode = err.status ?? 1;
    output = err.stdout ?? "";
  }
  const must = /^M: (\d+)\/(\d+) covered$/m.exec(output);
  expect(must, output).not.toBeNull();
  expect(Number(must![1]), output).toBe(Number(must![2]));
  expect(Number(must![2])).toBeGreaterThan(0);
  // A "missing" line right after the M line would list uncovered MUST requirements.
  expect(output).not.toMatch(/^M: .*\n\s+missing:/m);
  expect(output).not.toContain("Unknown IDs referenced in tests");
  expect(exitCode, output).toBe(0);
});

test("NFR-09: unit, integration and end-to-end test layers all exist and CI runs them", () => {
  expect(testFiles("tests/unit", /\.test\.tsx?$/).length).toBeGreaterThan(0);
  expect(testFiles("tests/integration", /\.test\.tsx?$/).length).toBeGreaterThan(0);
  expect(testFiles("tests/e2e", /\.spec\.ts$/).length).toBeGreaterThan(0);

  const ci = fs.readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8");
  for (const step of [
    "npm run lint",
    "npm run typecheck",
    "npm test",
    "npm run req:coverage -- --strict",
    "npm run test:e2e",
  ]) {
    expect(ci, step).toContain(step);
  }
});
