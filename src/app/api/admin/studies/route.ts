// STU-01: list and create studies. AUTH-03: admin session required.
import { CreateStudyInputSchema } from "@/lib/schemas";
import { getDb } from "@/server/db/client";
import { parseBody, route } from "@/server/http";
import { createStudy, listStudies } from "@/server/services/studies";
import { requireAdmin } from "@/server/session";

export const GET = route(async () => {
  await requireAdmin();
  return listStudies(getDb());
});

export const POST = route(async (req) => {
  await requireAdmin();
  const input = await parseBody(req, CreateStudyInputSchema);
  return Response.json(createStudy(getDb(), input), { status: 201 });
});
