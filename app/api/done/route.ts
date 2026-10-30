import { NextResponse, type NextRequest } from "next/server";
import { getJSON, setJSON, KEYS } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Marks any item (Canvas assignment, event, to-do, gym day) done or not done. */
export async function POST(req: NextRequest) {
  const { id, done } = (await req.json().catch(() => ({}))) as { id?: string; done?: boolean };
  if (!id || id.length > 300) return NextResponse.json({ error: "id required" }, { status: 400 });
  const map = await getJSON<Record<string, string>>(KEYS.done, {});
  if (done) map[id] = new Date().toISOString();
  else delete map[id];
  // Forget anything checked off more than 30 days ago.
  const cutoff = Date.now() - 30 * 86_400_000;
  for (const [k, v] of Object.entries(map)) if (Date.parse(v) < cutoff) delete map[k];
  await setJSON(KEYS.done, map);
  return NextResponse.json({ ok: true });
}
