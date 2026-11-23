# Implementation plan

How we build the app described in [`DESIGN.md`](./DESIGN.md) to satisfy
[`REQUIREMENTS.md`](./REQUIREMENTS.md), organised so that **independent workstreams can be handed
to parallel sub-agents**.

The core idea: a short, sequential **foundation** wave fixes every shared contract (database
schema, types, zod schemas, shared business rules, test helpers, dependencies). After that, each
workstream owns a disjoint set of files and codes against those contracts, so streams can be
built, tested and merged independently.

---

## 1. Overview

```
Wave 0  Foundation & contracts (1 agent, sequential)
          │
          ▼
Wave 1  ┌──────────┬──────────┬──────────┬──────────┬──────────┬──────────┬──────────┐
(parallel)│ A Auth   │ C Study  │ D Board  │ E Analysis│ F1 Board │ F2 Entry │ G Study  │
        │ UI+login │ service  │ service  │ (pure)   │ UI       │ pages    │ editor UI│
        │          │ +admin API│+part. API│          │          │          │          │
        └──────────┴──────────┴──────────┴──────────┴──────────┴──────────┴──────────┘
          │  merge + integration checkpoint 1 (end-to-end participant flow works)
          ▼
Wave 2  ┌────────────────┬────────────────┬────────────────┐
(parallel)│ H Admin results│ I Analysis UI  │ J E2E suite +  │
        │ list/view/CSV  │ matrices, tree │ traceability   │
        └────────────────┴────────────────┴────────────────┘
          │  merge + integration checkpoint 2 (all "M" requirements covered)
          ▼
Wave 3  M Card images  ·  N Analysis filters   (parallel)
```

Dependencies between Wave 1 streams are **only through Wave 0 contracts**, never through each
other's code. Wave 2 streams depend on merged Wave 1 code.

---

## 2. Working model for sub-agents

- **Coordinator** (the main session) runs Wave 0, spawns stream agents, reviews and merges their
  branches into `claude/vigilant-dirac-ayd58u`, runs the full test suite after each merge, and
  resolves conflicts.
- **Each stream agent runs in its own git worktree** (`isolation: "worktree"`) branched from the
  latest integration commit, so agents never touch each other's working files.
- **File ownership is strict.** A stream only creates/edits files under the paths listed as
  *Owns* for it. If it needs a change to a shared file (§3 "Shared, coordinator-owned"), it does
  **not** edit it; it describes the change in its final report and the coordinator applies it.
- **Docs:** stream agents don't edit `docs/*.md` or `AGENTS.md` (to avoid merge conflicts).
  They report any behaviour that deviates from or clarifies the requirements/design, and the
  coordinator updates `REQUIREMENTS.md` / `DESIGN.md` / `AGENTS.md` when merging.
- **Definition of done per stream:** all listed requirement IDs meet their acceptance criteria;
  tests named with those IDs pass; `npm run lint`, `npm run typecheck`, `npm test` pass in the
  worktree.
