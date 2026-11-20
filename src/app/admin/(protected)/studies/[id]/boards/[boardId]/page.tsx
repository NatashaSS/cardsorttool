// RES-02 / PART-05: read-only view of one board.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AdminBoardView } from "@/components/admin/results/AdminBoardView";
import type { BoardStateDTO, BoardSummaryDTO } from "@/lib/api-types";
import { getDb } from "@/server/db/client";
import { ServiceError } from "@/server/errors";
import { getBoardStateById } from "@/server/services/boards";
import { getBoardSummary } from "@/server/services/results";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Board" };

export default async function AdminBoardPage({
  params,
}: PageProps<"/admin/studies/[id]/boards/[boardId]">) {
  const { id, boardId } = await params;
  const db = getDb();
  let summary: BoardSummaryDTO;
  let state: BoardStateDTO;
  try {
    // Throws not_found unless the board belongs to this study.
    summary = getBoardSummary(db, id, boardId);
    state = getBoardStateById(db, boardId);
  } catch (err) {
    if (err instanceof ServiceError && err.code === "not_found") notFound();
    throw err;
  }
  return (
    <AdminBoardView
      key={boardId}
      studyId={id}
      studyTitle={state.study.title}
      summary={summary}
      state={state}
    />
  );
}
