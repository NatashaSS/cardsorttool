import "server-only";
import { route } from "@/server/http";

type Handler<P> = (req: Request, params: P) => Promise<unknown> | unknown;

/** route() whose responses (success and error) carry Cache-Control: no-store. */
export function noStoreRoute<P>(handler: Handler<P>) {
  const inner = route<P>(handler);
  return async (req: Request, ctx: { params: Promise<P> }): Promise<Response> => {
    const res = await inner(req, ctx);
    res.headers.set("Cache-Control", "no-store");
    return res;
  };
}
