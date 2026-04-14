import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createAdminClient } from "../_shared/supabase-client.ts";
import { parseCSVRows } from "./parse.ts";
import { upsertData } from "./upsert.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

serve(async (req: Request) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  // Only allow calls from the service-role key (admin-only operation).
  const authHeader = req.headers.get("Authorization") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (authHeader !== `Bearer ${serviceRoleKey}`) {
    return json({ error: "Unauthorized" }, 401);
  }

  let csvText: string;
  try {
    const formData = await req.formData();
    const file = formData.get("file");
    if (!file || typeof file === "string") {
      return json({ error: "No file provided in form field 'file'" }, 400);
    }
    csvText = await (file as File).text();
  } catch {
    return json({ error: "Failed to parse multipart form data" }, 400);
  }

  try {
    const client = createAdminClient();
    const rows = parseCSVRows(csvText);
    const summary = await upsertData(rows, client);
    return json(summary, 200);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