- **Worktree setup:** a fresh worktree has no `node_modules`. Hard-link a copy from the main
  checkout: `cp -al ../../../node_modules node_modules` (a symlink works for lint/tests but
  Turbopack's dev server — and so e2e — refuses packages outside the project root). Delete it
  before committing.
- **Final report** from every agent: what was built, files touched, requirement IDs covered (and
  any not covered + why), requested shared-file changes, deviations from the docs, open questions.

### Prompt template for a stream agent

> You are implementing **stream X** of the card sort tool. Read `AGENTS.md`,
> `docs/REQUIREMENTS.md`, `docs/DESIGN.md` and section *X* of `docs/IMPLEMENTATION_PLAN.md`.
> Only create or edit files under the paths this stream **owns**. Use the contracts in
> `src/lib/**` and `src/server/db/**` as-is; if one is wrong or missing, stop at a workaround
> local to your files and report the needed change. Write tests named with requirement IDs.
> Run lint, typecheck and tests before finishing. End with the report described in §2.

### How much to run at once

Each sub-agent starts cold and re-reads the docs, so parallelism costs more tokens than doing it
sequentially. Wave 1 has 7 streams; a sensible default is **3–4 concurrent agents**, e.g.
{C, D, E} first, then {A, F1, F2, G}. Streams can also be done by the coordinator directly.

---

## 3. Wave 0 — Foundation & contracts (coordinator, sequential) — ✅ done

> **Status:** complete. Deviations from the original list below: Cache Components is disabled
> (pages use `dynamic = "force-dynamic"`); `scripts/hash-password.ts` was written in Wave 0 (so
> stream A doesn't own it); `src/server/db/open.ts` holds `openDatabase`/`runMigrations` without
> `server-only` so scripts and tests can use it; admin pages live in the `admin/(protected)` route
> group; stub services also include `getPublicStudy`/`getBoardStateById` (D) and
> `services/analysis-data.ts` (I).

Everything other streams build against. Keep it small but **complete**: anything two streams
would both need belongs here.

### Deliverables

1. **Project scaffold**
   - Next.js (App Router, TS strict), Tailwind, ESLint, Prettier.
   - **All anticipated dependencies installed up front** (drizzle-orm, better-sqlite3,
     drizzle-kit, zod, @dnd-kit/*, @radix-ui/react-dialog, iron-session, bcryptjs, nanoid,
     vitest, @playwright/test, …) so streams don't fight over `package.json` / lockfile.
   - npm scripts from `AGENTS.md` (dev, build, start, lint, typecheck, test, test:e2e,
     db:generate, db:migrate, db:seed, hash-password).
   - `.env.example`, `.gitignore` (incl. `data/`).
2. **Database**
   - `src/server/db/schema.ts` — full schema from DESIGN §4 (all tables, incl. `excluded`,
     `revision`, `card_order`).
   - Initial migration in `drizzle/`; `src/server/db/client.ts` (WAL, foreign keys on);
     `scripts/migrate.ts`.
3. **Shared contracts** (`src/lib/`)
   - `types.ts` — domain types (Study, Card, Group, Board, Placement, enums).
   - `schemas.ts` — zod: `StudySettings` (with defaults), `ParticipantFieldConfig`, `BoardOp`,
     admin input schemas (create/update study, card, group, bulk cards, status transition),
     participant-details input.
   - `api-types.ts` — DTOs: `BoardStateDTO` (study config, capabilities, groups, cards,
     placements, tray order, revision, status), `StudyDTO`, `BoardSummaryDTO`, analysis result
     types (`SimilarityMatrix`, `PlacementMatrix`, `Dendrogram`, `GroupNameStat`,
     `ParticipantCardRow`), error shape `{ error: { code, message, details? } }`.
4. **Shared business rules, implemented + unit-tested** (used by server *and* client)
   - `src/lib/permissions.ts` — `getBoardCapabilities` (DESIGN §5 matrix). [PERM-01..04, BRD-06]
   - `src/lib/completion.ts` — `getCompletionBlockers`. [PERM-05..07, DONE-01, DONE-05]
   - `src/lib/participant-fields.ts` — field catalogue + `buildParticipantSchema(config)`.
     [PFLD-01, PFLD-02]
5. **Server plumbing**
   - `src/server/errors.ts` — `ServiceError(code, httpStatus, message)`.
   - `src/server/http.ts` — `handle(schema, fn)` wrapper for route handlers: parse JSON with zod,
     map `ServiceError`/zod errors to the error shape.
   - `src/server/session.ts` — iron-session config, `getAdminSession()`, `requireAdmin()`
     (throws `401` ServiceError), `isAdminCredentials(email, password)`.
   - Service function **signatures** with `throw new Error("not implemented")` bodies, so streams
     can import each other's future API without waiting:
     `services/studies.ts`, `services/boards.ts`, `services/results.ts`,
     `services/export.ts`, `analysis/index.ts`.
6. **Test infrastructure**
   - Vitest config (unit + integration projects), `tests/helpers/db.ts` (`createTestDb()` →
     migrated in-memory SQLite), `tests/helpers/factories.ts` (`makeStudy`, `makeCard`,
     `makeGroup`, `makeBoard`, `place`).
   - Playwright config with a `webServer` that runs migrations on a temp DB and seeds an admin.
   - `scripts/req-coverage.ts` + `npm run req:coverage` — scans tests for requirement IDs and
     prints which **M** requirements have no test yet.
7. **UI shell**
   - Root layout, Tailwind theme tokens (sticky-note yellow, etc.), `src/components/ui/`
     primitives: `Button`, `Input`, `Select`, `Dialog` (Radix), `Spinner`, `Notice`.
   - Empty route shells: `/admin/layout.tsx` (nav + auth guard), `/s/[slug]/layout.tsx`.
8. Update `AGENTS.md` status from "planning" to the real layout/commands.

### Shared, coordinator-owned files (after Wave 0)

`package.json`, lockfile, config files, `src/server/db/**`, `drizzle/**`, `src/lib/**`,
`src/server/errors.ts`, `src/server/http.ts`, `src/server/session.ts`, `src/components/ui/**`,
`tests/helpers/**`, `docs/**`, `AGENTS.md`.

Exception: a stream may fill in the **bodies** of the stub service file(s) it owns (listed below).

**Exit criteria:** `npm run lint/typecheck/test` pass; `npm run db:migrate` creates the DB;
`npm run dev` serves the empty shells; permissions/completion/participant-field tests pass.

---

## 4. Wave 1 — parallel streams

### Shared helpers added before the second Wave 1 batch

- `src/lib/storage-keys.ts` — localStorage key + safe read/write for the resume token (F1, F2).
- `tests/e2e/helpers.ts` — `e2eDb()` (seed the e2e DB with the factories) and `loginAsAdmin(page)`.
  **Login contract for stream A:** `POST /api/admin/login` with JSON `{ email, password }` → `200`
  + session cookie; `401` on bad credentials; `429` when rate-limited.

### A. Admin authentication UI

- **Requirements:** AUTH-02, AUTH-03 (redirect behaviour), AUTH-04, AUTH-05.
- **Owns:** `src/app/admin/login/**`, `src/app/api/admin/login/**`, `src/app/api/admin/logout/**`,
  `src/proxy.ts` (Next 16's renamed middleware), `src/server/services/rate-limit.ts`,
  `tests/**/auth*`.
- **Builds:** login page + form, login/logout route handlers (logout is a form POST from the admin
  nav, then redirect to login), `proxy.ts` redirecting unauthenticated `/admin/**` (except
  `/admin/login`) to login and returning `401` for `/api/admin/**` (except login), in-memory IP
  rate limiter.
- **Uses:** `src/server/session.ts`.

### C. Study service + admin API

- **Requirements:** STU-01..12 (server side), PERM-* (config persisted and validated),
  PFLD-01, PFLD-03, PFLD-04 (config), AUTH-03 (on its routes).
- **Owns:** body of `src/server/services/studies.ts`, `src/app/api/admin/studies/**`
  (except `…/boards/**`, `…/analysis/**`, `…/export/**`), `tests/**/studies*`.
- **Builds:** study CRUD, status transitions with the draft-only edit lock, card CRUD + reorder
  + bulk paste (dedupe), group CRUD + reorder, settings and participant-field config, publish
  validation (≥1 card; ≥1 group for closed/hybrid), random slug, duplicate study. Every route
  calls `requireAdmin()`.

### D. Board service + participant API

- **Requirements:** PART-02, PART-04, PART-06 (server), SAVE-01, SAVE-03, SAVE-04, SAVE-05,
  DONE-04, DONE-05, PERM-08 (shuffle), PFLD-02/05 (server validation), NFR-03.
- **Owns:** body of `src/server/services/boards.ts`, `src/app/api/s/**`,
  `src/app/api/boards/**`, `tests/**/boards*`.
- **Builds:** `getPublicStudy` (intro page data), `createBoard` (validate details with `buildParticipantSchema`, token, shuffled card
  order, placeholder groups for fixed mode), `getBoardState` → `BoardStateDTO`, `applyOp` for
  every `BoardOp` in one transaction (status checks, revision check, capability check via
  `getBoardCapabilities`, ownership checks, re-indexing), `completeBoard` (blockers via
  `getCompletionBlockers`, idempotent), `getBoardStateById` (for stream H). Perf test for NFR-03.
- **Note:** tests create studies via `tests/helpers/factories.ts`, not via stream C's service.

### E. Analysis engine (pure)

- **Requirements:** ANL-01, ANL-02, ANL-03, ANL-04, ANL-05 (computation), ANL-06.
- **Owns:** `src/server/analysis/**` (fills in `analysis/index.ts`), `tests/unit/analysis/**`.
- **Builds:** `similarityMatrix`, `placementMatrix`, `clusterAverageLinkage` (deterministic
  tie-breaking, returns tree + leaf order), `groupNameStats`, `participantCardRows`, all over plain
  input data (`AnalysisInput` from `api-types.ts`). Hand-computed fixtures incl. edge cases.
- **Fully independent** — no DB, no UI.

### F1. Participant board UI

- **Requirements:** BRD-01..08, SAVE-02 (client), SAVE-03 (client handling), DONE-01, DONE-02,
  DONE-03, PART-05 (read-only render), PERM-09.
- **Owns:** `src/components/board/**`, `src/app/s/[slug]/b/**`, `tests/unit/board/**`,
  `tests/e2e/board*`.
- **Builds:** board reducer (pure, unit-tested: applies `BoardOp` optimistically), single-flight
  save queue with retry/backoff and 409 handling, `BoardApiClient` (fetch wrapper over D's
  endpoints), dnd-kit board (groups, tray, overlay, keyboard sensor), group/card add/rename/delete
  controls gated by `capabilities`, progress indicator, save-status indicator, completion button +
  modal (confirm → thank-you in same modal), read-only mode (`readOnly` prop — **reused by stream
  H** for the admin board view), min-width notice.
- **Develops against:** `BoardStateDTO` fixtures; e2e tests run once D is merged.

### F2. Participant entry pages

- **Requirements:** PART-01, PART-03 (client: local-storage resume), PFLD-02 (form), PFLD-05.
- **Owns:** `src/app/s/[slug]/page.tsx` and siblings except `layout.tsx` and `b/**`,
  `src/components/entry/**`,
  `tests/**/entry*`.
- **Builds:** intro page, "study not accepting responses" page, participant details form
  generated from the catalogue + study config (client-side zod validation), resume prompt
  ("Continue where you left off" / "Start a new sort"), redirect to board URL.

### G. Admin study editor UI

- **Requirements:** STU-01, 02, 03, 07, 08, 09, 10, 11, 12 (UI), PERM-* (settings UI with
  irrelevant settings hidden per DESIGN §5), PFLD-01, 03, 04 (UI).
- **Owns:** `src/app/admin/(protected)/page.tsx`, `src/app/admin/(protected)/studies/**` (except
  `[id]/boards/**`, `[id]/analysis/**`), `src/components/admin/study-editor/**`,
  `tests/**/study-editor*`.
- **Builds:** study list, create form, editor tabs (Details, Type & groups, Cards, Participant
  fields, Settings), status controls with confirmation, read-only rendering when not draft,
  copy-link button, duplicate action. Calls stream C's API.
- **Develops against:** the admin input schemas and `StudyDetailDTO`; C is merged, so it can call
  the real API. Disable "open" as a sort type while predefined groups exist (the server rejects it).

> **Progress: Wave 1 complete.** All streams merged; integration checkpoint 1 passed
> (`tests/e2e/journey.spec.ts`: admin publishes via the API, participant enters, sorts, reloads,
> completes; board frozen). 298 unit/integration + 34 e2e tests passing. Coordinator follow-ups
> at merge: `trayOrder` added to `BoardStateDTO`; PERM-06 now only applies when renaming is allowed.

### Integration checkpoint 1 (coordinator)

Merge order: E, C, D, A, G, F2, F1 (any order works; this one minimises surprises). Then verify a
complete flow by hand and with a smoke e2e: admin logs in → creates and publishes a study →
participant opens link, fills details, sorts, reloads (state persists), completes (frozen).
Update docs with any reported deviations.

---

## 5. Wave 2 — parallel streams

### H. Admin results

- **Requirements:** RES-01..06, PART-05 (admin read-only view).
- **Owns:** body of `src/server/services/results.ts` and `src/server/services/export.ts`,
  `src/app/api/admin/studies/[id]/boards/**`, `src/app/api/admin/studies/[id]/export/**`,
  `src/app/admin/(protected)/studies/[id]/boards/**`, `src/components/admin/results/**`,
  `tests/**/results*`.
- **Builds:** board list (participant columns, status filter, sorting, auto-refresh), read-only
  board page reusing F1's board with `readOnly`, exclude/include and delete, CSV exports with
  formula-injection escaping.

### I. Analysis UI

- **Requirements:** ANL-01..05 (presentation), ANL-07, plus the include-in-progress toggle.
- **Owns:** body of `src/server/services/analysis-data.ts`,
  `src/app/api/admin/studies/[id]/analysis/**`,
  `src/app/admin/(protected)/studies/[id]/analysis/**`, `src/components/admin/analysis/**`,
  `tests/**/analysis-ui*`.
- **Builds:** `loadAnalysisInput` / `getStudyAnalysis`, analysis route (load boards →
  `AnalysisInput` → stream E functions), similarity
  heat-map (lower-triangular, dendrogram order, hover details), placement heat-map, dendrogram SVG
  with cut-off slider, group-names table, participant-cards table, `n` display, matrix CSV export.

### J. End-to-end suite & traceability

- **Requirements:** NFR-09, and e2e coverage for every **M** requirement not already covered.
- **Owns:** `tests/e2e/**` (except files owned by F1), CI workflow (`.github/workflows/**`).
- **Builds:** full journeys for closed, open-fixed, open-unbounded and hybrid studies with
  various PERM combinations; frozen-board and closed-study checks; multi-tab conflict test;
  `npm run req:coverage` reaching zero uncovered **M** requirements (or a list of justified gaps).

> **Progress: Wave 2 complete.** H, I and J merged; checkpoint 2 met: `req:coverage --strict`
> reports 66/66 MUST and 11/11 SHOULD covered; 341 unit/integration + 57 e2e (Chromium) tests
> pass. CI (`.github/workflows/ci.yml`) adds Firefox/WebKit via `E2E_ALL_BROWSERS=1` — not yet
> run (only Chromium is available in the dev container). Coordinator follow-ups: admin-mode board
> markers (H); Playwright browser projects + Firefox-safe clipboard permissions (J).

### Integration checkpoint 2

All three merged; `npm run req:coverage` shows every **M** requirement covered; full suite green.

---

## 6. Wave 3 — card images and analysis filters (parallel)

The original Wave 3 polish items (K) were all delivered in Waves 1–2, and hardening (L) is
deferred by the product owner (load check, security review, systemd example). Wave 3 instead adds
two features (REQUIREMENTS STU-13, BRD-09, ANL-09; DESIGN §11a). They touch disjoint files, so
they run in parallel. Waves 1–2 are finished, so file ownership is reassigned per stream below.

### M. Card images (STU-13, BRD-09)

- **Owns:** `src/server/db/schema.ts` + a new generated migration in `drizzle/` (the only stream
  touching the schema this wave); `src/lib/api-types.ts` (only the `imageUrl` fields on `CardDTO`
  and `AdminCardDTO`); new `src/server/services/card-images.ts`; `src/server/services/studies.ts`
  and `src/server/services/boards/state.ts` (populate `imageUrl`, copy images on duplicate);
  `src/app/api/admin/studies/[id]/cards/[cardId]/image/**`; `src/app/api/images/**`; the card
  list in `src/components/admin/study-editor/**`; `src/components/board/Card.tsx` (and test
  fixtures needing `imageUrl`); tests `tests/**/card-images*`.
- **Builds:** schema + migration, validation by magic bytes, upload/replace/remove API, public
  image route with caching/security headers, editor thumbnails and controls, board rendering.

### N. Analysis filters (ANL-09)

- **Owns:** `src/server/services/analysis-data.ts`, `src/app/api/admin/studies/[id]/analysis/**`,
  `src/app/admin/(protected)/studies/[id]/analysis/**`, `src/components/admin/analysis/**`,
  tests `tests/**/analysis-filter*`.
- **Builds:** filter parsing/serialising, filter options with counts, filtering in
  `loadAnalysisInput`, filter UI (per-field multi-select, chips, clear all, URL state), CSV
  exports honouring filters.

> **Progress: Wave 3 complete.** M and N merged; `req:coverage --strict` reports 69/69 MUST and
> 11/11 SHOULD; 385 unit/integration + 64 e2e tests pass; a v1 database upgrades via migration
> `0001_card_images`. Coordinator follow-up: N's filter logic moved to `src/lib/analysis-filter.ts`.

### Not in scope (deferred)

ANL-08 (merge group names), and the former L items: NFR-04 load check through the real UI,
security review, systemd example.

---

## 7. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Contracts in Wave 0 turn out wrong mid-Wave 1 | Agents report instead of editing shared files; coordinator patches the contract once and rebases/notifies remaining streams. |
| Lockfile / config conflicts | All dependencies and configs installed in Wave 0; streams don't touch `package.json`. |
| Migration conflicts | Only the coordinator generates migrations. Schema is complete in Wave 0. |
| Client and server rules drift | Single implementation in `src/lib/permissions.ts` / `completion.ts` used by both. |
| UI streams blocked on APIs | UI streams develop against DTO fixtures; e2e tests are added once the API is merged. |
| Docs drift | Only the coordinator edits docs, at every merge, based on agent reports. |
