"use client";
// ANL-03: dendrogram (SVG beside the card labels) with a cut-off slider that highlights clusters.
import { useId, useMemo, useState } from "react";
import type { Dendrogram } from "@/lib/api-types";
import { cutDendrogram, layoutDendrogram, similarityToDistance } from "./dendrogram";

const TREE_WIDTH = 520;
const AXIS_HEIGHT = 28;
const PAD_X = 8;
const TICKS = [100, 75, 50, 25, 0];

export function dendrogramRowHeight(n: number): number {
  if (n <= 40) return 24;
  if (n <= 100) return 18;
  return 14;
}

export function DendrogramView({
  dendrogram,
  labels,
}: {
  dendrogram: Dendrogram;
  labels: Map<string, string>;
}) {
  const [cut, setCut] = useState(50);
  const sliderId = useId();
  const { root, leafOrder } = dendrogram;
  const maxDistance = similarityToDistance(cut);

  const clusters = useMemo(() => cutDendrogram(root, maxDistance), [root, maxDistance]);
  const links = useMemo(
    () => layoutDendrogram(root, leafOrder, maxDistance),
    [root, leafOrder, maxDistance],
  );
  const clusterOf = useMemo(() => {
    const m = new Map<string, number>();
    let k = 0;
    for (const c of clusters) {
      if (c.length < 2) continue;
      k++;
      for (const id of c) m.set(id, k);
    }
    return m;
  }, [clusters]);

  if (!root || leafOrder.length === 0) {
    return <p className="text-sm text-muted">This study has no cards.</p>;
  }

  const rh = dendrogramRowHeight(leafOrder.length);
  const height = AXIS_HEIGHT + leafOrder.length * rh;
  const x = (d: number) => PAD_X + d * (TREE_WIDTH - 2 * PAD_X);
  const y = (u: number) => AXIS_HEIGHT + u * rh;
  const label = (id: string) => labels.get(id) ?? id;

  // Bands behind each multi-card cluster, alternating two tints (the numbers carry identity).
  const bands: { start: number; size: number; k: number }[] = [];
  let pos = 0;
  for (const c of clusters) {
    const k = clusterOf.get(c[0]);
    if (c.length > 1 && k !== undefined) bands.push({ start: pos, size: c.length, k });
    pos += c.length;
  }
  const multi = clusters.filter((c) => c.length > 1);
  const singles = clusters.filter((c) => c.length === 1).map((c) => c[0]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-line bg-surface px-4 py-3">
        <label htmlFor={sliderId} className="text-sm font-medium">
          Cut-off similarity
        </label>
        <input
          id={sliderId}
          type="range"
          min={0}
          max={100}
          step={1}
          value={cut}
          onChange={(e) => setCut(Number(e.target.value))}
          aria-valuetext={`${cut}%`}
          data-testid="cutoff-slider"
          className="w-64 accent-accent"
        />
        <output htmlFor={sliderId} className="w-12 text-sm font-semibold tabular-nums">
          {cut}%
        </output>
        <span className="text-sm text-muted" data-testid="cluster-count">
          {multi.length} {multi.length === 1 ? "cluster" : "clusters"}
          {singles.length > 0 && ` · ${singles.length} unclustered`}
        </span>
      </div>

      <div className="max-h-[75vh] overflow-auto rounded-lg border border-line bg-surface">
        <div className="relative flex" style={{ height }} data-testid="dendrogram">
          {bands.map((b) => (
            <div
              key={b.k}
              aria-hidden
              className={
                b.k % 2 ? "absolute inset-x-0 bg-accent/10" : "absolute inset-x-0 bg-accent/20"
              }
              style={{ top: y(b.start), height: b.size * rh }}
            />
          ))}
          <ol className="relative w-64 shrink-0 text-xs" style={{ paddingTop: AXIS_HEIGHT }}>
            {leafOrder.map((id) => (
              <li
                key={id}
                className="flex items-center gap-2 pr-2 pl-3"
                style={{ height: rh }}
                title={label(id)}
              >
                <span className="w-7 shrink-0 text-right text-[10px] font-semibold text-muted tabular-nums">
                  {clusterOf.has(id) ? `C${clusterOf.get(id)}` : ""}
                </span>
                <span className="truncate">{label(id)}</span>
              </li>
            ))}
          </ol>
          <svg
            className="relative shrink-0"
            width={TREE_WIDTH}
            height={height}
            role="img"
            aria-label={`Dendrogram of ${leafOrder.length} cards; ${multi.length} clusters at ${cut}% similarity`}
          >
            {TICKS.map((t) => (
              <g key={t}>
                <line
                  x1={x(similarityToDistance(t))}
                  x2={x(similarityToDistance(t))}
                  y1={AXIS_HEIGHT - 6}
                  y2={height}
                  stroke="var(--color-line)"
                  strokeDasharray="2 3"
                />
                <text
                  x={x(similarityToDistance(t))}
                  y={AXIS_HEIGHT - 10}
                  textAnchor={t === 100 ? "start" : t === 0 ? "end" : "middle"}
                  className="fill-muted text-[10px]"
                >
                  {t}%
                </text>
              </g>
            ))}
            {links.map((l, i) => (
              <path
                key={i}
                d={`M${x(l.d1)},${y(l.y1)}H${x(l.d)}V${y(l.y2)}H${x(l.d2)}`}
                fill="none"
                stroke={l.inCluster ? "var(--color-accent)" : "var(--color-muted)"}
                strokeWidth={l.inCluster ? 2 : 1.25}
                strokeLinejoin="round"
              />
            ))}
            <line
              x1={x(maxDistance)}
              x2={x(maxDistance)}
              y1={AXIS_HEIGHT - 4}
              y2={height}
              stroke="var(--color-ink)"
              strokeWidth={1.5}
              strokeDasharray="5 3"
              data-testid="cutoff-line"
            />
          </svg>
        </div>
      </div>
      <p className="text-xs text-muted">
        x-axis: similarity at which clusters merge (average linkage; 100% = always together).
        Branches left of the dashed cut-off line form the clusters.
      </p>

      <section aria-labelledby={`${sliderId}-clusters`} className="flex flex-col gap-2">
        <h3 id={`${sliderId}-clusters`} className="text-sm font-semibold">
          Clusters at {cut}% similarity
        </h3>
        {multi.length === 0 ? (
          <p className="text-sm text-muted">No cards are grouped together at this cut-off.</p>
        ) : (
          <ol className="flex flex-col gap-1.5 text-sm" data-testid="cluster-list">
            {multi.map((c, i) => (
              <li key={c[0]} className="rounded-md border border-line bg-surface px-3 py-2">
                <span className="font-semibold">C{i + 1}</span>{" "}
                <span className="text-muted">({c.length} cards):</span> {c.map(label).join(", ")}
              </li>
            ))}
          </ol>
        )}
        {singles.length > 0 && (
          <p className="text-sm text-muted">
            <span className="font-medium text-ink">Unclustered:</span>{" "}
            {singles.map(label).join(", ")}
          </p>
        )}
      </section>
    </div>
  );
}
