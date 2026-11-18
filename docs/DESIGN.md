# Design

High-level design of the card sort research tool. Requirements (with IDs referenced below as
`[XXX-nn]`) live in [`REQUIREMENTS.md`](./REQUIREMENTS.md).

---

## 1. Background: what card sorting is

Card sorting is a UX research method for discovering how people mentally group information,
typically used to design or validate navigation and information architecture. Participants get a
set of cards (topics, pages, features) and sort them into groups that make sense to them. Results
from many participants are aggregated to find items people consistently put together.

| Type | Groups | Participants name groups? | Used to |
|---|---|---|---|
| **Open** | Created by participants | Yes | Discover users' mental models |
| **Closed** | Predefined by researcher | No | Validate an existing structure |
| **Hybrid** | Predefined + participants may add more | Only their own | Mix of both |

Standard practices this tool follows: randomised card order per participant, an "unsorted" tray,
optional card descriptions, participant demographics collected up front, and aggregate analysis
via a **similarity matrix**, **placement matrix** (closed/hybrid) and **dendrogram**.

A less common extension supported here: participants may add **their own cards** (useful for
"something is missing" feedback) [PERM-01].

---

## 2. Actors

| Actor | Auth | Can |
|---|---|---|
| **Admin** (exactly one) | Email + password, configured via env [AUTH-01] | Manage studies, view all boards, view analysis, export |
| **Participant** | None; access by unguessable board token [PART-02/04] | Fill in details, sort cards on their own board, complete it |

---

## 3. Architecture

A single **Next.js** (App Router, TypeScript) application serves both the UI and the API, backed by
a single **SQLite** file. No other services are required [NFR-01].

```
 Browser (admin)            Browser (participant)
       │                            │
       ▼                            ▼
┌──────────────────────────────────────────────────────┐
│ Next.js app (Node, `next start`)                     │
│                                                      │
│  UI: React Server Components + client components     │
│      /admin/**          /s/[slug]/**                 │
│                                                      │
│  HTTP: route handlers                                │
│      /api/admin/**      /api/boards/[token]/**       │
│                                                      │
│  Domain layer (src/server/services) ◄─ zod schemas   │
│  Analysis (src/server/analysis)       (src/lib)      │
│                                                      │
│  Data: Drizzle ORM ─► better-sqlite3 ─► data/*.db    │
└──────────────────────────────────────────────────────┘
        ▲ behind a reverse proxy (Caddy/nginx) for TLS
```

### Tech stack

