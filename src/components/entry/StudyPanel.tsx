import type { ReactNode } from "react";

/** Calm, centred card used by every participant entry page (intro, closed, not found). */
export function StudyPanel({ children }: { children: ReactNode }) {
  return (
    <main className="flex flex-1 items-start justify-center px-6 py-16 sm:py-24">
      <div className="w-full max-w-xl rounded-lg border border-line bg-surface p-8 shadow-sm">{children}</div>
    </main>
  );
}
