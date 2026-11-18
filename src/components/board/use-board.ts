"use client";
// React binding: optimistic board state + the save queue (SAVE-01/02/03).
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { BoardStateDTO } from "@/lib/api-types";
import type { BoardOpInput } from "@/lib/schemas";
import { createBoardApi, type BoardApi } from "./api-client";
import { applyBoardOp, modelFromState, type BoardModel } from "./board-reducer";
import { SaveQueue, type ResetReason, type SaveQueueSnapshot } from "./save-queue";

export type BoardMeta = Pick<BoardStateDTO, "board" | "study">;

export type BoardNotice = { reason: ResetReason; message: string };

const NOTICE: Record<ResetReason, string | null> = {
  stale: "This board was changed in another tab or window, so we've loaded the latest version.",
  rejected: "A change couldn't be saved and has been undone.",
  completed: null, // the read-only banner explains it
  closed: null,
  requested: null,
};

const IDLE: SaveQueueSnapshot = { status: "saved", pending: 0, retryInMs: null };
const noopSubscribe = () => () => {};
const idleSnapshot = () => IDLE;

export function useBoard(initialState: BoardStateDTO, { readOnly }: { readOnly: boolean }) {
  const [meta, setMeta] = useState<BoardMeta>(() => ({
    board: initialState.board,
    study: initialState.study,
  }));
  const [model, setModel] = useState<BoardModel>(() => modelFromState(initialState));
  const [notice, setNotice] = useState<BoardNotice | null>(null);

  // No API client or queue at all in read-only mode (admin view, stream H).
  const [api] = useState<BoardApi | null>(() =>
    readOnly ? null : createBoardApi(initialState.board.token),
  );
  const [queue] = useState<SaveQueue | null>(() =>
    api ? new SaveQueue({ api, revision: initialState.board.revision }) : null,
  );

  const save = useSyncExternalStore(
    queue ? queue.subscribe : noopSubscribe,
    queue ? queue.getSnapshot : idleSnapshot,
    idleSnapshot,
  );

  useEffect(() => {
    if (!queue) return;
    const off = queue.onReset((state, reason) => {
      setMeta({ board: state.board, study: state.study });
      setModel(modelFromState(state));
      const message = NOTICE[reason];
      setNotice(message ? { reason, message } : null);
    });
    return () => {
      off();
      queue.dispose();
    };
  }, [queue]);

  // Warn before leaving while changes are still being saved.
  useEffect(() => {
    if (!queue || save.pending === 0) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [queue, save.pending]);

  /** Apply optimistically and enqueue for saving. */
  const dispatch = useCallback(
    (op: BoardOpInput) => {
      if (!queue) return;
      setModel((m) => applyBoardOp(m, op));
      queue.enqueue(op);
    },
    [queue],
  );

  const flush = useCallback(() => (queue ? queue.flush() : Promise.resolve(true)), [queue]);
  const retry = useCallback(() => queue?.retryNow(), [queue]);
  const reload = useCallback(() => queue?.reload() ?? Promise.resolve(), [queue]);
  const dismissNotice = useCallback(() => setNotice(null), []);
  const markCompleted = useCallback(
    (completedAt: string) =>
      setMeta((m) => ({ ...m, board: { ...m.board, status: "completed", completedAt } })),
    [],
  );

  return useMemo(
    () => ({
      meta,
      model,
      save,
      notice,
      api,
      dispatch,
      flush,
      retry,
      reload,
      dismissNotice,
      markCompleted,
    }),
    [meta, model, save, notice, api, dispatch, flush, retry, reload, dismissNotice, markCompleted],
  );
}

export type BoardController = ReturnType<typeof useBoard>;
