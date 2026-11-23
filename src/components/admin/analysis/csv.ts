// ANL-07: matrix CSV exports. Pure (used by the CSV route handlers, unit-tested directly).
import type { AnalysisResult } from "@/lib/api-types";

/** Byte-order mark so spreadsheet apps detect UTF-8. */
export const CSV_BOM = "﻿";
const CRLF = "\r\n";

/**
 * One RFC 4180 field. Text starting with = + - @, tab or CR is prefixed with ' so spreadsheet
 * apps don't evaluate it as a formula. Fields containing " , CR or LF are quoted.
 */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  let s = typeof value === "number" ? (Number.isFinite(value) ? String(value) : "") : value;
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** BOM + CRLF-separated rows (with a trailing CRLF). */
export function toCsv(rows: (string | number | null)[][]): string {
  return CSV_BOM + rows.map((r) => r.map(csvCell).join(",")).join(CRLF) + CRLF;
}

/** Ratio → percentage with one decimal, or null (blank cell). */
function pct(ratio: number | null): number | null {
  return ratio === null ? null : Math.round(ratio * 1000) / 10;
}

type Labels = { id: string; label: string }[];

/** Header cell: "Similarity % (n = 3)" or, filtered (ANL-09), "… (n = 3; Seniority: Senior)". */
function headerCell(title: string, n: number, note?: string): string {
  return `${title} (n = ${n}${note ? `; ${note}` : ""})`;
}

/**
 * Full (symmetric) similarity matrix in % in dendrogram leaf order; blank = never both sorted.
 */
export function similarityCsv(cards: Labels, result: AnalysisResult, note?: string): string {
  const { similarity, dendrogram } = result;
  const index = new Map(similarity.cardIds.map((id, i) => [id, i]));
  const label = new Map(cards.map((c) => [c.id, c.label]));
  const order = (
    dendrogram.leafOrder.length > 0 ? dendrogram.leafOrder : similarity.cardIds
  ).filter((id) => index.has(id));
  const rows: (string | number | null)[][] = [
    [headerCell("Similarity %", result.n, note), ...order.map((id) => label.get(id) ?? id)],
  ];
  for (const a of order) {
    const i = index.get(a) as number;
    rows.push([
      label.get(a) ?? a,
      ...order.map((b) => pct(similarity.ratio[i][index.get(b) as number])),
    ]);
  }
  return toCsv(rows);
}

/** Placement matrix in % of n (cards in admin order × groups, Other, Unsorted). */
export function placementCsv(cards: Labels, result: AnalysisResult, note?: string): string | null {
  const p = result.placement;
  if (!p) return null;
  const label = new Map(cards.map((c) => [c.id, c.label]));
  const rows: (string | number | null)[][] = [
    [headerCell("Placement %", p.n, note), ...p.columns.map((c) => c.label)],
  ];
  p.cardIds.forEach((id, i) => rows.push([label.get(id) ?? id, ...p.ratio[i].map(pct)]));
  return toCsv(rows);
}
