# Requirements

This document is the source of truth for **what the app must do** and for deciding
whether a feature is **done**. Every requirement has a stable ID (e.g. `STU-03`).

- Tests should reference the IDs they cover, e.g. `it("STU-03: rejects edits to a live study", ...)`.
- A requirement is **done** when: it is implemented, every acceptance criterion holds, and
  at least one automated test (unit, integration or e2e) referencing its ID passes.
- Do not renumber or reuse IDs. If a requirement is dropped, mark it `~~struck~~` with a note.
- Priority uses MoSCoW: **M** = must (v1), **S** = should (v1 if time allows), **C** = could (later).

See [`DESIGN.md`](./DESIGN.md) for how these are implemented.

---

## Glossary

| Term | Meaning |
|---|---|
| **Study** | One card sort configured by the admin (cards, groups, settings, participant fields). |
| **Board** | One participant's attempt at a study. A study has many boards. |
| **Card** | An item to be sorted. Either *predefined* (by admin) or *participant-created*. |
| **Group** | A container cards are sorted into. Either *predefined* (by admin) or *participant-created*. |
| **Unsorted tray** | Area holding cards not yet placed in any group. |
| **Open / Closed / Hybrid** | Sort types — see `STU-04`. |
| **Frozen** | A completed board; it can never be modified again. |

---

## 1. Admin authentication (`AUTH`)

| ID | P | Requirement | Acceptance criteria |
|---|---|---|---|
| AUTH-01 | M | There is exactly one admin account, configured on the server. | Credentials come from environment config (email + password hash). No sign-up page exists. |
| AUTH-02 | M | The admin logs in with email and password. | Correct credentials create a session (HTTP-only, secure-in-prod, signed cookie). Wrong credentials show a generic error and create no session. |
| AUTH-03 | M | All admin pages and admin API endpoints require a valid admin session. | Unauthenticated requests to `/admin/**` redirect to the login page; to `/api/admin/**` return `401`. |
| AUTH-04 | M | The admin can log out. | Logging out invalidates the session cookie; admin pages then redirect to login. |
| AUTH-05 | S | Login attempts are rate-limited. | More than 10 failed attempts per IP in 15 minutes are rejected with `429`. |

## 2. Study management (`STU`)

| ID | P | Requirement | Acceptance criteria |
|---|---|---|---|
| STU-01 | M | The admin can create, list, view, edit and delete studies. | Study list shows title, type, status, number of boards (in-progress / completed), created date. Deleting asks for confirmation and removes all its boards. |
| STU-02 | M | A study has a title, an optional description (admin-only notes), and participant-facing instructions text. | Instructions are shown at the top of the participant board (as in the mockup). |
| STU-03 | M | A study has a status: `draft`, `live`, or `closed`. | Only `live` studies accept new participants or board changes. Cards, groups, sort type and participant fields can only be edited while `draft`; attempts otherwise are rejected server-side. Title, description and instructions remain editable. Sending a locked field with its *unchanged* value is allowed (so forms can save whole); any real change to a locked field rejects the whole request. The admin can move `draft → live`, `live → closed`, `closed → live`; any other transition (including to the same status) is rejected. |
| STU-04 | M | The admin chooses a sort type: **open**, **closed** or **hybrid**. | *Closed*: groups are predefined by the admin only. *Open*: groups are created/named by participants only. *Hybrid*: predefined groups exist and participants may add more. Switching a study to *open* while it still has predefined groups is rejected; the admin must remove them first. |
| STU-05 | M | For open sorts, the admin chooses the group mode: **fixed** number N of groups, or **unbounded**. | *Fixed*: each new board starts with exactly N empty groups (default names "Group 1"…"Group N"); participants cannot add or delete groups. *Unbounded*: board starts with no groups; participants add groups as needed. N must be between 1 and 30. |
| STU-06 | S | For unbounded open sorts and hybrid sorts, the admin can optionally set a maximum number of participant-created groups. | The "add group" action is disabled once the limit is reached; the server rejects extra groups. |
| STU-07 | M | The admin can add, edit, reorder and remove predefined cards (while `draft`). | Each card has a label (required, ≤ 200 chars, unique within study, case-insensitive) and an optional description (≤ 1000 chars). |
| STU-08 | M | The admin can bulk-add cards by pasting text, one card per line. | Blank lines are ignored; duplicate labels (vs existing cards and within the paste) are reported and skipped. If any line exceeds the label limit, or the paste would exceed the card limit, nothing is added and the offending lines / limit are reported. |
| STU-09 | M | For closed and hybrid sorts, the admin can add, rename, reorder and remove predefined groups (while `draft`). | Group names are required, ≤ 100 chars, unique within study. A closed or hybrid study cannot go `live` with zero groups. |
| STU-10 | M | A study cannot go live with zero cards. | Publishing is rejected with a clear message. |
| STU-11 | M | Each live study has a shareable participant link. | The admin can copy the link from the study page. The link uses an unguessable slug and does not expose internal IDs. |
| STU-12 | S | The admin can duplicate a study. | The copy is a new `draft` with the same settings, cards, groups and participant fields, and no boards. |
| STU-13 | C | The admin can add an image to a card. | — |

