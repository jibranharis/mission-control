import { NextResponse, type NextRequest } from "next/server";
import { getJSON, setJSON, KEYS } from "@/lib/store";
import { DEFAULT_PROJECTS, LIFE_KEYS, type LifeProject, type PlanBlock } from "@/lib/life";

export const dynamic = "force-dynamic";

/** Records an item (Canvas assignment, event, to-do, Docket item) as done or not done. */
async function markDone(id: string, done: boolean) {
  const map = await getJSON<Record<string, string>>(KEYS.done, {});
  if (done) map[id] = new Date().toISOString();
  else delete map[id];
  // Forget anything checked off more than 30 days ago.
  const cutoff = Date.now() - 30 * 86_400_000;
  for (const [k, v] of Object.entries(map)) if (Date.parse(v) < cutoff) delete map[k];
  await setJSON(KEYS.done, map);
}

/** A Plan block checked off on Home checks off the block and whatever it plans, like it does on the Plan tab. */
async function markPlan(blockId: string, done: boolean) {
  const plan = await getJSON<PlanBlock[]>(LIFE_KEYS.plan, []);
  const block = plan.find((b) => b.id === blockId);
  if (!block) return false;
  await setJSON(
    LIFE_KEYS.plan,
    plan.map((b) => (b.id === blockId ? { ...b, done } : b)),
  );
  if (block.ref?.startsWith("project:")) {
    const [, pid, tid] = block.ref.split(":");
    const projects = await getJSON<LifeProject[]>(LIFE_KEYS.projects, DEFAULT_PROJECTS);
    await setJSON(
      LIFE_KEYS.projects,
      projects.map((p) => (p.id === pid ? { ...p, tasks: p.tasks.map((t) => (t.id === tid ? { ...t, done } : t)) } : p)),
    );
  } else if (block.ref) await markDone(block.ref, done);
  return true;
}

export async function POST(req: NextRequest) {
  const { id, done } = (await req.json().catch(() => ({}))) as { id?: string; done?: boolean };
  if (!id || id.length > 300) return NextResponse.json({ error: "id required" }, { status: 400 });
  if (id.startsWith("plan:")) {
    const ok = await markPlan(id.slice(5), Boolean(done));
    return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "not planned" }, { status: 404 });
  }
  await markDone(id, Boolean(done));
  return NextResponse.json({ ok: true });
}
