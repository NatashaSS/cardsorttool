// Shared helpers for the cross-cutting journeys (stream J). Browser-agnostic: only mouse,
// keyboard and role/test-id locators, no Chromium-only APIs or permissions.
import {
  expect,
  type APIRequestContext,
  type Browser,
  type Locator,
  type Page,
} from "@playwright/test";
import type { BoardStateDTO, StudyDetailDTO } from "../../src/lib/api-types";
import type { StudySettings } from "../../src/lib/schemas";
import type { GroupMode, SortType } from "../../src/lib/types";

export const unique = () => Math.random().toString(36).slice(2, 8);

export const card = (page: Page, label: string) =>
  page.getByRole("button", { name: label, exact: true });
export const group = (page: Page, name: string) =>
  page.getByRole("region", { name: `Group ${name}`, exact: true });
export const tray = (page: Page) => page.getByTestId("tray");
export const completeButton = (page: Page) =>
  page.getByRole("button", { name: "Complete card sort" });
export const saved = (page: Page) =>
  expect(page.getByTestId("save-status")).toHaveText(/All changes saved/);

/** A card (by label) inside a container. Read-only cards aren't buttons. */
export function within(container: Locator, label: string, readOnly = false): Locator {
  return readOnly
    ? container.locator("[data-card-id]", { hasText: label })
    : container.getByRole("button", { name: label, exact: true });
}

export async function hydrated(page: Page) {
  await expect(page.getByTestId("board")).toHaveAttribute("data-hydrated", "true");
}

/** dnd-kit's pointer sensor needs intermediate moves to activate and track the drag. */
export async function drag(page: Page, source: Locator, target: Locator) {
  const s = await source.boundingBox();
  const t = await target.boundingBox();
  if (!s || !t) throw new Error("drag: element not visible");
  const [sx, sy] = [s.x + s.width / 2, s.y + s.height / 2];
  const [tx, ty] = [t.x + t.width / 2, t.y + Math.min(t.height / 2, 60)];
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 12, sy + 12, { steps: 4 });
  await page.mouse.move(tx, ty, { steps: 16 });
  await page.mouse.move(tx + 2, ty + 2, { steps: 2 });
  await page.mouse.up();
}

/** Drag, then wait until the move is visible in the target container and saved. */
export async function sortInto(page: Page, label: string, target: Locator) {
  await drag(page, card(page, label), target);
  await expect(within(target, label)).toBeVisible();
  await saved(page);
}

export type StudySpec = {
  title?: string;
  sortType: SortType;
  groupMode?: GroupMode;
  fixedGroupCount?: number | null;
  maxParticipantGroups?: number | null;
  cards: string[];
  groups?: string[];
  settings?: Partial<StudySettings>;
};

/** Build and publish a study through the admin API (the request context must be logged in). */
export async function createLiveStudy(api: APIRequestContext, spec: StudySpec) {
  const created = await api.post("/api/admin/studies", {
    data: {
      title: spec.title ?? `Journey ${spec.sortType} ${unique()}`,
      sortType: spec.sortType,
      groupMode: spec.groupMode ?? "unbounded",
      fixedGroupCount: spec.fixedGroupCount ?? null,
    },
  });
  expect(created.status()).toBe(201);
  const study = (await created.json()) as StudyDetailDTO;
  const bulk = await api.post(`/api/admin/studies/${study.id}/cards/bulk`, {
    data: { text: spec.cards.join("\n") },
  });
  expect(bulk.ok()).toBe(true);
  for (const name of spec.groups ?? []) {
    const res = await api.post(`/api/admin/studies/${study.id}/groups`, { data: { name } });
    expect(res.ok()).toBe(true);
  }
  const patched = await api.patch(`/api/admin/studies/${study.id}`, {
    data: {
      settings: { ...study.settings, ...spec.settings },
      ...(spec.maxParticipantGroups !== undefined
        ? { maxParticipantGroups: spec.maxParticipantGroups }
        : {}),
    },
  });
  expect(patched.ok(), await patched.text()).toBe(true);
  const published = await api.post(`/api/admin/studies/${study.id}/status`, {
    data: { status: "live" },
  });
  expect(published.ok(), await published.text()).toBe(true);
  return (await published.json()) as StudyDetailDTO;
}

