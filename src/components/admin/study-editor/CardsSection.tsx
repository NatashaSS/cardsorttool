"use client";
// STU-07 predefined cards (add / inline edit / delete / reorder) and STU-08 bulk paste.
import { useState, type FormEvent } from "react";
import { Button, Input, Notice, Textarea } from "@/components/ui";
import type { AdminCardDTO, BulkAddCardsResponse } from "@/lib/api-types";
import { LIMITS } from "@/lib/types";
import { adminApi } from "./api";
import { arrayMove } from "./fields-model";
import { SortableList } from "./SortableList";
import { ErrorNotice, LockedHint, Section, useAction, type SectionProps } from "./shared";

const toBody = (label: string, description: string) => ({
  label: label.trim(),
  description: description.trim() === "" ? null : description.trim(),
});

export function CardsSection({ study, locked, onStudyChange }: SectionProps) {
  const cards = study.cards;
  const base = `/studies/${study.id}/cards`;
  const setCards = (next: AdminCardDTO[]) => onStudyChange((prev) => ({ ...prev, cards: next }));
  const full = cards.length >= LIMITS.maxCards;

  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState({ label: "", description: "" });
  const list = useAction();

  const [bulkText, setBulkText] = useState("");
  const [bulkResult, setBulkResult] = useState<BulkAddCardsResponse | null>(null);
  const bulk = useAction();

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!label.trim()) {
      list.setError({ message: "Enter a card label", lines: [] });
      return;
    }
    const sent = { label, description };
    const card = await list.run(() =>
      adminApi<AdminCardDTO>(base, { method: "POST", body: toBody(label, description) }),
    );
    if (card) {
      onStudyChange((prev) => ({ ...prev, cards: [...prev.cards, card] }));
      // Keep anything typed while the request was in flight.
      setLabel((current) => (current === sent.label ? "" : current));
      setDescription((current) => (current === sent.description ? "" : current));
    }
  }

  async function saveEdit(id: string) {
    if (!edit.label.trim()) {
      list.setError({ message: "Enter a card label", lines: [] });
      return;
    }
    const card = await list.run(() =>
      adminApi<AdminCardDTO>(`${base}/${id}`, {
        method: "PATCH",
        body: toBody(edit.label, edit.description),
      }),
    );
    if (card) {
      onStudyChange((prev) => ({
        ...prev,
        cards: prev.cards.map((c) => (c.id === id ? card : c)),
      }));
      setEditingId(null);
    }
  }

  async function remove(id: string) {
    const ok = await list.run(async () => {
      await adminApi(`${base}/${id}`, { method: "DELETE" });
      return true;
    });
    if (ok) onStudyChange((prev) => ({ ...prev, cards: prev.cards.filter((c) => c.id !== id) }));
  }

  async function move(from: number, to: number) {
    const previous = cards;
    const next = arrayMove(cards, from, to);
    setCards(next);
    const result = await list.run(() =>
      adminApi<AdminCardDTO[]>(`${base}/reorder`, {
        method: "POST",
        body: { ids: next.map((c) => c.id) },
      }),
    );
    setCards(result ?? previous);
  }

  async function addBulk(e: FormEvent) {
    e.preventDefault();
    setBulkResult(null);
    if (!bulkText.trim()) {
      bulk.setError({ message: "Paste one card label per line", lines: [] });
      return;
    }
    const result = await bulk.run(() =>
      adminApi<BulkAddCardsResponse>(`${base}/bulk`, { method: "POST", body: { text: bulkText } }),
    );
    if (result) {
      onStudyChange((prev) => ({ ...prev, cards: [...prev.cards, ...result.added] }));
      setBulkResult(result);
      setBulkText("");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Section
        title="Cards"
        description="The items participants sort. Labels must be unique (ignoring case). A study needs at least one card to go live."
        actions={
          <span className="text-sm text-muted tabular-nums" data-testid="card-count">
            {cards.length} / {LIMITS.maxCards}
          </span>
        }
      >
        {locked && <LockedHint />}
        <ErrorNotice error={list.error} className="mb-4" />
        {cards.length === 0 ? (
          <p className="mb-4 rounded-md border border-dashed border-line px-4 py-6 text-center text-sm text-muted">
            No cards yet. Add them one at a time or paste a list below.
          </p>
        ) : (
          <SortableList
            label="Cards"
            items={cards}
            itemName={(c) => c.label}
            onMove={move}
            disabled={locked || list.busy}
            className="mb-4"
            renderItem={(c) =>
              editingId === c.id ? (
                <form
                  className="flex flex-col gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    saveEdit(c.id);
                  }}
                  onKeyDown={(e) => e.key === "Escape" && setEditingId(null)}
                >
                  <Input
                    aria-label={`Label for ${c.label}`}
                    value={edit.label}
                    maxLength={LIMITS.cardLabel}
                    onChange={(e) => setEdit({ ...edit, label: e.target.value })}
                    autoFocus
                    className="h-8"
                  />
                  <Input
                    aria-label={`Description for ${c.label}`}
                    value={edit.description}
                    maxLength={LIMITS.cardDescription}
                    placeholder="Description (optional)"
                    onChange={(e) => setEdit({ ...edit, description: e.target.value })}
                    className="h-8"
                  />
                  <div className="flex gap-2">
                    <Button type="submit" size="sm" disabled={list.busy}>
                      Save
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                      Cancel
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1 py-1">
                    <p className="text-sm" data-testid="card-label">
                      {c.label}
                    </p>
                    {c.description && <p className="mt-0.5 text-xs text-muted">{c.description}</p>}
                  </div>
                  {!locked && (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Edit ${c.label}`}
                        onClick={() => {
                          setEditingId(c.id);
                          setEdit({ label: c.label, description: c.description ?? "" });
                        }}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-danger"
                        aria-label={`Delete ${c.label}`}
                        disabled={list.busy}
                        onClick={() => remove(c.id)}
                      >
                        Delete
                      </Button>
                    </>
                  )}
                </div>
              )
            }
          />
        )}
        {!locked && (
          <form onSubmit={add} className="flex items-end gap-2">
            <div className="flex flex-1 flex-col gap-1">
              <label htmlFor="new-card-label" className="text-sm font-medium">
                New card
              </label>
              <Input
                id="new-card-label"
                value={label}
                maxLength={LIMITS.cardLabel}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Label"
              />
            </div>
            <div className="flex flex-1 flex-col gap-1">
              <label htmlFor="new-card-description" className="text-sm font-medium">
                Description <span className="font-normal text-muted">(optional)</span>
              </label>
              <Input
                id="new-card-description"
                value={description}
                maxLength={LIMITS.cardDescription}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <Button type="submit" variant="secondary" disabled={list.busy || full}>
              Add card
            </Button>
          </form>
        )}
      </Section>

      {!locked && (
        <Section
          title="Paste a list"
          description="One card per line. Blank lines are ignored and duplicates are skipped."
        >
          <form onSubmit={addBulk} className="flex flex-col gap-3">
            <ErrorNotice error={bulk.error} />
            {bulkResult && (
              <Notice tone={bulkResult.added.length > 0 ? "success" : "info"}>
                <p>
                  Added {bulkResult.added.length} {bulkResult.added.length === 1 ? "card" : "cards"}
                  .
                </p>
                {bulkResult.skipped.length > 0 && (
                  <p className="mt-1">
                    Skipped {bulkResult.skipped.length} duplicate
                    {bulkResult.skipped.length === 1 ? "" : "s"}: {bulkResult.skipped.join(", ")}
                  </p>
                )}
              </Notice>
            )}
            <Textarea
              aria-label="Cards to add, one per line"
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              rows={6}
              placeholder={"Billing history\nChange password\nNotification preferences"}
            />
            <div className="flex justify-end">
              <Button type="submit" variant="secondary" disabled={bulk.busy || full}>
                Add cards from list
              </Button>
            </div>
          </form>
        </Section>
      )}
    </div>
  );
}
