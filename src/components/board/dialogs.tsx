"use client";
// Small modal dialogs used by the board: add/edit own card (PERM-01/02) and confirmations.
import { useState, type FormEvent } from "react";
import { Button, Field, Input, Textarea } from "@/components/ui";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/Dialog";
import { LIMITS } from "@/lib/types";

export type CardFormValue = { label: string; description: string | null };

export function CardFormDialog({
  open,
  mode,
  initial,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  mode: "add" | "edit";
  initial?: CardFormValue;
  onOpenChange: (open: boolean) => void;
  onSubmit: (value: CardFormValue) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <DialogContent>
          {/* Mounted only while open, so each opening starts from the initial value. */}
          <CardForm mode={mode} initial={initial} onSubmit={onSubmit} />
        </DialogContent>
      )}
    </Dialog>
  );
}

function CardForm({
  mode,
  initial,
  onSubmit,
}: {
  mode: "add" | "edit";
  initial?: CardFormValue;
  onSubmit: (value: CardFormValue) => void;
}) {
  const [label, setLabel] = useState(initial?.label ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [error, setError] = useState<string | undefined>();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!label.trim()) {
      setError("Enter a label for the card");
      return;
    }
    onSubmit({ label: label.trim(), description: description.trim() || null });
  };

  return (
    <form onSubmit={submit} noValidate>
      <DialogTitle>{mode === "add" ? "Add a card" : "Edit card"}</DialogTitle>
      <DialogDescription>
        {mode === "add"
          ? "Add a card for something you think is missing. It starts in the unsorted cards."
          : "Change the text of your card."}
      </DialogDescription>
      <div className="mt-4 flex flex-col gap-4">
        <Field label="Label" required error={error}>
          {(p) => (
            <Input
              {...p}
              autoFocus
              value={label}
              maxLength={LIMITS.cardLabel}
              onChange={(e) => {
                setLabel(e.target.value);
                setError(undefined);
              }}
            />
          )}
        </Field>
        <Field label="Description" hint="Optional">
          {(p) => (
            <Textarea
              {...p}
              value={description}
              maxLength={LIMITS.cardDescription}
              onChange={(e) => setDescription(e.target.value)}
            />
          )}
        </Field>
      </div>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="secondary">Cancel</Button>
        </DialogClose>
        <Button type="submit">{mode === "add" ? "Add card" : "Save card"}</Button>
      </DialogFooter>
    </form>
  );
}

export type ConfirmRequest = {
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
};

export function ConfirmDialog({
  request,
  onClose,
}: {
  request: ConfirmRequest | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={request !== null} onOpenChange={(o) => !o && onClose()}>
      {request && (
        <DialogContent>
          <DialogTitle>{request.title}</DialogTitle>
          <DialogDescription>{request.description}</DialogDescription>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button
              variant="danger"
              onClick={() => {
                request.onConfirm();
                onClose();
              }}
            >
              {request.confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}
