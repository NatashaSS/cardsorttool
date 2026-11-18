// PART-01: public study data for the intro page.
import { getDb } from "@/server/db/client";
import { getPublicStudy } from "@/server/services/boards";
import { noStoreRoute } from "../../boards/_lib/no-store";

export const GET = noStoreRoute<{ slug: string }>((_req, { slug }) => getPublicStudy(getDb(), slug));
