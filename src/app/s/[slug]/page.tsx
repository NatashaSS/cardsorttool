// PART-01: participant intro page — study title, instructions and the entry flow
// (resume prompt, details form, board creation), or a "not accepting responses" page.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { EntryFlow } from "@/components/entry/EntryFlow";
import { StudyPanel } from "@/components/entry/StudyPanel";
import type { PublicStudyDTO } from "@/lib/api-types";
import { getDb } from "@/server/db/client";
import { ServiceError } from "@/server/errors";
import { getPublicStudy } from "@/server/services/boards";

const loadStudy = cache((slug: string): PublicStudyDTO | null => {
  try {
    return getPublicStudy(getDb(), slug);
  } catch (err) {
    if (err instanceof ServiceError && err.code === "not_found") return null;
    throw err;
  }
});

export async function generateMetadata({ params }: PageProps<"/s/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const study = loadStudy(slug);
  return { title: study ? `${study.title} · Card Sort` : "Study not found · Card Sort" };
}

export default async function StudyIntroPage({ params }: PageProps<"/s/[slug]">) {
  const { slug } = await params;
  const study = loadStudy(slug);
  if (!study) notFound();

  if (study.status !== "live") {
    return (
      <StudyPanel>
        <p className="text-sm text-muted">{study.title}</p>
        <h1 className="mt-1 text-2xl font-semibold">This study is not currently accepting responses</h1>
        <p className="mt-3 text-muted">
          Thank you for your interest. Please check back later, or contact the person who sent you the
          link.
        </p>
      </StudyPanel>
    );
  }

  return (
    <StudyPanel>
      <h1 className="text-2xl font-semibold">{study.title}</h1>
      {study.instructions && (
        <p className="mt-3 whitespace-pre-line text-ink/90" data-testid="study-instructions">
          {study.instructions}
        </p>
      )}
      <div className="mt-8">
        <EntryFlow study={{ slug: study.slug, participantFields: study.participantFields }} />
      </div>
    </StudyPanel>
  );
}
