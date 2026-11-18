import { StudyPanel } from "@/components/entry/StudyPanel";

/** Unknown study slug (PART-01). */
export default function StudyNotFound() {
  return (
    <StudyPanel>
      <h1 className="text-2xl font-semibold">We couldn&rsquo;t find this study</h1>
      <p className="mt-3 text-muted">
        The link may be incorrect or the study may have been removed. Please check the link you were
        given, or contact the person who sent it to you.
      </p>
    </StudyPanel>
  );
}