export async function setStudyStatus(
  api: APIRequestContext,
  studyId: string,
  status: "live" | "closed",
) {
  const res = await api.post(`/api/admin/studies/${studyId}/status`, { data: { status } });
  expect(res.ok(), await res.text()).toBe(true);
}

/**
 * A participant in their own browser context (no admin cookie) opens the share link, enters
 * their name and lands on a hydrated board.
 */
export async function joinStudy(browser: Browser, shareUrl: string, name: string) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(new URL(shareUrl).pathname);
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: "Start sorting" }).click();
  await expect(page).toHaveURL(/\/s\/[a-z0-9]+\/b\/[A-Za-z0-9_-]+$/);
  await hydrated(page);
  await expect(page.getByTestId("participant-note")).toContainText(name);
  const token = new URL(page.url()).pathname.split("/").pop()!;
  return { context, page, token };
}

export async function boardState(page: Page, token: string): Promise<BoardStateDTO> {
  const res = await page.request.get(`/api/boards/${token}`);
  expect(res.ok()).toBe(true);
  return (await res.json()) as BoardStateDTO;
}

/** Send one raw board op with the board's current revision (bypassing the UI). */
export async function rawOp(page: Page, token: string, op: Record<string, unknown>) {
  const state = await boardState(page, token);
  return page.request.post(`/api/boards/${token}/ops`, {
    data: { revision: state.board.revision, op },
  });
}

/** DONE-02/03: confirm in the modal and see the thank-you in the same dialog. */
export async function completeSort(page: Page) {
  await expect(completeButton(page)).toBeEnabled();
  await completeButton(page).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Complete your card sort?" })).toBeVisible();
  await dialog.getByRole("button", { name: "Yes, complete" }).click();
  await expect(dialog.getByRole("heading", { name: "Thank you!" })).toBeVisible();
  await expect(page.getByTestId("readonly-banner")).toHaveText(
    "You have completed this card sort — thank you.",
  );
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toHaveCount(0);
}

export const boardRow = (page: Page, participant: string) =>
  page.getByTestId("board-row").filter({ hasText: participant });

/**
 * Admin side after a participant completed: the board list shows it completed (RES-01), the
 * read-only view renders it (RES-02) and the analysis page counts it (ANL-01).
 * `expectGroups` maps group name → card labels expected in it on the read-only view.
 */
export async function checkAdminSide(
  page: Page,
  studyId: string,
  participant: string,
  opts: { expectGroups: Record<string, string[]>; sorted: string; n: number },
) {
  await page.goto(`/admin/studies/${studyId}/boards`);
  await expect(page.getByTestId("boards-table")).toBeVisible();
  const row = boardRow(page, participant);
  await expect(row.getByTestId("board-status")).toHaveText("Completed");
  await expect(row.getByTestId("sorted-count")).toHaveText(opts.sorted);

  await row.getByRole("link", { name: `View board of ${participant}` }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/studies/${studyId}/boards/[A-Za-z0-9_-]+$`));
  await hydrated(page);
  for (const [name, labels] of Object.entries(opts.expectGroups)) {
    const g = group(page, name);
    await expect(g).toBeVisible();
    for (const label of labels) await expect(within(g, label, true)).toBeVisible();
  }
  await expect(page.locator('[aria-roledescription="sortable"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Complete card sort/ })).toHaveCount(0);

  await page.goto(`/admin/studies/${studyId}/analysis`);
  await expect(page.getByTestId("analysis-n")).toHaveText(String(opts.n));
  await expect(page.getByTestId("similarity-matrix")).toBeVisible();
}
