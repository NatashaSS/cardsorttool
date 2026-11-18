"use client";
// A vertical list reorderable by drag handle (dnd-kit sortable) or by up/down buttons
// (keyboard / precise). Used for cards, groups and participant fields.
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useId, type ReactNode } from "react";
import { cn } from "@/components/ui";

type Props<T extends { id: string }> = {
  items: T[];
  /** Accessible name of each item, for the move buttons ("Move <name> up"). */
  itemName: (item: T) => string;
  /** Called with the new index order (from → to). */
  onMove: (from: number, to: number) => void;
  disabled?: boolean;
  renderItem: (item: T, index: number) => ReactNode;
  className?: string;
  /** aria-label of the <ul>. */
  label: string;
};

export function SortableList<T extends { id: string }>({
  items,
  itemName,
  onMove,
  disabled,
  renderItem,
  className,
  label,
}: Props<T>) {
  const dndId = useId();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = items.findIndex((i) => i.id === active.id);
    const to = items.findIndex((i) => i.id === over.id);
    if (from !== -1 && to !== -1) onMove(from, to);
  }

  return (
    <DndContext
      id={dndId}
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={items.map((i) => i.id)}
        strategy={verticalListSortingStrategy}
        disabled={disabled}
      >
        <ul
          aria-label={label}
          className={cn("divide-y divide-line rounded-md border border-line bg-surface", className)}
        >
          {items.map((item, index) => (
            <SortableRow
              key={item.id}
              id={item.id}
              name={itemName(item)}
              index={index}
              count={items.length}
              disabled={disabled}
              onMove={onMove}
            >
              {renderItem(item, index)}
            </SortableRow>
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function SortableRow({
  id,
  name,
  index,
  count,
  disabled,
  onMove,
  children,
}: {
  id: string;
  name: string;
  index: number;
  count: number;
  disabled?: boolean;
  onMove: (from: number, to: number) => void;
  children: ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex items-start gap-2 bg-surface px-3 py-2",
        isDragging && "relative z-10 shadow-md",
      )}
    >
      {!disabled && (
        <div className="flex shrink-0 items-center gap-0.5 pt-1">
          <button
            type="button"
            ref={setActivatorNodeRef}
            className="cursor-grab rounded px-1 text-muted hover:bg-canvas hover:text-ink active:cursor-grabbing"
            aria-label={`Drag ${name}`}
            {...attributes}
            {...listeners}
          >
            <span aria-hidden>⠿</span>
          </button>
          <button
            type="button"
            className="rounded px-1 text-sm text-muted hover:bg-canvas hover:text-ink disabled:opacity-30"
            aria-label={`Move ${name} up`}
            disabled={index === 0}
            onClick={() => onMove(index, index - 1)}
          >
            ↑
          </button>
          <button
            type="button"
            className="rounded px-1 text-sm text-muted hover:bg-canvas hover:text-ink disabled:opacity-30"
            aria-label={`Move ${name} down`}
            disabled={index === count - 1}
            onClick={() => onMove(index, index + 1)}
          >
            ↓
          </button>
        </div>
      )}
      <div className="min-w-0 flex-1">{children}</div>
    </li>
  );
}
