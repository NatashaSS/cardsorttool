// Participant pages read the database at request time.
export const dynamic = "force-dynamic";

export default function ParticipantLayout({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-full flex-1 flex-col">{children}</div>;
}
