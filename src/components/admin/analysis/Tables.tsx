// ANL-04 group names and ANL-05 participant-created cards.
import Link from "next/link";
import type { GroupNameStat, ParticipantCardRow } from "@/lib/api-types";
import { formatPct } from "./scale";

const TH = "border-b border-line px-3 py-2 text-left text-xs font-medium text-muted";
const TD = "border-b border-line px-3 py-2 align-top";
const TOP_CARDS_SHOWN = 5;

export function GroupNamesTable({
  stats,
  n,
  labels,
}: {
  stats: GroupNameStat[];
  n: number;
  labels: Map<string, string>;
}) {
  if (stats.length === 0) {
    return (
      <p className="text-sm text-muted">
        No participant-created group names yet (only groups holding at least one card count).
      </p>
    );
  }
  return (
    <div className="overflow-auto rounded-lg border border-line bg-surface">
      <table className="w-full text-sm" data-testid="group-names">
        <caption className="sr-only">Participant group names</caption>
        <thead>
          <tr>
            <th scope="col" className={TH}>
              Group name
            </th>
            <th scope="col" className={`${TH} text-right`}>
              Boards
            </th>
            <th scope="col" className={TH}>
              Cards most often placed in it
            </th>
          </tr>
        </thead>
        <tbody>
          {stats.map((s) => (
            <tr key={s.normalizedName}>
              <th scope="row" className={`${TD} text-left font-medium`}>
                {s.displayName}
              </th>
              <td className={`${TD} text-right whitespace-nowrap tabular-nums`}>
                {s.boardCount}{" "}
                <span className="text-muted">({formatPct(n ? s.boardCount / n : null)})</span>
              </td>
              <td className={TD}>
                {s.topCards.slice(0, TOP_CARDS_SHOWN).map((c, i) => (
                  <span key={c.cardId}>
                    {i > 0 && ", "}
                    {labels.get(c.cardId) ?? c.cardId}{" "}
                    <span className="text-muted tabular-nums">×{c.count}</span>
                  </span>
                ))}
                {s.topCards.length > TOP_CARDS_SHOWN && (
                  <span className="text-muted"> +{s.topCards.length - TOP_CARDS_SHOWN} more</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ParticipantCardsTable({
  studyId,
  rows,
}: {
  studyId: string;
  rows: ParticipantCardRow[];
}) {
  return (
    <div className="overflow-auto rounded-lg border border-line bg-surface">
      <table className="w-full text-sm" data-testid="participant-cards">
        <caption className="sr-only">Participant-created cards</caption>
        <thead>
          <tr>
            <th scope="col" className={TH}>
              Card
            </th>
            <th scope="col" className={TH}>
              Board
            </th>
            <th scope="col" className={TH}>
              Group
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.boardId}-${i}`}>
              <th scope="row" className={`${TD} text-left font-medium`}>
                {r.label}
              </th>
              <td className={TD}>
                <Link
                  href={`/admin/studies/${studyId}/boards/${r.boardId}`}
                  className="font-mono text-xs text-accent hover:underline"
                >
                  Board {r.boardId.slice(0, 8)}
                </Link>
              </td>
              <td className={TD}>
                {r.groupName === null ? (
                  <span className="text-muted italic">Unsorted</span>
                ) : r.groupName.trim() === "" ? (
                  <span className="text-muted italic">(unnamed group)</span>
                ) : (
                  r.groupName
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
