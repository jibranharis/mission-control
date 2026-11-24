import { jobsMeta, noteSearchError, searchPublicLists } from "@/lib/jobs";
import { recordRun } from "@/lib/ops";

export const JOB_AUTOMATION = {
  id: "job-apply",
  name: "Job applications",
  description: "Finds internships and jobs, fills out the best ones and stops before Submit. Never submits.",
  where: "Cloud search + Claude scheduled task on the Mac",
  schedule: { times: ["10:00", "20:00"] },
};

/** Runs the cloud search and logs it on the Automations tab. Skips if one ran in the last `freshMin` minutes. */
export async function runCloudSearch(freshMin = 0): Promise<{ skipped?: boolean; found?: number; added?: number; error?: string }> {
  const meta = await jobsMeta();
  if (freshMin && meta.lastSearchAt && Date.now() - Date.parse(meta.lastSearchAt) < freshMin * 60_000) return { skipped: true };
  const startedAt = new Date().toISOString();
  try {
    const r = await searchPublicLists();
    await recordRun({
      automation: JOB_AUTOMATION,
      name: "Job search · public lists",
      status: "success",
      startedAt,
      summary: `${r.added} new opening${r.added === 1 ? "" : "s"} found · ${r.found} open summer 2027 internships tracked${r.removed ? ` · ${r.removed} closed and removed` : ""}`,
      steps: [{ name: "Simplify summer 2027 list", status: "ok", note: `${r.found} fit` }],
    });
    return { found: r.found, added: r.added };
  } catch (err) {
    await noteSearchError(err);
    const msg = err instanceof Error ? err.message : String(err);
    await recordRun({
      automation: JOB_AUTOMATION,
      name: "Job search · public lists",
      status: "failure",
      startedAt,
      summary: `Search failed: ${msg.slice(0, 200)}`,
      steps: [{ name: "Simplify summer 2027 list", status: "failed", note: msg.slice(0, 200) }],
    });
    return { error: msg };
  }
}
