// Study editor (STU-01..12, PERM-*, PFLD-01/03/04).
import { notFound } from "next/navigation";
import { StudyEditor } from "@/components/admin/study-editor/StudyEditor";
import type { StudyDetailDTO } from "@/lib/api-types";
import { getDb } from "@/server/db/client";
import { ServiceError } from "@/server/errors";
import { getStudy } from "@/server/services/studies";

export const dynamic = "force-dynamic";

export default async function StudyEditorPage({ params }: PageProps<"/admin/studies/[id]">) {
  const { id } = await params;
  let study: StudyDetailDTO;
  try {
    study = getStudy(getDb(), id);
  } catch (err) {
    if (err instanceof ServiceError && err.code === "not_found") notFound();
    throw err;
  }
  return <StudyEditor key={study.id} initialStudy={study} />;
}