## 3. Participant permissions — per-study settings (`PERM`)

The admin configures these per study. Settings that don't apply to the chosen sort type / group
mode are hidden in the UI and ignored by the server (see the matrix in DESIGN.md §5).

| ID | P | Setting | Acceptance criteria |
|---|---|---|---|
| PERM-01 | M | **Participants may add their own cards** (default off). | When on, the board shows an "Add card" control. New cards start in the unsorted tray, are visible only on that participant's board, and are marked as participant-created. When off, the server rejects card creation. |
| PERM-02 | M | **Participants may edit/delete cards they created** (default on; only when PERM-01 is on). | Predefined cards can never be edited or deleted by participants. |
| PERM-03 | M | **Participants may rename groups** (default on). | Applies to participant-created groups and to the placeholder groups of fixed-mode open sorts. Predefined groups (closed/hybrid) can never be renamed by participants. |
| PERM-04 | M | **Participants may delete groups** (default on). | Applies to participant-created groups only (not fixed-mode placeholders, not predefined). Deleting a group moves its cards back to the unsorted tray (with a confirmation if the group is non-empty). |
| PERM-05 | M | **All cards must be sorted before completing** (default off). | When on, "Complete" is disabled while any card (predefined or participant-created) is in the unsorted tray, and the server rejects completion. |
| PERM-06 | M | **Groups must be named before completing** (default on; open/hybrid only). | When on, completion is blocked while any non-empty participant group has an empty or default name. |
| PERM-07 | S | **Empty groups are allowed on completion** (default on). | When off, completion is blocked while any participant-created or placeholder group is empty. Predefined groups may always be empty. |
| PERM-08 | M | **Randomise card order** (default on). | When on, each board's unsorted tray order is shuffled once at board creation and then stays stable for that board. When off, the admin's order is used. |
| PERM-09 | S | **Show card descriptions** (default on). | When on, cards with a description show it on hover/focus. |

## 4. Participant information fields (`PFLD`)

| ID | P | Requirement | Acceptance criteria |
|---|---|---|---|
| PFLD-01 | M | The admin selects which participant details to collect from a built-in catalogue. | Catalogue: name, email, organisation, role / job title, seniority, age range, gender, country, nationality. Each field can be set to *off*, *optional* or *required*. Default: name = required, everything else off. |
| PFLD-02 | M | Fields use appropriate input types and validation. | name/organisation/role: text ≤ 200 chars · email: valid email · seniority: select (Intern/Student, Junior, Mid-level, Senior, Lead/Principal, Manager, Director, Executive, Other) · age range: select (Under 18, 18–24, 25–34, 35–44, 45–54, 55–64, 65+, Prefer not to say) · gender: select (Woman, Man, Non-binary, Prefer to self-describe [free text], Prefer not to say) · country & nationality: select from ISO 3166 country list. Validation is enforced on the server too. |
| PFLD-03 | M | The admin can reorder the enabled fields. | The participant form shows fields in that order. |
| PFLD-04 | S | The admin can add custom free-text questions. | Each has a label, optional/required, ≤ 500-char answers. |
| PFLD-05 | M | If no fields are enabled, the participant skips the details form. | The intro page goes straight to the board. |

## 5. Participant entry and board lifecycle (`PART`)

