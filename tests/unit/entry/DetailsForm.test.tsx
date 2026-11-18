// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DetailsForm } from "@/components/entry/DetailsForm";
import type { ParticipantFieldConfig } from "@/lib/schemas";

afterEach(cleanup);

const config: ParticipantFieldConfig[] = [
  { key: "name", mode: "required" },
  { key: "email", mode: "required" },
  { key: "seniority", mode: "optional" },
  { key: "gender", mode: "optional" },
  { key: "country", mode: "optional" },
  { key: "custom_q1", label: "Favourite tool", mode: "optional" },
];

const submit = () => fireEvent.click(screen.getByRole("button", { name: "Start sorting" }));

describe("DetailsForm", () => {
  it("PFLD-02/PFLD-03/PFLD-04: renders inputs and selects in config order with required markers", () => {
    render(<DetailsForm config={config} onSubmit={() => {}} />);
    const labels = Array.from(document.querySelectorAll("label")).map((l) => l.textContent);
    expect(labels).toEqual(["Name *", "Email *", "Seniority", "Gender", "Country of residence", "Favourite tool"]);
    expect(screen.getByLabelText(/Email/)).toHaveProperty("type", "email");
    expect(screen.getByLabelText("Favourite tool").tagName).toBe("INPUT");
    const seniority = screen.getByLabelText("Seniority") as HTMLSelectElement;
    expect(seniority.tagName).toBe("SELECT");
    expect(seniority.options[0].textContent).toBe("Select…");
    expect((screen.getByLabelText("Country of residence") as HTMLSelectElement).options.length).toBeGreaterThan(200);
  });

  it("PFLD-02: shows per-field errors, marks them invalid and focuses the first", () => {
    const onSubmit = vi.fn();
    render(<DetailsForm config={config} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText(/Email/), { target: { value: "nope" } });
    submit();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("Name is required")).toBeTruthy();
    expect(screen.getByText("Enter a valid email address")).toBeTruthy();
    const name = screen.getByLabelText(/Name/);
    expect(name.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(name);
  });

  it("PFLD-02: 'Prefer to self-describe' reveals a required text input", () => {
    const onSubmit = vi.fn();
    render(<DetailsForm config={config} onSubmit={onSubmit} />);
    expect(screen.queryByLabelText(/Please describe your gender/)).toBeNull();
    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: "Ada" } });
    fireEvent.change(screen.getByLabelText(/Email/), { target: { value: "ada@example.com" } });
    fireEvent.change(screen.getByLabelText("Gender"), { target: { value: "self_describe" } });
    const describe = screen.getByLabelText(/Please describe your gender/);
    submit();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(describe);
    fireEvent.change(describe, { target: { value: "Agender" } });
    submit();
    expect(onSubmit).toHaveBeenCalledWith({
      name: "Ada",
      email: "ada@example.com",
      gender: "self_describe",
      genderSelfDescribe: "Agender",
    });
  });

  it("PFLD-02: shows server field errors and form messages", () => {
    render(
      <DetailsForm
        config={config}
        onSubmit={() => {}}
        serverErrors={{ email: "Email rejected by server" }}
        formMessage="This study is no longer accepting responses."
      />,
    );
    expect(screen.getByText("Email rejected by server")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("no longer accepting responses");
    expect(document.activeElement).toBe(screen.getByLabelText(/Email/));
  });
});
