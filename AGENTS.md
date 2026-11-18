# AGENTS.md

Guidance for AI coding agents (and humans) working in this repository.

> **Status: planning.** No application code exists yet. The layout and commands below are the
> target; keep this file updated as each phase lands (see `docs/DESIGN.md` §14).

## What this app is

A self-hosted **UX card sort research tool**. A single admin creates card sort *studies* (open,
closed or hybrid), defines cards, groups, participant permissions and which participant details
to collect, then shares a link. Participants sort cards into groups on a drag-and-drop board that
auto-saves every change, and finish via a confirmation modal that freezes the board. The admin
sees every board (in progress and completed) and analyses results with a similarity matrix,
placement matrix and dendrogram.

## Key documents (read before changing behaviour)

- `docs/REQUIREMENTS.md` — what must be built, with stable requirement IDs (`STU-03`, `SAVE-01`, …)
  and acceptance criteria. **This defines "done".**
- `docs/DESIGN.md` — architecture, data model, permission matrix, API, auto-save protocol,
  analysis algorithms.

## Tech stack

Next.js (App Router) · React · TypeScript · SQLite (better-sqlite3) · Drizzle ORM · zod ·
dnd-kit · Tailwind CSS · Radix UI · iron-session · Vitest · Playwright. Node.js 20+.

## Repository layout (target)

```
AGENTS.md               this file
docs/                   REQUIREMENTS.md, DESIGN.md
src/
  app/                  Next.js routes (pages + route handlers)
    admin/              admin UI (login, studies, boards, analysis)
    s/[slug]/           participant intro + board (b/[token])
    api/                JSON route handlers (api/admin/**, api/s/**, api/boards/**)
  components/
    board/              participant board: groups, cards, tray, DnD, completion modal
    admin/              admin forms, tables, heat-maps, dendrogram
    ui/                 shared primitives (buttons, dialog, inputs)
  lib/                  code shared by client and server: zod schemas, participant field
                        catalogue, permission/completion rules (pure functions), types
  server/
    db/                 Drizzle schema (schema.ts), connection (client.ts)
    services/           business logic: studies, boards (ops, completion), auth, export
    analysis/           pure functions: similarity, placement, clustering, group names
drizzle/                generated SQL migrations (committed)
scripts/                CLI helpers (e.g. hash-password, seed)
tests/
  unit/                 Vitest unit tests (pure functions, analysis)
  integration/          Vitest tests of services/route handlers on in-memory SQLite
  e2e/                  Playwright tests of full admin + participant flows
data/                   local SQLite database files (gitignored)
```

## Setup, build, run (target commands)

```bash
npm install
cp .env.example .env              # then fill in values
npm run hash-password -- 'secret' # prints a bcrypt hash for ADMIN_PASSWORD_HASH
npm run db:migrate                # create/upgrade the SQLite database
npm run db:seed                   # optional: sample studies
npm run dev                       # http://localhost:3000
```

| Command | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm run start` | Production build / serve |
| `npm run db:generate` | Generate a migration after editing `src/server/db/schema.ts` |
| `npm run db:migrate` | Apply migrations |
| `npm run lint` / `npm run typecheck` | ESLint / `tsc --noEmit` |
| `npm test` | Vitest unit + integration tests |
| `npm run test:e2e` | Playwright end-to-end tests |

Environment variables: `DATABASE_PATH`, `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`, `SESSION_SECRET`,
`PUBLIC_BASE_URL`. SQLite is used in **both** development and production — never add another
database.

## Conventions

- **Requirements traceability:** tests name the requirement IDs they cover, e.g.
  `it("DONE-04: rejects ops on a completed board", ...)`. When you implement or change behaviour,
  update `docs/REQUIREMENTS.md` first if the behaviour isn't already specified there.
- **Business rules live in one place.** Permission checks (`getBoardCapabilities`) and completion
  rules (`getCompletionBlockers`) are pure functions in `src/lib/` used by both client and server.
  The server must always enforce; the client only reflects.
- **Thin routes.** Route handlers validate with zod and delegate to `src/server/services`.
  Services take a `db` argument so tests can use an in-memory database.
- **Analysis is pure** (`src/server/analysis`) and must stay deterministic (stable tie-breaking).
- **Schema changes** go through Drizzle migrations committed under `drizzle/`; never edit an
  applied migration.
- **Never trust the client:** every board op checks the token, revision, board status, study status
  and ownership of referenced cards/groups.
- Client components must not import from `src/server/`.
- TypeScript strict mode; no `any` without a comment explaining why.
- Desktop-only UI (min width 1024 px).

## Definition of done for a change

1. Behaviour matches the acceptance criteria in `docs/REQUIREMENTS.md`.
2. Tests referencing the requirement IDs exist and pass (`npm test`, and `npm run test:e2e` for
   UI flows).
3. `npm run lint` and `npm run typecheck` pass.
4. `docs/DESIGN.md` and this file are updated if architecture, layout or commands changed.
