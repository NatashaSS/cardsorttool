"use client";

import { useState, type FormEvent } from "react";
import { Button, Field, Input, Notice, Spinner } from "@/components/ui";
import { safeNextPath } from "./safe-next";

const GENERIC_ERROR = "Invalid email or password.";
const RATE_LIMITED = "Too many failed login attempts. Please wait a few minutes and try again.";
const NETWORK_ERROR = "Could not reach the server. Please try again.";

/** AUTH-02: posts to /api/admin/login, then navigates to `next` (a safe /admin path). */
export function LoginForm({ next }: { next?: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (res.ok) {
        // Full navigation so the protected layout renders with the new cookie.
        window.location.assign(safeNextPath(next));
        return;
      }
      setError(res.status === 429 ? RATE_LIMITED : GENERIC_ERROR);
      setPassword("");
    } catch {
      setError(NETWORK_ERROR);
    }
    setPending(false);
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4" noValidate>
      {error && <Notice tone="error">{error}</Notice>}
      <Field label="Email">
        {(p) => (
          <Input
            {...p}
            type="email"
            name="email"
            autoComplete="username"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        )}
      </Field>
      <Field label="Password">
        {(p) => (
          <Input
            {...p}
            type="password"
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        )}
      </Field>
      <Button type="submit" disabled={pending || !email || !password} className="mt-2">
        {pending && <Spinner label="Logging in" />}
        Log in
      </Button>
    </form>
  );
}
