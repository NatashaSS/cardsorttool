// The participant board (BRD-*, PART-03/04/05/06). Loads the state on the server; the client
// <Board> takes over from there (auto-save via /api/boards/[token]/**).
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { BoardStateDTO } from "@/lib/api-types";
import { Board } from "@/components/board";
import { getDb } from "@/server/db/client";
import { ServiceError } from "@/server/errors";
import { getBoardState } from "@/server/services/boards";

/** PART-04: unknown tokens, or a token used under another study's slug, are 404. */
function loadBoard(slug: string, token: string): BoardStateDTO {
  let state: BoardStateDTO;
  try {
    state = getBoardState(getDb(), token);
  } catch (e) {
    if (e instanceof ServiceError && e.code === "not_found") notFound();
    throw e;
  }
  if (state.study.slug !== slug) notFound();
  return state;
}

export async function generateMetadata({
  params,
}: PageProps<"/s/[slug]/b/[token]">): Promise<Metadata> {
  const { slug, token } = await params;
  try {
    const state = getBoardState(getDb(), token);
    return {
      title: state.study.slug === slug ? `${state.study.title} · Card sort` : "Card sort",
      robots: { index: false },
    };
  } catch {
    return { title: "Card sort", robots: { index: false } };
  }
}

export default async function BoardPage({ params }: PageProps<"/s/[slug]/b/[token]">) {
  const { slug, token } = await params;
  const state = loadBoard(slug, token);
  return <Board initialState={state} />;
}
