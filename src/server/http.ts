import "server-only";
import { z } from "zod";
import type { ApiErrorBody } from "@/lib/api-types";
import { ServiceError } from "./errors";

/** Parse a JSON request body with a zod schema; throws ServiceError("bad_request"). */
export async function parseBody<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    throw new ServiceError("bad_request", "Request body must be valid JSON");
  }
  return parseWith(schema, json);
}

export function parseWith<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ServiceError("bad_request", "Invalid input", z.flattenError(result.error));
  }
  return result.data;
}

export function errorResponse(err: unknown): Response {
  if (err instanceof ServiceError) {
    const body: ApiErrorBody = {
      error: { code: err.code, message: err.message, details: err.details },
    };
    return Response.json(body, { status: err.status });
  }
  console.error(err);
  const body: ApiErrorBody = { error: { code: "internal", message: "Something went wrong" } };
  return Response.json(body, { status: 500 });
}

type RouteCtx<P> = { params: Promise<P> };

/**
 * Wrap a route handler: awaits params, JSON-encodes the result (status 200, or 204 for
 * undefined), passes Response objects through, and maps errors to ApiErrorBody.
 *
 *   export const POST = route<{ token: string }>(async (req, { token }) => { ... });
 */
export function route<P = Record<string, never>>(
  handler: (req: Request, params: P) => Promise<unknown> | unknown,
) {
  return async (req: Request, ctx: RouteCtx<P>): Promise<Response> => {
    try {
      const params = ctx?.params ? await ctx.params : ({} as P);
      const result = await handler(req, params);
      if (result instanceof Response) return result;
      if (result === undefined) return new Response(null, { status: 204 });
      return Response.json(result);
    } catch (err) {
      return errorResponse(err);
    }
  };
}
