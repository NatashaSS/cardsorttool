"use client";
// STU-13: card image thumbnail and Add / Replace / Remove controls in the editor's card list.
import { useRef, type ChangeEvent } from "react";
import { Button } from "@/components/ui";
import type { AdminCardDTO } from "@/lib/api-types";
import {
  CARD_IMAGE_ACCEPT,
  CARD_IMAGE_MAX_BYTES,
  CARD_IMAGE_SIZE_MESSAGE,
  CARD_IMAGE_TYPE_MESSAGE,
  CARD_IMAGE_TYPES,
} from "@/lib/card-images";

/**
 * Client-side pre-check (the server is the authority and sniffs the content). Returns an error
 * message or null. An empty declared type is left to the server.
 */
export function precheckCardImage(file: { type: string; size: number }): string | null {
  if (file.type && !(CARD_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    return `This file is not a supported image. ${CARD_IMAGE_TYPE_MESSAGE}`;
  }
  if (file.size > CARD_IMAGE_MAX_BYTES) return CARD_IMAGE_SIZE_MESSAGE;
  return null;
}

export function CardThumbnail({ card }: { card: AdminCardDTO }) {
  if (!card.imageUrl) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- small thumbnail from our own image route
    <img
      src={card.imageUrl}
      alt={`Image for ${card.label}`}
      loading="lazy"
      className="size-12 shrink-0 rounded border border-line bg-canvas object-contain"
    />
  );
}

export function CardImageButtons({
  card,
  busy,
  onUpload,
  onRemove,
}: {
  card: AdminCardDTO;
  busy: boolean;
  onUpload: (file: File) => void;
  onRemove: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset so choosing the same file again still fires a change.
    e.target.value = "";
    if (file) onUpload(file);
  };
  const has = card.imageUrl !== null;
  return (
    <>
      <input
        ref={input}
        type="file"
        accept={CARD_IMAGE_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-label={`Image file for ${card.label}`}
        onChange={onChange}
      />
      <Button
        size="sm"
        variant="ghost"
        aria-label={has ? `Replace image of ${card.label}` : `Add image to ${card.label}`}
        disabled={busy}
        onClick={() => input.current?.click()}
      >
        {has ? "Replace image" : "Add image"}
      </Button>
      {has && (
        <Button
          size="sm"
          variant="ghost"
          aria-label={`Remove image from ${card.label}`}
          disabled={busy}
          onClick={onRemove}
        >
          Remove image
        </Button>
      )}
    </>
  );
}
