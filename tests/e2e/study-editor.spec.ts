// Stream G: admin study list + editor end to end.
import { expect, test, type Page } from "@playwright/test";
import { loginAsAdmin } from "./helpers";

const login = (page: Page) => loginAsAdmin(page);

/** The visible tab panel of the editor (hidden panels stay mounted). */
const panel = (page: Page) => page.getByRole("tabpanel");

const unique = () => Math.random().toString(36).slice(2, 8);

async function createStudy(page: Page, title: string, type: "Open" | "Closed" | "Hybrid") {
  await page.goto("/admin");
  await page.getByRole("link", { name: "New study" }).click();
  await expect(page).toHaveURL(/\/admin\/studies\/new$/);
  await page.getByLabel("Title").fill(title);
  await page.getByRole("radio", { name: type, exact: true }).check();
  await page.getByRole("button", { name: "Create study", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/studies\/[A-Za-z0-9_-]+$/);
  await expect(page.getByTestId("study-title")).toHaveText(title);
}

test.beforeEach(async ({ page }) => {
  await login(page);
});

test("STU-01 STU-02 STU-03 STU-07 STU-08 STU-09 STU-10 STU-11 PFLD-01 PFLD-03 PFLD-04 PERM-01 PERM-02: build, publish, lock, close and reopen a closed study", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const title = `Navigation ${unique()}`;
  await createStudy(page, title, "Closed");
  await expect(page.getByTestId("status-badge")).toHaveText("Draft");

  // STU-10 / STU-09: publishing an empty closed study is rejected with clear problems.
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByText("Add at least one card before publishing.")).toBeVisible();
  await expect(
    page.getByText("A closed sort needs at least one group before publishing."),
  ).toBeVisible();
  await expect(page.getByTestId("status-badge")).toHaveText("Draft");

  // STU-02: details.
  await panel(page).getByLabel("Participant instructions").fill("Sort the cards into the groups.");
  await panel(page).getByRole("button", { name: "Save details", exact: true }).click();
  await expect(page.getByText("Saved")).toBeVisible();

  // STU-07 / STU-08: cards.
  await page.getByRole("tab", { name: /Cards/ }).click();
  await panel(page).getByLabel("New card").fill("Billing");
  await panel(page)
    .getByLabel(/^Description/)
    .fill("Invoices and payments");
  await page.getByRole("button", { name: "Add card", exact: true }).click();
  await expect(page.getByTestId("card-label")).toHaveText(["Billing"]);
  await panel(page)
    .getByLabel("Cards to add, one per line")
    .fill("Profile\nbilling\n\nSecurity\nProfile");
  await page.getByRole("button", { name: "Add cards from list", exact: true }).click();
  await expect(page.getByText("Added 2 cards.")).toBeVisible();
  await expect(page.getByText("Skipped 2 duplicates: billing, Profile")).toBeVisible();
  await expect(page.getByTestId("card-label")).toHaveText(["Billing", "Profile", "Security"]);
  await page.getByRole("button", { name: "Edit Security", exact: true }).click();
  await panel(page).getByLabel("Label for Security").fill("Security settings");
  await panel(page).getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Move Security settings up", exact: true }).click();
  await expect(page.getByTestId("card-label")).toHaveText([
    "Billing",
    "Security settings",
    "Profile",
  ]);
  await expect(page.getByTestId("card-count")).toHaveText("3 / 200");

  // STU-09: groups; "open" is disabled while predefined groups exist.
  await page.getByRole("tab", { name: /Sort type/ }).click();
  await panel(page).getByLabel("New group").fill("Account");
  await page.getByRole("button", { name: "Add group", exact: true }).click();
  await expect(page.getByTestId("group-name")).toHaveText(["Account"]);
  await panel(page).getByLabel("New group").fill("Help");
  await page.getByRole("button", { name: "Add group", exact: true }).click();
  await page.getByRole("button", { name: "Rename Help", exact: true }).click();
  await panel(page).getByLabel("Name for Help").fill("Support");
  await panel(page).getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByTestId("group-name")).toHaveText(["Account", "Support"]);
  await page.getByRole("button", { name: "Move Support up", exact: true }).click();
  await expect(page.getByTestId("group-name")).toHaveText(["Support", "Account"]);
  await expect(page.getByRole("radio", { name: "Open", exact: true })).toBeDisabled();

  // PFLD-01/03/04: participant fields.
  await page.getByRole("tab", { name: "Participant fields" }).click();
  await panel(page).getByLabel("Email", { exact: true }).selectOption("required");
  await expect(page.getByTestId("field-order-item")).toHaveCount(2);
  await panel(page).getByLabel("Question", { exact: true }).fill("Which tool do you use most?");
  await page.getByRole("button", { name: "Add question", exact: true }).click();
  await expect(page.getByTestId("field-order-item")).toHaveCount(3);
  await page
    .getByRole("button", { name: "Move Which tool do you use most? up", exact: true })
    .click();
  await expect(page.getByTestId("field-order-item").nth(1)).toContainText(
    "Which tool do you use most?",
  );

  // PERM: settings, with irrelevant ones hidden for a closed sort.
  await page.getByRole("tab", { name: "Settings" }).click();
  await expect(panel(page).getByLabel("Participants may rename groups")).toHaveCount(0);
  await expect(
    panel(page).getByLabel("Participants may edit or delete cards they created"),
  ).toHaveCount(0);
  await panel(page).getByLabel("Participants may add their own cards").check();
  await expect(
    panel(page).getByLabel("Participants may edit or delete cards they created"),
  ).toBeVisible();

  // STU-03 / STU-11: publish, share link.
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByTestId("status-badge")).toHaveText("Live");
  const link = page.getByLabel("Participant link");
  await expect(link).toHaveValue(/^http:\/\/localhost:\d+\/s\/[a-z0-9]+$/);
  await page.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(page.getByText(/Copied|Press Ctrl\+C/)).toBeVisible();
  await expect(page.getByText("This study is live.")).toBeVisible();

  // Everything persisted and config is locked after a reload.
  await page.reload();
  await expect(page.getByTestId("status-badge")).toHaveText("Live");
  await expect(panel(page).getByLabel("Participant instructions")).toHaveValue(
    "Sort the cards into the groups.",
  );
  await page.getByRole("tab", { name: "Settings" }).click();
  await expect(panel(page).getByLabel("Participants may add their own cards")).toBeChecked();
  await expect(panel(page).getByLabel("Participants may add their own cards")).toBeDisabled();
  await page.getByRole("tab", { name: "Participant fields" }).click();
  await expect(panel(page).getByLabel("Email", { exact: true })).toHaveValue("required");
  await expect(panel(page).getByLabel("Email", { exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Add question", exact: true })).toHaveCount(0);
  await page.getByRole("tab", { name: /Cards/ }).click();
  await expect(page.getByTestId("card-label")).toHaveText([
    "Billing",
    "Security settings",
    "Profile",
  ]);
  await expect(page.getByRole("button", { name: "Add card", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit Billing", exact: true })).toHaveCount(0);
  await page.getByRole("tab", { name: /Sort type/ }).click();
  await expect(page.getByRole("radio", { name: "Hybrid", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Add group", exact: true })).toHaveCount(0);
  // Details stay editable (STU-03).
  await page.getByRole("tab", { name: "Details" }).click();
  await panel(page).getByLabel("Title").fill(`${title} (live)`);
  await panel(page).getByRole("button", { name: "Save details", exact: true }).click();
  await expect(page.getByTestId("study-title")).toHaveText(`${title} (live)`);

  // Close (with confirmation) and reopen.
  await page.getByRole("button", { name: "Close study", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Close this study?");
  await page.getByRole("dialog").getByRole("button", { name: "Close study", exact: true }).click();
  await expect(page.getByTestId("status-badge")).toHaveText("Closed");
  await expect(page.getByLabel("Participant link")).toBeVisible();
  await page.getByRole("button", { name: "Reopen", exact: true }).click();
  await expect(page.getByTestId("status-badge")).toHaveText("Live");

  // Links to the results pages built by other streams.
  await expect(page.getByRole("link", { name: "Boards" })).toHaveAttribute("href", /\/boards$/);
  await expect(page.getByRole("link", { name: "Analysis" })).toHaveAttribute("href", /\/analysis$/);
});

test("STU-01 STU-12: list, duplicate and delete studies", async ({ page }) => {
  const title = `Duplicate me ${unique()}`;
  await createStudy(page, title, "Hybrid");
  await page.getByRole("tab", { name: /Cards/ }).click();
  await panel(page).getByLabel("New card").fill("Alpha");
  await page.getByRole("button", { name: "Add card", exact: true }).click();
  await expect(page.getByTestId("card-label")).toHaveText(["Alpha"]);

  await page.goto("/admin");
  const rowFor = (t: string) =>
    page.getByTestId("study-row").filter({ has: page.getByRole("link", { name: t, exact: true }) });
  const row = rowFor(title);
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Hybrid");
  await expect(row).toContainText("Draft");

  await row.getByRole("button", { name: `Duplicate ${title}`, exact: true }).click();
  await expect(page.getByText("Created a draft copy:")).toBeVisible();
  const copyRow = rowFor(`Copy of ${title}`);
  await expect(copyRow).toHaveCount(1);

  // The copy has the same cards and is a draft.
  await copyRow.getByRole("link", { name: `Open Copy of ${title}` }).click();
  await expect(page.getByTestId("study-title")).toHaveText(`Copy of ${title}`);
  await expect(page.getByTestId("status-badge")).toHaveText("Draft");
  await page.getByRole("tab", { name: /Cards/ }).click();
  await expect(page.getByTestId("card-label")).toHaveText(["Alpha"]);

  // Delete asks for confirmation.
  await page.goto("/admin");
  await copyRow.getByRole("button", { name: `Delete Copy of ${title}`, exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("This cannot be undone");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(copyRow).toHaveCount(1);
  await copyRow.getByRole("button", { name: `Delete Copy of ${title}`, exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete study", exact: true }).click();
  await expect(copyRow).toHaveCount(0);
  await expect(rowFor(title)).toHaveCount(1);
});

test("STU-05 STU-06: create an open study with a fixed number of groups", async ({ page }) => {
  await page.goto("/admin/studies/new");
  await page.getByLabel("Title").fill(`Open fixed ${unique()}`);
  await page.getByRole("radio", { name: "Open", exact: true }).check();
  await page.getByRole("radio", { name: "A fixed number of groups" }).check();
  await page.getByRole("spinbutton", { name: "Number of groups" }).fill("31");
  await page.getByRole("button", { name: "Create study", exact: true }).click();
  await expect(page.getByText("Enter a whole number from 1 to 30")).toBeVisible();
  await page.getByRole("spinbutton", { name: "Number of groups" }).fill("5");
  await page.getByRole("button", { name: "Create study", exact: true }).click();
  await expect(page.getByText("Open sort · 5 fixed groups")).toBeVisible();

  // Switch to unbounded with a group limit (STU-06).
  await page.getByRole("tab", { name: /Sort type/ }).click();
  await panel(page)
    .getByRole("radio", { name: "Participants add as many groups as they need" })
    .check();
  await panel(page).getByLabel("Limit how many groups each participant can add").check();
  await panel(page).getByLabel("Maximum groups per participant").fill("8");
  await panel(page).getByRole("button", { name: "Save sort type", exact: true }).click();
  await expect(page.getByText("Open sort · participants add groups")).toBeVisible();
  await page.reload();
  await page.getByRole("tab", { name: /Sort type/ }).click();
  await expect(panel(page).getByLabel("Maximum groups per participant")).toHaveValue("8");
  // Group deletion applies to open-unbounded sorts.
  await page.getByRole("tab", { name: "Settings" }).click();
  await expect(panel(page).getByLabel("Participants may delete groups")).toBeVisible();
});
