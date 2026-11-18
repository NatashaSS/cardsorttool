// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { AdminApiError, adminApi, errorDetailLines } from "@/components/admin/study-editor/api";
import { SettingsSection } from "@/components/admin/study-editor/SettingsSection";
import { StatusBar } from "@/components/admin/study-editor/StatusBar";
import type { StudyDetailDTO } from "@/lib/api-types";
import { DEFAULT_PARTICIPANT_FIELDS, DEFAULT_SETTINGS } from "@/lib/schemas";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

function study(overrides: Partial<StudyDetailDTO> = {}): StudyDetailDTO {
  return {
    id: "study_1234",
    slug: "abcdefghijkl",
    shareUrl: "http://localhost:3000/s/abcdefghijkl",
    title: "Navigation study",
    description: "",
    instructions: "",
    status: "draft",
    sortType: "closed",
    groupMode: "unbounded",
    fixedGroupCount: null,
    maxParticipantGroups: null,
    settings: { ...DEFAULT_SETTINGS },
    participantFields: DEFAULT_PARTICIPANT_FIELDS,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    cards: [],
    groups: [],
    boardCounts: { inProgress: 0, completed: 0 },
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function Harness({
  initial,
  locked,
  Component,
}: {
  initial: StudyDetailDTO;
  locked?: boolean;
  Component: typeof SettingsSection;
}) {
  const [s, setS] = useState(initial);
  return <Component study={s} locked={locked ?? s.status !== "draft"} onStudyChange={setS} />;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SettingsSection", () => {
  it("PERM-03 PERM-04 PERM-06: closed sorts hide group settings that don't apply", () => {
    render(<Harness initial={study({ sortType: "closed" })} Component={SettingsSection} />);
    expect(screen.getByLabelText("Participants may add their own cards")).toBeTruthy();
    expect(screen.queryByLabelText("Participants may rename groups")).toBeNull();
    expect(screen.queryByLabelText("Participants may delete groups")).toBeNull();
    expect(screen.queryByLabelText("Groups must be named before completing")).toBeNull();
  });

  it("PERM-04: open fixed sorts hide group deletion; hybrid shows it", () => {
    render(
      <Harness
        initial={study({ sortType: "open", groupMode: "fixed", fixedGroupCount: 3 })}
        Component={SettingsSection}
      />,
    );
    expect(screen.getByLabelText("Participants may rename groups")).toBeTruthy();
    expect(screen.queryByLabelText("Participants may delete groups")).toBeNull();
    cleanup();
    render(<Harness initial={study({ sortType: "hybrid" })} Component={SettingsSection} />);
    expect(screen.getByLabelText("Participants may delete groups")).toBeTruthy();
  });

  it("PERM-01 PERM-02: toggling a setting saves the whole settings object and reveals dependent settings", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      return jsonResponse(study({ settings: body.settings }));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<Harness initial={study()} Component={SettingsSection} />);
    expect(
      screen.queryByLabelText("Participants may edit or delete cards they created"),
    ).toBeNull();
    fireEvent.click(screen.getByLabelText("Participants may add their own cards"));
    await waitFor(() =>
      expect(
        screen.getByLabelText("Participants may edit or delete cards they created"),
      ).toBeTruthy(),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/studies/study_1234",
      expect.objectContaining({ method: "PATCH" }),
    );
    const sent = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(sent).toEqual({ settings: { ...DEFAULT_SETTINGS, allowParticipantCards: true } });
  });

  it("STU-03: settings are read-only when the study is not a draft", () => {
    render(<Harness initial={study({ status: "live" })} Component={SettingsSection} />);
    const box = screen.getByLabelText("Randomise card order") as HTMLInputElement;
    expect(box.disabled).toBe(true);
  });
});

describe("StatusBar", () => {
  it("STU-10: shows the server's publish problems", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          {
            error: {
              code: "unprocessable",
              message: "Add at least one card before publishing.",
              details: { problems: ["Add at least one card before publishing."] },
            },
          },
          422,
        ),
      ),
    );
    render(<Harness initial={study()} Component={StatusBar as typeof SettingsSection} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    });
    expect(await screen.findByText("Add at least one card before publishing.")).toBeTruthy();
    expect(screen.getByText("This study can't be published yet:")).toBeTruthy();
  });

  it("STU-11 STU-03: a live study shows the share link, the lock notice and a Close action", () => {
    render(
      <Harness
        initial={study({ status: "live" })}
        Component={StatusBar as typeof SettingsSection}
      />,
    );
    expect((screen.getByLabelText("Participant link") as HTMLInputElement).value).toBe(
      "http://localhost:3000/s/abcdefghijkl",
    );
    expect(screen.getByRole("button", { name: "Copy link" })).toBeTruthy();
    expect(screen.getByText("This study is live.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close study" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Publish" })).toBeNull();
  });

  it("STU-11: a draft study has no share link", () => {
    render(<Harness initial={study()} Component={StatusBar as typeof SettingsSection} />);
    expect(screen.queryByLabelText("Participant link")).toBeNull();
  });
});

describe("adminApi", () => {
  it("STU-10: parses ApiErrorBody into AdminApiError with details", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          { error: { code: "conflict", message: "Duplicate", details: { problems: ["a"] } } },
          409,
        ),
      ),
    );
    const err = await adminApi("/studies/x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AdminApiError);
    expect((err as AdminApiError).code).toBe("conflict");
    expect((err as AdminApiError).message).toBe("Duplicate");
    expect(errorDetailLines(err)).toEqual(["a"]);
  });

  it("STU-01: returns undefined for 204 responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 204 })),
    );
    await expect(adminApi("/studies/x", { method: "DELETE" })).resolves.toBeUndefined();
  });

  it("formats zod field errors from bad_request details", () => {
    const err = new AdminApiError("bad_request", 400, "Invalid input", {
      formErrors: [],
      fieldErrors: { title: ["Title is required"] },
    });
    expect(errorDetailLines(err)).toEqual(["title: Title is required"]);
  });
});
