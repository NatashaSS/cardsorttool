// RES-01 boards list (+ RES-03/04/05/06 actions).
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BoardsList } from "@/components/admin/results/BoardsList";
import type { BoardSummaryDTO, StudyDetailDTO } from "@/lib/api-types";
import { getDb } from "@/server/db/client";
import { ServiceError } from "@/server/errors";
import { listBoards } from "@/server/services/results";
import { getStudy } from "@/server/services/studies";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Boards" };

export default async function BoardsPage({ params }: PageProps<"/admin/studies/[id]/boards">) {
  const { id } = await params;
  const db = getDb();
  let study: StudyDetailDTO;
  let boards: BoardSummaryDTO[];
  try {
    study = getStudy(db, id);
    boards = listBoards(db, id);
  } catch (err) {
    if (err instanceof ServiceError && err.code === "not_found") notFound();
    throw err;
  }
  return (
    <BoardsList
      key={study.id}
      study={{
        id: study.id,
        title: study.title,
        status: study.status,
        shareUrl: study.shareUrl,
        participantFields: study.participantFields,
      }}
      initialBoards={boards}
      loadedAt={new Date().toISOString()}
    />
  );
}