| ID | P | Requirement | Acceptance criteria |
|---|---|---|---|
| PART-01 | M | Opening the study link shows an intro page with the study title and a "Start" action, followed by the details form (if any fields are enabled). | If the study is `draft` or `closed`, a friendly "This study is not currently accepting responses" page is shown instead. |
| PART-02 | M | Submitting the details form creates a new board and redirects to the board's unique URL. | The board URL contains an unguessable token (≥ 128 bits of randomness). Participant answers are stored on the board. |
| PART-03 | M | A participant can resume an in-progress board. | Revisiting the board URL restores the exact state. Revisiting the study link from the same browser offers "Continue where you left off" (token kept in local storage) and "Start a new sort". |
| PART-04 | M | Boards cannot be accessed without their token. | Requests with an unknown token return `404`. One board's token gives no access to any other board. |
| PART-05 | M | Opening a completed board shows it read-only with a "You have completed this card sort — thank you" message. | No drag, add, rename or delete controls are active. |
| PART-06 | M | If a study is closed while a board is in progress, that board becomes read-only. | The server rejects changes; the board shows a "This study has been closed" message. Reopening the study (`closed → live`) makes it editable again. |

## 6. Board interaction (`BRD`)

| ID | P | Requirement | Acceptance criteria |
|---|---|---|---|
| BRD-01 | M | The board layout matches the mockup. | Top: participant details summary (sticky-note style, top-left) and the instructions text. Middle: group columns in a row (wrapping or horizontal scroll if many). Bottom: unsorted tray of cards. Desktop only (min. width 1024 px); smaller screens show a "please use a larger screen" notice. |
| BRD-02 | M | Participants drag cards from the tray into groups, between groups, within a group (reorder), and back to the tray. | Drop targets are highlighted while dragging. Works with mouse. |
| BRD-03 | S | Drag-and-drop is keyboard-accessible. | A card can be picked up, moved and dropped with the keyboard; screen readers get live announcements. |
| BRD-04 | M | Each group shows its name and card count. | — |
| BRD-05 | M | In open-unbounded and hybrid sorts, participants can add a group (subject to STU-06). | A new group appears with focus on its name input. |
| BRD-06 | M | Participants can add, rename and delete groups and cards according to the study's PERM settings. | Controls not permitted are not shown; the server rejects them regardless. |
| BRD-07 | S | Dropping a card onto a "New group" drop zone creates a group containing that card (open-unbounded / hybrid). | — |
| BRD-08 | M | A progress indicator shows "X of Y cards sorted". | Y includes participant-created cards. |

## 7. Auto-save (`SAVE`)

| ID | P | Requirement | Acceptance criteria |
|---|---|---|---|
| SAVE-01 | M | Every change to a board (card moved, group added/renamed/deleted, card added/edited/deleted) is saved to the server immediately. | After any single change, reloading the page shows that change. No "Save" button exists. |
| SAVE-02 | M | The UI updates optimistically and shows save status. | Indicator shows "Saving…", then "All changes saved"; on failure "Couldn't save — retrying" with automatic retry (exponential backoff) and a manual "Retry" button. |
| SAVE-03 | M | Concurrent edits (same board open in two tabs) cannot corrupt the board. | Each change carries the board's revision number; a stale revision is rejected with `409`, and the client reloads the latest state and notifies the user. |
| SAVE-04 | M | The server validates every change. | Unknown card/group IDs, cards/groups from another board or study, and operations not permitted by PERM settings are rejected with `4xx` and leave the board unchanged. |
| SAVE-05 | M | The board's "last activity" time is updated on every saved change. | Visible in the admin board list. |

## 8. Completion (`DONE`)

| ID | P | Requirement | Acceptance criteria |
|---|---|---|---|
| DONE-01 | M | The board has a "Complete card sort" button. | Disabled (with an explanation on hover) while completion rules (PERM-05/06/07) are not satisfied. |
| DONE-02 | M | Clicking it opens a modal confirmation dialog. | The dialog asks for confirmation, states the sort can't be changed afterwards, and has "Yes, complete" and "Cancel". Cancel closes the dialog with no change. Escape and backdrop click count as cancel. |
| DONE-03 | M | Confirming completes the board and shows a "Thank you" note **in the same modal**. | The modal content changes to a thank-you message; the modal does not close and reopen. |
| DONE-04 | M | A completed board is frozen. | Status becomes `completed` with a completion timestamp. The server rejects every subsequent change to the board (`409`) regardless of client. Completion is idempotent. |
| DONE-05 | M | The server re-checks completion rules. | Completion that violates PERM-05/06/07 is rejected with `422` and an explanation. |

