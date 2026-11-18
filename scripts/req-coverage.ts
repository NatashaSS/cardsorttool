// Requirement traceability (IMPLEMENTATION_PLAN §3.6).
// Lists requirement IDs from docs/REQUIREMENTS.md and which are referenced by tests.
//   npm run req:coverage             → report
//   npm run req:coverage -- --strict → exit 1 if any MUST requirement has no test
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const reqText = fs.readFileSync(path.join(root, "docs/REQUIREMENTS.md"), "utf8");

type Req = { id: string; priority: string; struck: boolean };
const reqs: Req[] = [];
for (const line of reqText.split("\n")) {
  const m = /^\|\s*(~~)?([A-Z]+-\d+)(~~)?\s*\|\s*([MSC])\s*\|/.exec(line);
  if (m) reqs.push({ id: m[2], priority: m[4], struck: Boolean(m[1]) });
}

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" ? [] : walk(p);
    return /\.(test|spec)\.tsx?$/.test(e.name) ? [p] : [];
  });
}

const covered = new Map<string, Set<string>>();
for (const file of walk(path.join(root, "tests"))) {
  const text = fs.readFileSync(file, "utf8");
  for (const m of text.matchAll(/\b([A-Z]{2,5}-\d{2})\b/g)) {
    if (!covered.has(m[1])) covered.set(m[1], new Set());
    covered.get(m[1])!.add(path.relative(root, file));
  }
}

const active = reqs.filter((r) => !r.struck);
const missing = (p: string) => active.filter((r) => r.priority === p && !covered.has(r.id));
for (const p of ["M", "S", "C"]) {
  const all = active.filter((r) => r.priority === p);
  const miss = missing(p);
  console.log(`${p}: ${all.length - miss.length}/${all.length} covered`);
  if (miss.length) console.log(`   missing: ${miss.map((r) => r.id).join(", ")}`);
}
const unknown = [...covered.keys()].filter((id) => !reqs.some((r) => r.id === id));
if (unknown.length) console.log(`Unknown IDs referenced in tests: ${unknown.join(", ")}`);

if (process.argv.includes("--strict") && missing("M").length > 0) process.exit(1);
