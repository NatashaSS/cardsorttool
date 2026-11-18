// Browser localStorage keys shared by the entry pages (F2) and the board (F1). PART-03.

/** Token of the participant's most recent board for a study, so they can resume. */
export const boardTokenKey = (slug: string) => `cardsort:board:${slug}`;

/** Wrapped in try/catch: storage can be unavailable (private mode, blocked site data). */
export function readStoredToken(slug: string): string | null {
  try {
    return window.localStorage.getItem(boardTokenKey(slug));
  } catch {
    return null;
  }
}

export function storeToken(slug: string, token: string): void {
  try {
    window.localStorage.setItem(boardTokenKey(slug), token);
  } catch {
    // ignore
  }
}

export function clearStoredToken(slug: string): void {
  try {
    window.localStorage.removeItem(boardTokenKey(slug));
  } catch {
    // ignore
  }
}
