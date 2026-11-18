import Link from "next/link";
import { CreateStudyForm } from "@/components/admin/study-editor/CreateStudyForm";

export default function NewStudyPage() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <Link href="/admin" className="text-sm text-muted hover:text-ink">
          ← Studies
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">New study</h1>
        <p className="mt-1 text-sm text-muted">
          You can add cards, groups, participant questions and permissions next.
        </p>
      </div>
      <CreateStudyForm />
    </div>
  );
}