| Concern | Choice | Why |
|---|---|---|
| Framework | **Next.js 16 (App Router, Turbopack), React 19, TypeScript** | One codebase and language for UI + API; easy self-hosting with `next start`. **Cache Components is off** (every page is request-time data); data-reading routes are `force-dynamic`. Auth redirects use `src/proxy.ts` (Next 16's renamed middleware). |
| Database | **SQLite** via **better-sqlite3** (WAL mode) | Zero setup, single-file backups, synchronous transactions are simple and fast for this workload |
| ORM / migrations | **Drizzle ORM + drizzle-kit** | Typed schema in TS, plain SQL migrations committed to the repo [NFR-02] |
| Validation | **zod** | Shared schemas for client forms and server endpoints [NFR-06] |
| Drag and drop | **dnd-kit** (`@dnd-kit/core`, `@dnd-kit/sortable`) | Best-in-class React DnD: sortable lists across containers, keyboard sensor + screen-reader announcements [BRD-02/03] |
| Styling | **Tailwind CSS** | Fast to build the sticky-note board look |
| Modal / UI primitives | **Radix UI** (Dialog, etc.) | Accessible modal with focus trap for the completion flow [DONE-02] |
| Admin auth | Custom: bcrypt hash in env + encrypted, HTTP-only session cookie (`iron-session`); `src/server/session.ts` | Single admin → no user table or auth framework needed |
| Charts | Hand-rolled SVG / HTML-table heat-maps; clustering implemented in TS | Small, testable, no heavy chart dependency |
| Tests | **Vitest** (unit + integration on an in-memory SQLite DB), **Playwright** (e2e) | [NFR-09] |

### Layering rules

- **Route handlers / pages are thin**: parse input with zod, call a service, map errors to HTTP.
- **Services** (`src/server/services/*`) hold all business rules (permissions, freezing,
  revisions). They take a `db` handle as a parameter so tests can pass an in-memory database.
- **Analysis** (`src/server/analysis/*`) is pure functions over plain data → easy to unit test [ANL-06].
- Client components never import from `src/server`.
- Route handlers use the `route()` wrapper (`src/server/http.ts`), which maps `ServiceError`
  codes (`src/server/errors.ts`) to HTTP statuses and the `{ error: { code, message } }` body.

---

## 4. Data model

SQLite tables (Drizzle schema in `src/server/db/schema.ts`). IDs are random strings (cuid2/nanoid);
timestamps are ISO-8601 UTC.

```
study
  id              PK
  slug            unique, unguessable (participant link)            [STU-11]
  title, description, instructions
  status          'draft' | 'live' | 'closed'                       [STU-03]
  sort_type       'open' | 'closed' | 'hybrid'                      [STU-04]
  group_mode      'fixed' | 'unbounded'  (open only)                [STU-05]
  fixed_group_count       int null                                  [STU-05]
  max_participant_groups  int null  (null = unlimited)              [STU-06]
  settings        JSON  -- StudySettings, see §5                    [PERM-*]
  participant_fields JSON -- ParticipantFieldConfig[], see §6       [PFLD-*]
  created_at, updated_at

card
  id, study_id FK
  board_id FK null   -- null = predefined; set = participant-created [PERM-01]
  label, description, position
  created_at

study_group                          -- "group" is an SQL keyword
  id, study_id FK
  board_id FK null   -- null = predefined; set = belongs to one board
  kind   'predefined' | 'placeholder' | 'participant'
         -- placeholder = the N groups pre-created for fixed-mode open sorts
  name, position

board
  id, study_id FK
  token          unique, 128-bit random, base64url                  [PART-02]
  status         'in_progress' | 'completed'
  participant    JSON  -- answers to participant fields             [PFLD-*]
  card_order     JSON  -- shuffled card ids for the tray            [PERM-08]
  revision       int   -- optimistic concurrency                    [SAVE-03]
  excluded       bool  -- excluded from analysis                    [RES-03]
  started_at, last_activity_at, completed_at

placement                            -- only for sorted cards; absent row = unsorted
  board_id FK, card_id FK   (PK: board_id + card_id)
  group_id FK
  position int
```

Notes:
- **Unsorted** is represented by the absence of a placement row. Tray order comes from
  `board.card_order` (participant-created cards are appended).
- Deleting a group deletes its placements → those cards return to the tray [PERM-04].
- `ON DELETE CASCADE` from study → cards/groups/boards → placements [STU-01, RES-04].
- Settings and participant fields are JSON because they're always read/written as a whole with the
  study, and their shape evolves. They are validated with zod on read and write.

---

## 5. Study settings and the permission matrix

```ts
type StudySettings = {
  allowParticipantCards: boolean;    // PERM-01, default false
  allowEditOwnCards: boolean;        // PERM-02, default true
  allowRenameGroups: boolean;        // PERM-03, default true
  allowDeleteGroups: boolean;        // PERM-04, default true
  requireAllSorted: boolean;         // PERM-05, default false
  requireGroupNames: boolean;        // PERM-06, default true
  allowEmptyGroups: boolean;         // PERM-07, default true
  randomizeCardOrder: boolean;       // PERM-08, default true
  showCardDescriptions: boolean;     // PERM-09, default true
};
```

Which participant actions are possible, by sort type (✓ = always, ⚙ = controlled by setting,
✗ = never):

| Action | Closed | Open · fixed N | Open · unbounded | Hybrid |
|---|---|---|---|---|
| Move cards | ✓ | ✓ | ✓ | ✓ |
| Add group | ✗ | ✗ | ✓ (≤ max) | ✓ (≤ max) |
| Rename group | ✗ | ⚙ placeholders | ⚙ own groups | ⚙ own groups only |
| Delete group | ✗ | ✗ | ⚙ own groups | ⚙ own groups only |
| Add own card | ⚙ | ⚙ | ⚙ | ⚙ |
| Edit/delete own card | ⚙ | ⚙ | ⚙ | ⚙ |
| Group names required | n/a | ⚙ | ⚙ | ⚙ (own groups) |

This matrix is implemented once, as a pure function
`getBoardCapabilities(study, group?) → { canAddGroup, canRename, ... }` in
`src/server/services/permissions.ts`, used by **both** the server (enforcement) and the client
(showing/hiding controls) so they can't drift apart.

The admin editor (`src/components/admin/study-editor/settings-model.ts`) shows only the settings
that apply: PERM-02 only when PERM-01 is on; PERM-03, PERM-06 and PERM-07 hidden for closed sorts;
PERM-04 only for open-unbounded and hybrid. Hidden settings keep their stored value (and are
ignored by the server rules). The participant group limit (STU-06) is an opt-in checkbox + number,
shown only for open-unbounded and hybrid.

In fixed-mode open sorts, placeholder groups are named "Group 1"…"Group N". If
`requireGroupNames` is on, a non-empty placeholder still carrying its default name blocks
completion.

---

## 6. Configurable participant fields

```ts
type ParticipantFieldConfig =
  | { key: BuiltInFieldKey; mode: 'optional' | 'required' }    // catalogue field
  | { key: `custom_${string}`; label: string; mode: 'optional' | 'required' }; // PFLD-04

type BuiltInFieldKey =
  'name' | 'email' | 'organisation' | 'role' | 'seniority'
  | 'ageRange' | 'gender' | 'country' | 'nationality';
```

- The array order is the display order [PFLD-03]; fields not in the array are "off".
- A **field catalogue** (`src/lib/participant-fields.ts`) defines each built-in field's label,
  input type, options and zod validator [PFLD-02]. The participant form and the server-side
  validator are both generated from the catalogue + the study's config.
- Answers are stored as JSON on `board.participant`, keyed by field key. A self-described gender
  is stored as `gender: "self_describe"` plus `genderSelfDescribe: "<text>"`.
- The admin board list [RES-01] and CSV export [RES-05] show columns for the enabled fields.
- Changing fields is only allowed in `draft` [STU-03], so all boards of a study share one schema.

---

## 7. Routes

### Pages

| Route | Who | Purpose |
|---|---|---|
| `/admin/login` | public | Login form [AUTH-02] |

All other admin pages live in the `src/app/admin/(protected)/` route group, whose layout calls
`requireAdminPage()` (the group name doesn't appear in URLs).

| Route | Who | Purpose |
|---|---|---|
| `/admin` | admin | Study list [STU-01] |
| `/admin/studies/new` | admin | Create study |
| `/admin/studies/[id]` | admin | Study editor: details, type, settings, cards, groups, participant fields, status, share link |
| `/admin/studies/[id]/boards` | admin | Boards list [RES-01] |
| `/admin/studies/[id]/boards/[boardId]` | admin | Read-only board view [RES-02] |
| `/admin/studies/[id]/analysis` | admin | Matrices, dendrogram, group names, participant cards [ANL-*] |
| `/s/[slug]` | public | Intro + details form, or "closed" page [PART-01] |
| `/s/[slug]/b/[token]` | token holder | The board [BRD-*] |

### API (JSON)

Participant (token-scoped; every mutating request includes `revision`):

| Method & path | Purpose |
|---|---|
| `POST /api/s/[slug]/boards` | Validate participant details, create a board → `{ token }` [PART-02] |
| `GET  /api/boards/[token]` | Full board state (study config, capabilities, groups, cards, placements, revision) |
| `POST /api/boards/[token]/ops` | Body `{ revision, op }`; applies **one** board operation (below) → `{ revision, lastActivityAt }` |
| `POST /api/boards/[token]/complete` | Complete and freeze [DONE-03/04/05] → `{ status, completedAt }` |

Board operations (discriminated union validated with zod):

```ts
type BoardOp =                                   // src/lib/schemas.ts BoardOpSchema
  | { type: 'moveCard';    cardId; toGroupId: string | null; toIndex: number } // null = tray
  | { type: 'addGroup';    groupId; name; withCardId? }                        // BRD-05/07
  | { type: 'renameGroup'; groupId; name }
  | { type: 'deleteGroup'; groupId }
  | { type: 'addCard';     cardId; label; description? }
  | { type: 'editCard';    cardId; label; description? }
  | { type: 'deleteCard';  cardId };
```

`groupId` in `addGroup` and `cardId` in `addCard` are **generated by the client** (nanoid) so the
op can be applied optimistically without waiting for the server; the server validates the id
format and rejects duplicates. New participant groups are appended after existing groups.
Participant group names may be blank while editing; PERM-06 blocks completion instead.

Admin endpoints live under `/api/admin/**` and all require the session [AUTH-03]:

| Method & path | Purpose |
|---|---|
| `GET/POST /api/admin/studies` | List (newest first) / create (201) |
| `GET/PATCH/DELETE /api/admin/studies/[id]` | Detail / partial update / delete (204) |
| `POST /api/admin/studies/[id]/status` | `{ status }` transition; publish problems in `details.problems` |
| `POST /api/admin/studies/[id]/duplicate` | Copy as draft (201) |
| `POST /api/admin/studies/[id]/cards` · `PATCH/DELETE …/cards/[cardId]` | Predefined cards (PATCH takes a full card body) |
| `POST …/cards/reorder` · `POST …/cards/bulk` | `{ ids }` exact permutation / `{ text }` paste |
| `POST …/groups` · `PATCH/DELETE …/groups/[groupId]` · `POST …/groups/reorder` | Predefined groups (closed/hybrid only) |
| `…/[id]/boards/**`, `…/[id]/export/**`, `…/[id]/analysis/**` | Results, CSV, analysis (streams H, I) |

Study config normalisation (service layer): `groupMode: "fixed"` is only valid for open sorts and
needs `fixedGroupCount` 1–30; changing sort type away from open resets the mode to `unbounded`;
`fixedGroupCount` is cleared unless open+fixed; `maxParticipantGroups` (1–100) is kept only for
open-unbounded and hybrid. Card/group ids of another study or of a board return 404. Stored settings
and participant fields are re-validated on read and fall back to defaults if invalid.

---

## 8. Auto-save and concurrency

Goal: every change is persisted immediately without the board ever feeling slow [SAVE-01/02].

1. The client holds board state in a reducer. A user action applies the op **optimistically** and
   enqueues it.
2. A single-flight queue sends ops **one at a time, in order**, each with the last known
   `revision`.
3. The server, in one SQLite transaction:
   - loads the board; rejects if `completed` or study not `live` (`409`) [DONE-04, PART-06];
   - checks `revision` matches (`409 stale` otherwise) [SAVE-03];
   - validates the op against the capabilities matrix and ownership (card/group belongs to this
     board/study) [SAVE-04];
   - applies it (re-indexing positions in the affected groups), increments `revision`, updates
     `last_activity_at` [SAVE-05];
   - returns `{ revision, lastActivityAt }`.
4. On network/5xx failure the client retries with exponential backoff and shows the status
   indicator. On `409 stale` it refetches the board, replaces local state and shows a notice.
   On `4xx` validation errors it rolls back to the server state.

Because a board belongs to one participant, conflicts only occur with multiple tabs; the
revision check makes that safe without locking.

Board service details (`src/server/services/boards*`):

- **Error precedence** for an op: unknown token `not_found` → `board_completed` →
  `study_not_live` → `stale_revision` (with `details.revision` = current) → per op: `forbidden`
  (capability), `not_found` (card/group not owned by this study/board), `conflict` (client id
  already used anywhere). Group/card limits (`maxParticipantGroups`, `LIMITS.maxParticipantCards`)
  are `forbidden`.
- **`moveCard.toIndex`** is the index in the target list *after* removing the card (dnd-kit
  `arrayMove` semantics), clamped. Moving to the tray ignores `toIndex`.
- **Tray order**: `board.cardOrder`, then predefined cards missing from it, then participant cards
  by creation (per-board `position`).
- **`addGroup` with `withCardId`** places that card first in the new group.
- **Completion** does not bump the revision; it's idempotent (a completed board returns its stored
  `completedAt` even if the study was closed since); a `422` carries `CompletionBlocker[]` as
  `details`.
- **`getPublicStudy`** returns any status so the intro page can show "not accepting responses";
  only unknown slugs are `404`.
- Participant API responses send `Cache-Control: no-store`.

---

## 9. Completion flow

```
[Complete card sort] ──(rules not met)──► disabled + tooltip explaining why   [DONE-01]
        │
        ▼
┌─ Modal ──────────────────────────────┐
│ Complete your card sort?             │  Cancel / Esc / backdrop → close     [DONE-02]
│ You won't be able to make changes.   │
│          [Cancel] [Yes, complete]    │
└──────────────────────────────────────┘
        │ Yes → wait for queued ops to flush → POST /complete
        ▼
┌─ Same modal, content swapped ────────┐
│ Thank you! Your responses have been  │                                       [DONE-03]
│ saved.                               │
└──────────────────────────────────────┘
board status = completed, board renders read-only (frozen)                    [DONE-04]
```

Completion rules (`requireAllSorted`, `requireGroupNames`, `allowEmptyGroups`) are implemented as
one pure function `getCompletionBlockers(boardState, settings) → string[]`, used by the client to
disable the button and by the server to reject [DONE-05].

---

## 10. Participant board UI

Matches the mockup:

```
┌──────────────┐
│ name, role,  │        Instructions: please add the cards to groups ...
│ organisation │                                     Saving… / All changes saved
└──────────────┘
   group 1        group 2        group 3        group 4       [+ New group]
 ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
 │  (3)     │  │          │  │          │  │          │
 │ ▢ card   │  │          │  │          │  │          │
 │ ▢ card   │  │          │  │          │  │          │
 └──────────┘  └──────────┘  └──────────┘  └──────────┘

 Unsorted cards (4 of 7 sorted)                         [+ Add card]
   ▢ card 1  ▢ card 2  ▢ card 3  ▢ card 4 ...

                                                 [Complete card sort]
```

- Cards are yellow sticky notes; participant-created cards have a subtle marker.
- Group columns wrap into rows when there are many; each column scrolls internally if tall.
- dnd-kit: one `SortableContext` per group plus the tray; `DragOverlay` for the dragged card;
  keyboard sensor enabled [BRD-03].
- Desktop only; below 1024 px a notice is shown [BRD-01].

---

## 11. Analysis

All analysis is computed on request from the database (fast enough at the target scale
[NFR-04]); no pre-aggregated tables. Inputs: the study's predefined cards and groups, and for each
included board the mapping `cardId → groupId | null`.

- **Similarity matrix** [ANL-01]: `S[a][b] = together(a,b) / bothSorted(a,b)` across boards,
  where *together* means placed in the same group (any kind). Displayed lower-triangular,
  heat-map coloured, with counts on hover.
- **Placement matrix** [ANL-02] (closed/hybrid): `P[card][group] = boardsPlacing / n`, with
  extra "Other (participant groups)" and "Unsorted" columns.
- **Dendrogram** [ANL-03]: agglomerative clustering, average linkage, distance `1 − S`.
  Deterministic tie-breaking (by card position) so results are stable and testable. The leaf
  order is reused to order the similarity matrix rows. Rendered as SVG; a cut-off slider
  highlights clusters.
- **Group names** [ANL-04]: normalise (trim, collapse whitespace, lowercase) participant group
  names, count boards per name, list top cards per name.
- **Participant cards** [ANL-05]: listed separately; excluded from matrices because each exists on
  only one board.

Implementation details (`src/server/analysis/`):

- **Clustering tie-breaking:** UPGMA on `d = 1 − ratio` (null → 1), symmetrised as
  `(d_ij + d_ji) / 2`. Each step merges the closest pair of active clusters; distances within
  `1e-9` are equal, and ties go to the lexicographically smallest
  `(min(minIndex A, minIndex B), max(minIndex A, minIndex B))`, where a cluster's `minIndex` is the
  smallest original position (in `cardIds`) among its cards. In a merged node the left child is
  the cluster with the smaller `minIndex`; `leafOrder` is the left-to-right leaf traversal. Merge
  distances are clamped to be ≥ their children's (monotone tree). Lance–Williams updates, O(n³).
- **Placement matrix:** a placement counts in a group column when its `groupId` is a predefined
  group; any other placement goes to "Other" in hybrid sorts and is ignored in closed sorts.
- **Group names:** only placements of predefined cards into participant/placeholder groups are
  counted (so groups holding no predefined cards don't appear); empty names are skipped; default
  placeholder names such as "Group 1" are currently included. `displayName` = most common trimmed
  spelling, counted once per (board, group); ties by character code. Stats sorted by `boardCount`
  desc, then normalised name.
- **Similarity diagonal:** `ratio[i][i]` = 1 if the card was ever sorted, else null.

Default input set: completed, non-excluded boards; optional toggle to include in-progress
boards. The UI always shows `n`.

---

## 12. Security

- Admin password stored only as a bcrypt hash in env (`ADMIN_PASSWORD_HASH`, always written with each
  `$` escaped as `\$` because Next.js expands `$…` in `.env` and in env vars `.env` also defines —
  the server unescapes it); session cookie is
  signed/encrypted with `SESSION_SECRET`, HTTP-only, `SameSite=Lax`, `Secure` in production
  [AUTH-01..04].
- Two auth layers: `src/proxy.ts` unseals the cookie itself (it can't import `server-only`
  modules) and redirects `/admin/**` to `/admin/login?next=…` / returns `401` for `/api/admin/**`
  (login and logout excepted); the `(protected)` layout and `requireAdmin()` check again.
  `?next=` only accepts same-origin `/admin` paths. Logout is `POST /api/admin/logout` → `303`.
- Login rate limiting [AUTH-05]: in-memory sliding window of failed attempts per client IP
  (`x-forwarded-for` → `x-real-ip` → `"unknown"`), 10 per 15 min; a successful login clears the
  counter; counters reset on restart. IP headers are only trustworthy behind the reverse proxy, so
  run the app behind Caddy/nginx that sets them.
- Participant access is capability-based: the board token *is* the credential; tokens have
  ≥ 128 bits of entropy; slugs are random too [PART-04, STU-11].
- All mutations validated server-side with zod and the capabilities matrix [SAVE-04, NFR-06].
- React escaping only; no `dangerouslySetInnerHTML` with user content [NFR-05].
- CSV export escapes cells and prefixes values starting with `= + - @` to avoid
  spreadsheet formula injection [RES-05].

---

## 13. Deployment (self-hosted)

- `npm ci && npm run build`, then `npm run db:migrate && npm run start` (port configurable).
- `npm run hash-password -- '<password>'` prints the `ADMIN_PASSWORD_HASH` line for `.env`.
- Env: `DATABASE_PATH` (e.g. `/var/lib/cardsort/cardsort.db`), `ADMIN_EMAIL`,
  `ADMIN_PASSWORD_HASH`, `SESSION_SECRET`, `PUBLIC_BASE_URL` (for share links).
- Run under systemd (or a Docker container with the DB directory as a volume) behind
  Caddy/nginx for TLS.
- Backups: `sqlite3 cardsort.db ".backup backup.db"` is safe while the app runs (WAL) [NFR-08].

---

## 14. Delivery phases

Functional phases are below. The executable build order — waves of parallel workstreams with
file ownership — is in [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md).

| Phase | Scope | Requirements |
|---|---|---|
| 1 | Scaffold: Next.js, Tailwind, Drizzle + SQLite, migrations, test setup, admin login | NFR-01/02/09, AUTH-* |
| 2 | Admin study editor: type, settings, cards, groups, participant fields, status, share link | STU-*, PERM-* (config), PFLD-01..03/05 |
| 3 | Participant entry + board with DnD and auto-save | PART-*, BRD-*, SAVE-* |
| 4 | Open/hybrid extras: groups and participant cards per permission matrix | PERM-01..04, BRD-05..07 |
| 5 | Completion modal + freeze | DONE-*, PERM-05..07 |
| 6 | Admin results: board list, read-only view, exclude/delete, CSV | RES-* |
| 7 | Analysis: similarity, placement, dendrogram, group names, participant cards | ANL-* |
| 8 | Polish: keyboard DnD, duplicate study, custom fields, auto-refresh | the "S" items |
