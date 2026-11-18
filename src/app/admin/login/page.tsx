import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/LoginForm";
import { safeNextPath } from "@/components/auth/safe-next";
import { isAdmin } from "@/server/session";

// Reads the session cookie at request time.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Admin login" };

/** AUTH-02: public login page. Already logged in → straight to /admin (or a safe ?next=). */
export default async function LoginPage({ searchParams }: PageProps<"/admin/login">) {
  const { next } = await searchParams;
  const nextPath = safeNextPath(Array.isArray(next) ? next[0] : next);
  if (await isAdmin()) redirect(nextPath);

  return (
    <main className="flex flex-1 items-start justify-center px-4">
      <div className="mt-24 w-full max-w-sm rounded-lg border border-line bg-surface p-8 shadow-sm">
        <h1 className="text-xl font-semibold">Admin login</h1>
        <p className="mt-1 text-sm text-muted">Sign in to manage card sort studies.</p>
        <LoginForm next={nextPath} />
      </div>
    </main>
  );
}
