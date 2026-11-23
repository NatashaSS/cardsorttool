"use client";
// Sticky-note card (BRD-02), description tooltip (PERM-09), own-card controls (PERM-02).
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  useId,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { CardDTO } from "@/lib/api-types";
import { cn } from "@/components/ui/cn";
import { useBoardMode } from "./mode";

export type CardControls = {
  /** PERM-02: shown only for the participant's own cards when allowed. */
  onEdit?: (card: CardDTO) => void;
  onDelete?: (card: CardDTO) => void;
};

type CardProps = {
  card: CardDTO;
  showDescription: boolean;
  /** "group" cards fill the column; "tray" cards have a fixed width. */
  variant: "group" | "tray";
} & CardControls;

const noteClass = (card: CardDTO, variant: CardProps["variant"]) =>
  cn(
    "relative rounded-sm px-3 py-2 text-left text-sm leading-snug text-ink shadow-note select-none",
    "break-words whitespace-pre-wrap",
    card.origin === "participant" ? "bg-note-own" : "bg-note",
    variant === "tray" ? "w-44 min-h-16" : "w-full min-h-12",
  );

/** The card face, also used by the DragOverlay. */
export function CardFace({
  card,
  variant,
  lifted,
}: {
  card: CardDTO;
  variant: CardProps["variant"];
  lifted?: boolean;
}) {
  return (
    <div
      className={cn(noteClass(card, variant), lifted && "rotate-2 shadow-lg ring-2 ring-accent/40")}
    >
      <CardText card={card} />
    </div>
  );
}

/**
 * BRD-09: the card's image above its label, scaled to the card width with a capped height.
 * Keyed by URL by the caller, so a replaced image gets a fresh error state.
 */
function CardImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- served by our own route with long-lived caching; next/image adds nothing here
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setFailed(true)}
      // An error during server rendering fires before hydration attaches onError.
      ref={(el) => {
        if (el?.complete && el.naturalWidth === 0) setFailed(true);
      }}
      className="pointer-events-none mb-1.5 block h-auto max-h-30 w-full rounded-[2px] object-contain"
      data-testid="card-image"
    />
  );
}

function CardText({ card }: { card: CardDTO }) {
  const mode = useBoardMode();
  return (
    <>
      {card.imageUrl && <CardImage key={card.imageUrl} src={card.imageUrl} alt={card.label} />}
      <span>{card.label}</span>
      {card.origin === "participant" && (
        <span className="mt-1 block text-[11px] font-medium tracking-wide text-muted uppercase">
          {mode === "admin" ? "Participant card" : "Your card"}
        </span>
      )}
    </>
  );
}

/** Hover/focus tooltip rendered in a portal so scrolling columns don't clip it. */
function useDescriptionTip(text: string | null) {
  const tipId = useId();
  const [rect, setRect] = useState<DOMRect | null>(null);
  const show = (el: HTMLElement) => text && setRect(el.getBoundingClientRect());
  const hide = () => setRect(null);
  const tip =
    text && rect
      ? createPortal(
          <div
            id={tipId}
            role="tooltip"
            style={{ position: "fixed", left: rect.left, top: rect.bottom + 6, maxWidth: 280 }}
            className="pointer-events-none z-50 rounded-md bg-ink px-3 py-2 text-xs leading-relaxed text-white shadow-lg"
          >
            {text}
          </div>,
          document.body,
        )
      : null;
  return {
    tip,
    describedBy: text && rect ? tipId : undefined,
    handlers: text
      ? {
          onMouseEnter: (e: { currentTarget: HTMLElement }) => show(e.currentTarget),
          onMouseLeave: hide,
          onFocus: (e: { currentTarget: HTMLElement }) => show(e.currentTarget),
          onBlur: hide,
        }
      : {},
    hide,
  };
}

const stop = {
  onPointerDown: (e: PointerEvent) => e.stopPropagation(),
  onKeyDown: (e: KeyboardEvent) => e.stopPropagation(),
};

function OwnCardButtons({ card, onEdit, onDelete }: { card: CardDTO } & CardControls) {
  if (!onEdit && !onDelete) return null;
  return (
    <div className="absolute top-1 right-1 flex gap-0.5 opacity-0 transition-opacity group-focus-within/card:opacity-100 group-hover/card:opacity-100">
      {onEdit && (
        <IconButton label={`Edit card ${card.label}`} onClick={() => onEdit(card)}>
          ✎
        </IconButton>
      )}
      {onDelete && (
        <IconButton label={`Delete card ${card.label}`} onClick={() => onDelete(card)}>
          ×
        </IconButton>
      )}
    </div>
  );
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      {...stop}
      className="flex size-6 items-center justify-center rounded bg-white/70 text-sm text-ink hover:bg-white focus-visible:outline-2 focus-visible:outline-accent"
    >
      {children}
    </button>
  );
}

/** Draggable card inside a SortableContext. */
export function SortableCard({
  card,
  showDescription,
  variant,
  containerId,
  onEdit,
  onDelete,
}: CardProps & { containerId: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    data: { type: "card", containerId },
  });
  const { tip, describedBy, handlers, hide } = useDescriptionTip(
    showDescription ? card.description : null,
  );
  const style: CSSProperties = { transform: CSS.Translate.toString(transform), transition };
  const describedByAll =
    [attributes["aria-describedby"], describedBy].filter(Boolean).join(" ") || undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group/card relative",
        variant === "tray" ? "w-44" : "w-full",
        isDragging && "opacity-40",
      )}
      data-card-id={card.id}
    >
      <div
        {...attributes}
        {...listeners}
        {...handlers}
        onPointerDownCapture={hide}
        aria-describedby={describedByAll}
        aria-label={card.label}
        className={cn(
          noteClass(card, variant),
          "cursor-grab touch-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
          (onEdit || onDelete) && "pr-14",
        )}
      >
        <CardText card={card} />
      </div>
      <OwnCardButtons card={card} onEdit={onEdit} onDelete={onDelete} />
      {!isDragging && tip}
    </div>
  );
}

/** Non-draggable card (read-only boards). Focusable only when it has a description to show. */
export function StaticCard({ card, showDescription, variant }: CardProps) {
  const text = showDescription ? card.description : null;
  const { tip, describedBy, handlers } = useDescriptionTip(text);
  return (
    <div className={cn("relative", variant === "tray" ? "w-44" : "w-full")} data-card-id={card.id}>
      <div
        {...handlers}
        tabIndex={text ? 0 : undefined}
        aria-describedby={describedBy}
        className={cn(
          noteClass(card, variant),
          "focus-visible:outline-2 focus-visible:outline-accent",
        )}
      >
        <CardText card={card} />
      </div>
      {tip}
    </div>
  );
}
