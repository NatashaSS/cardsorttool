// Stream F2 replaces this placeholder with the intro + details form (PART-01).
export default async function StudyIntroPage({ params }: PageProps<"/s/[slug]">) {
  const { slug } = await params;
  return (
    <main className="mx-auto mt-24 max-w-xl px-6">
      <h1 className="text-2xl font-semibold">Card sort</h1>
      <p className="mt-2 text-muted">Study {slug} — intro page coming soon.</p>
    </main>
  );
}
