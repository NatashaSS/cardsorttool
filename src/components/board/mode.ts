"use client";
import { createContext, useContext } from "react";

/** "participant" = the participant's own board; "admin" = read-only view in the admin (RES-02). */
export type BoardMode = "participant" | "admin";

export const BoardModeContext = createContext<BoardMode>("participant");
export const useBoardMode = () => useContext(BoardModeContext);
