import Link from "next/link";
import { requireAdminPage } from "@/server/session";

// Every admin page reads the session and the database at request time.
export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdminPage(); // AUTH-03 (stream A adds proxy.ts redirects as a second layer)
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b border-line bg-surface">
        <nav className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-6">
          <Link href="/admin" className="font-semibold">
            Card Sort
          </Link>
          <Link href="/admin" className="text-sm text-muted hover:text-ink">
            Studies
          </Link>
          <form action="/api/admin/logout" method="post" className="ml-auto">
            <button type="submit" className="text-sm text-muted hover:text-ink">
              Log out
            </button>
          </form>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
