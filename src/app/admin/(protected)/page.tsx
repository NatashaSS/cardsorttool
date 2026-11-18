// STU-01: the admin's study list.
import Link from "next/link";
import { StudyList } from "@/components/admin/study-editor/StudyList";
import { getDb } from "@/server/db/client";
import { listStudies } from "@/server/services/studies";

export const dynamic = "force-dynamic";

export default function StudiesPage() {
  const studies = listStudies(getDb());
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Studies</h1>
          <p className="mt-1 text-sm text-muted">
            Create card sorts, share them, and review results.
          </p>
        </div>
        <Link
          href="/admin/studies/new"
          className="inline-flex h-10 items-center rounded-md bg-accent px-4 text-sm font-medium text-white hover:bg-accent-strong"
        >
          New study
        </Link>
      </div>
      <StudyList studies={studies} />
    </div>
  );
}