## 9. Admin results — boards (`RES`)

| ID | P | Requirement | Acceptance criteria |
|---|---|---|---|
| RES-01 | M | For each study, the admin sees a list of all boards. | Columns: participant details (enabled fields), status (in progress / completed), started, last activity, completed at, cards sorted (X / Y). Filter by status; sort by any date column. |
| RES-02 | M | The admin can open any board in a read-only view. | Shows the board as the participant sees/saw it, including participant-created groups and cards (clearly marked). |
| RES-03 | M | The admin can exclude a board from analysis (e.g. a test run) and re-include it. | Excluded boards are greyed out in the list and ignored by all analysis (ANL). |
| RES-04 | M | The admin can delete a board. | Requires confirmation; removes the board and its placements. |
| RES-05 | M | The admin can export results as CSV. | One row per board × card: board id, status, participant fields, card label, card origin (predefined / participant), group name, group origin, position. Plus a separate participants CSV (one row per board). |
| RES-06 | S | The board list refreshes automatically. | Polls every 15 s while the page is open. |

## 10. Analysis (`ANL`)

Unless stated otherwise, analysis uses **completed, non-excluded** boards. A toggle lets the admin
also include in-progress boards. All matrices show the number of boards used (`n`).

| ID | P | Requirement | Acceptance criteria |
|---|---|---|---|
| ANL-01 | M | **Similarity matrix** for all sort types. | For each pair of predefined cards (A, B): percentage of boards in which A and B were placed in the same group, out of boards in which both were sorted. Displayed as a lower-triangular heat-map; hovering a cell shows the exact count and %. Cards ordered by the dendrogram clustering (ANL-03). |
| ANL-02 | M | **Placement matrix** for closed and hybrid sorts. | Rows: predefined cards. Columns: predefined groups + "Other (participant groups)" (hybrid only) + "Unsorted". Each cell: % of boards placing that card there. Heat-map, with the top group for each card highlighted. |
| ANL-03 | M | **Dendrogram** for all sort types. | Average-linkage hierarchical clustering with distance = 1 − similarity. Rendered as SVG next to the card labels; the admin can see clusters at a chosen cut-off (slider). |
| ANL-04 | M | **Group names overview** for open and hybrid sorts. | Lists all participant-created group names (case-insensitive and whitespace-normalised grouping), how many boards used each name, and which cards were most often placed in groups of that name. |
| ANL-05 | M | **Participant-created cards overview** (when PERM-01 is on). | Lists every participant-created card label with its board and the group it was placed in. Participant-created cards are excluded from the matrices. |
| ANL-06 | M | Analysis computations are correct. | Unit tests cover the similarity, placement and clustering functions against hand-computed fixtures, including edge cases: zero boards, one board, cards never sorted, ties. |
| ANL-07 | S | Matrices can be exported as CSV. | — |
| ANL-08 | C | The admin can merge ("standardise") participant group names. | — |
| ANL-09 | C | Filter analysis by participant field (e.g. only seniority = Senior). | — |

## 11. Non-functional (`NFR`)

| ID | P | Requirement | Acceptance criteria |
|---|---|---|---|
| NFR-01 | M | Self-hostable on a single server with SQLite as the only database, in both development and production. | One `npm` build + start; no other services required. The database is a single file at a configurable path. |
| NFR-02 | M | Database migrations are versioned and applied with one command. | `npm run db:migrate` brings an empty or older database up to date. |
| NFR-03 | M | A move is saved within 500 ms server-side for a board with 100 cards. | Measured by an integration test. |
| NFR-04 | M | Studies support up to 200 cards, 30 predefined groups and 1 000 boards with analysis pages loading in under 3 s. | — |
| NFR-05 | M | All user-supplied text is safely escaped when rendered. | No raw HTML rendering of user input. |
| NFR-06 | M | Server-side input validation on every endpoint, with length limits as specified above. | Shared validation schemas between client and server. |
| NFR-07 | M | Supported browsers: latest Chrome, Firefox, Safari and Edge on desktop. | — |
| NFR-08 | S | Database backup is documented. | AGENTS.md/README describes a safe online backup command. |
| NFR-09 | M | The codebase has automated tests: unit, integration and end-to-end. | `npm test` and `npm run test:e2e` pass in CI / locally before a requirement is considered done. |
