import { getJSON, setJSON, hashDelete, hashGetAll, hashSet } from "@/lib/store";
import { TIMEZONE } from "@/lib/time";
import { google, listAccounts } from "@/lib/sources/google";

/**
 * The job-application bot's data. Openings come from two places:
 *  - the cloud search (Vercel cron, 10 AM and 8 PM), which reads public
 *    internship lists, and
 *  - the Mac task (a Claude scheduled task in the desktop app's browser),
 *    which searches LinkedIn, Handshake and Jobright while signed in, then
 *    fills out the top applications and stops before Submit.
 * Nothing here ever submits an application.
 */

export const JOBS_KEY = "mc:jobs";
const META_KEY = "mc:jobs:meta";

/** 1 = well-known / first-year programs, 2 = other internships, 3 = tech jobs, 4 = other paid jobs. */
export type JobTier = 1 | 2 | 3 | 4;
export const TIER_LABEL: Record<JobTier, string> = { 1: "TOP PROGRAM", 2: "INTERNSHIP", 3: "TECH JOB", 4: "PAID JOB" };

/**
 * new      found, not worked on yet
 * ready    filled out, stopped on the last page before Submit
 * copy     the form couldn't be typed into: answers saved to copy and paste
 * link     couldn't get to the form (account needed, blocked): link only
 * submitted / skipped   set by Jibran
 */
export type JobStatus = "new" | "ready" | "copy" | "link" | "submitted" | "skipped";
export const JOB_STATUSES: JobStatus[] = ["new", "ready", "copy", "link", "submitted", "skipped"];

export interface JobAnswer {
  q: string;
  a: string;
}

export interface Job {
  id: string;
  company: string;
  role: string;
  url: string;
  tier: JobTier;
  /** Where it was found: "Simplify list", "LinkedIn", "Handshake", "Jobright", "Company site". */
  source: string;
  location?: string;
  /** YYYY-MM-DD, when the posting gives one. */
  deadline?: string;
  category?: string;
  /** Higher = a better fit inside its tier (EE / hardware first). */
  score: number;
  postedAt?: string;
  foundAt: string;
  status: JobStatus;
  /** Which resume to use. */
  resume: "engineering" | "product";
  /** Cover letter and short answers, written for this company. */
  answers?: JobAnswer[];
  /** What's left for Jibran, e.g. "Attach your resume" or "Needs a Workday account". */
  note?: string;
  workedAt?: string;
  statusAt?: string;
  notifiedAt?: string;
}

export interface JobsMeta {
  lastSearchAt?: string;
  lastSearchFound?: number;
  lastSearchError?: string;
}

export const READY: JobStatus[] = ["ready", "copy"];

/* ------------------------------------------------------------ helpers */

const clean = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.trim().replace(/\s+/g, " ").slice(0, n) : undefined);
const longText = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : undefined);

function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** Same opening, same id, whichever site it came from. */
export function jobId(url: string, company?: string, role?: string): string {
  try {
    const u = new URL(url);
    // Tracking parameters change between visits; the path is the posting.
    const keep = ["gh_jid", "jobId", "jk", "currentJobId", "id"];
    const q = keep.map((k) => (u.searchParams.get(k) ? `${k}=${u.searchParams.get(k)}` : "")).filter(Boolean).join("&");
    return `j${hash(`${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}?${q}`)}`;
  } catch {
    return `j${hash(`${company ?? ""}|${role ?? ""}`.toLowerCase())}`;
  }
}

const TOP_COMPANIES = [
  "google", "microsoft", "apple", "amazon", "meta", "nvidia", "tesla", "spacex", "blue origin", "nasa", "jet propulsion",
  "jpl", "lawrence livermore", "lawrence berkeley", "sandia", "los alamos", "oak ridge", "argonne", "national renewable",
  "lockheed", "northrop", "raytheon", "rtx", "boeing", "general dynamics", "l3harris", "anduril", "qualcomm", "intel", "amd",
  "texas instruments", "analog devices", "broadcom", "cisco", "ibm", "netflix", "salesforce", "adobe", "openai", "anthropic",
  "palantir", "rivian", "lucid", "zoox", "waymo", "applied materials", "lam research", "kla", "jane street", "citadel",
  "general electric", "ge aerospace", "honeywell", "siemens", "medtronic", "intuitive surgical", "stripe", "databricks",
];
const FIRST_YEAR = /\b(freshman|freshmen|sophomore|first[- ]year|second[- ]year|underclass\w*|explore|step intern|early (career|insight|identification)|discovery program|pathways)\b/i;
const EE = /\b(electrical|hardware|embedded|firmware|robot\w*|fpga|asic|circuit|pcb|power|rf|analog|semiconductor|controls?|mechatronics|avionics|silicon|chip|test engineer\w*)\b/i;

export function tierFor(company: string, role: string, given?: number): JobTier {
  if (given && given >= 1 && given <= 4) return given as JobTier;
  if (FIRST_YEAR.test(role)) return 1;
  const c = company.toLowerCase();
  if (TOP_COMPANIES.some((t) => c.includes(t))) return 1;
  return /intern|co-?op|fellow/i.test(role) ? 2 : 3;
}

export function scoreFor(role: string, category?: string): number {
  let s = { Hardware: 3, Software: 2, "Software Engineering": 2, Product: 2, "AI/ML/Data": 1 }[category ?? ""] ?? 1;
  if (EE.test(role)) s += 3;
  if (FIRST_YEAR.test(role)) s += 4;
  if (/product/i.test(role)) s += 1;
  return s;
}

const resumeFor = (role: string): Job["resume"] => (/product (manag|owner|analyst)|\bpm\b|\bapm\b/i.test(role) ? "product" : "engineering");

/** Best first: top programs, then the soonest deadline, then the best fit, then the newest. */
export function compareJobs(a: Job, b: Job): number {
  return (
    a.tier - b.tier ||
    (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999") ||
    b.score - a.score ||
    (b.postedAt ?? b.foundAt).localeCompare(a.postedAt ?? a.foundAt)
  );
}

/* ------------------------------------------------------------- reading */

export async function allJobs(): Promise<Job[]> {
  return Object.values(await hashGetAll<Job>(JOBS_KEY)).sort(compareJobs);
}

export async function jobsMeta(): Promise<JobsMeta> {
  return getJSON<JobsMeta>(META_KEY, {});
}

/** What the Mac task should work on next. */
export function queue(jobs: Job[], n: number): Job[] {
  return jobs.filter((j) => j.status === "new").sort(compareJobs).slice(0, n);
}

/* ------------------------------------------------------------- writing */

/** One opening or update as sent by the Mac task. Unknown fields are ignored. */
export interface JobInput {
  id?: string;
  company?: string;
  role?: string;
  url?: string;
  tier?: number;
  source?: string;
  location?: string;
  deadline?: string;
  status?: JobStatus;
  resume?: Job["resume"];
  answers?: JobAnswer[];
  note?: string;
}

/**
 * Adds new openings and applies updates. An update never moves a job that
 * Jibran already marked submitted or skipped. Returns how many were added and
 * which jobs just became ready.
 */
export async function saveJobs(inputs: JobInput[]): Promise<{ added: number; updated: number; nowReady: Job[]; errors: string[] }> {
  const existing = await hashGetAll<Job>(JOBS_KEY);
  const now = new Date().toISOString();
  const writes: Record<string, Job> = {};
  const errors: string[] = [];
  let added = 0;
  let updated = 0;
  const nowReady: Job[] = [];

  for (const [i, raw] of inputs.slice(0, 500).entries()) {
    if (!raw || typeof raw !== "object") continue;
    const url = clean(raw.url, 1000);
    const id = clean(raw.id, 40) ?? (url ? jobId(url, raw.company, raw.role) : undefined);
    if (!id) {
      errors.push(`#${i}: needs an id or a url`);
      continue;
    }
    const prev = writes[id] ?? existing[id];
    const answers = Array.isArray(raw.answers)
      ? raw.answers
          .filter((x) => x && typeof x === "object")
          .slice(0, 20)
          .map((x) => ({ q: clean(x.q, 300) ?? "Answer", a: longText(x.a, 6000) ?? "" }))
          .filter((x) => x.a)
      : undefined;
    const status = JOB_STATUSES.includes(raw.status as JobStatus) ? (raw.status as JobStatus) : undefined;
    const deadline = typeof raw.deadline === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.deadline) ? raw.deadline : undefined;

    if (!prev) {
      const company = clean(raw.company, 120);
      const role = clean(raw.role, 200);
      if (!company || !role || !url || !/^https?:\/\//.test(url)) {
        errors.push(`#${i}: a new opening needs company, role and an http(s) url`);
        continue;
      }
      const job: Job = {
        id,
        company,
        role,
        url,
        tier: tierFor(company, role, raw.tier),
        source: clean(raw.source, 40) ?? "Mac search",
        location: clean(raw.location, 160),
        deadline,
        score: scoreFor(role),
        foundAt: now,
        status: status ?? "new",
        resume: raw.resume === "product" || raw.resume === "engineering" ? raw.resume : resumeFor(role),
        answers,
        note: clean(raw.note, 400),
        ...(status && status !== "new" ? { workedAt: now, statusAt: now } : {}),
      };
      writes[id] = job;
      added++;
      if (READY.includes(job.status)) nowReady.push(job);
      continue;
    }

    const next: Job = { ...prev };
    if (deadline) next.deadline = deadline;
    if (raw.tier && raw.tier >= 1 && raw.tier <= 4) next.tier = raw.tier as JobTier;
    if (raw.location) next.location = clean(raw.location, 160) ?? next.location;
    if (raw.resume === "product" || raw.resume === "engineering") next.resume = raw.resume;
    if (answers?.length) next.answers = answers;
    if (raw.note !== undefined) next.note = clean(raw.note, 400);
    const locked = prev.status === "submitted" || prev.status === "skipped";
    // The bot may skip an opening it hasn't worked on (e.g. juniors and seniors only), with a note saying why.
    if (status === "skipped" && prev.status === "new") {
      next.status = "skipped";
      next.statusAt = now;
      next.workedAt = now;
    } else if (status && !locked && status !== prev.status && status !== "submitted" && status !== "skipped") {
      next.status = status;
      next.statusAt = now;
      if (status !== "new") next.workedAt = now;
      if (READY.includes(status) && !READY.includes(prev.status)) {
        next.notifiedAt = undefined;
        nowReady.push(next);
      }
    }
    writes[id] = next;
    updated++;
  }
  await hashSet(JOBS_KEY, writes);
  return { added, updated, nowReady, errors };
}

/** Jibran marks a job submitted, skipped, or puts it back. */
export async function setJobStatus(id: string, status: JobStatus): Promise<Job | null> {
  const all = await hashGetAll<Job>(JOBS_KEY);
  const job = all[id];
  if (!job) return null;
  // "Put back" returns it to how far the bot got.
  const back: JobStatus = job.answers?.length ? "copy" : job.workedAt ? "link" : "new";
  const next: Job = { ...job, status: status === "new" ? back : status, statusAt: new Date().toISOString() };
  await hashSet(JOBS_KEY, { [id]: next });
  return next;
}

/* --------------------------------------------------------- cloud search */

interface SimplifyListing {
  id: string;
  company_name: string;
  title: string;
  url: string;
  active: boolean;
  is_visible?: boolean;
  terms?: string[];
  locations?: string[];
  category?: string;
  degrees?: string[];
  date_posted?: number;
}

const SIMPLIFY_URL = "https://raw.githubusercontent.com/SimplifyJobs/Summer2027-Internships/dev/.github/scripts/listings.json";
const GRAD_ONLY = /\b(ph\.?d|doctoral|master'?s|m\.?s\.? student|mba|graduate[- ]level|graduate (intern|engineer|student|research)\w*|senior [a-z ]*intern)\b/i;

/** Open summer 2027 internships an undergrad can apply to. */
function fits(l: SimplifyListing): boolean {
  if (!l.active || l.is_visible === false || !l.url) return false;
  if (!(l.terms ?? []).some((t) => /summer 2027/i.test(t))) return false;
  const degrees = l.degrees ?? [];
  if (degrees.length && !degrees.some((d) => /bachelor/i.test(d))) return false;
  if (GRAD_ONLY.test(l.title.replace(/undergraduate/gi, "")) && !/bachelor/i.test(l.title)) return false;
  return l.category !== "Quant";
}

/**
 * Reads the public Summer 2027 internship list (kept up to date by Simplify
 * from company career sites) and saves every opening that fits. Openings the
 * list has closed are dropped unless the bot already worked on them.
 */
export async function searchPublicLists(): Promise<{ found: number; added: number; removed: number }> {
  const res = await fetch(SIMPLIFY_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`internship list: ${res.status}`);
  const listings = ((await res.json()) as SimplifyListing[]).filter(fits);
  const existing = await hashGetAll<Job>(JOBS_KEY);
  const now = new Date().toISOString();
  const writes: Record<string, Job> = {};
  const seen = new Set<string>();
  let added = 0;
  for (const l of listings) {
    const id = jobId(l.url, l.company_name, l.title);
    if (seen.has(id)) continue;
    seen.add(id);
    const prev = existing[id];
    if (prev) continue;
    const role = l.title.trim().slice(0, 200);
    const company = l.company_name.trim().slice(0, 120);
    writes[id] = {
      id,
      company,
      role,
      url: l.url,
      tier: tierFor(company, role),
      source: "Simplify list",
      location: (l.locations ?? []).slice(0, 3).join(" · ").slice(0, 160) || undefined,
      category: l.category,
      score: scoreFor(role, l.category),
      postedAt: l.date_posted ? new Date(l.date_posted * 1000).toISOString() : undefined,
      foundAt: now,
      status: "new",
      resume: resumeFor(role),
    };
    added++;
  }
  await hashSet(JOBS_KEY, writes);
  // Closed postings nobody touched leave the list.
  const stale = Object.values(existing)
    .filter((j) => j.source === "Simplify list" && j.status === "new" && !seen.has(j.id))
    .map((j) => j.id);
  await hashDelete(JOBS_KEY, stale);
  await setJSON(META_KEY, { lastSearchAt: now, lastSearchFound: seen.size } satisfies JobsMeta);
  return { found: seen.size, added, removed: stale.length };
}

export async function noteSearchError(err: unknown): Promise<void> {
  const meta = await jobsMeta();
  await setJSON(META_KEY, { ...meta, lastSearchError: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200) });
}

/* --------------------------------------------------------------- email */

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function b64url(s: string): string {
  return Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Emails Jibran's personal Gmail (from itself) about applications that just
 * became ready. Needs the personal account connected with send access.
 * Returns a plain note for the run log.
 */
export async function emailReady(origin: string): Promise<string> {
  const jobs = (await allJobs()).filter((j) => READY.includes(j.status) && !j.notifiedAt);
  if (!jobs.length) return "Nothing new to email";
  const accounts = await listAccounts();
  const me = accounts.find((a) => /@(gmail|googlemail)\.com$/i.test(a.email)) ?? accounts[0];
  if (!me || me.email === "primary") return "No personal Gmail connected";
  const total = (await allJobs()).filter((j) => READY.includes(j.status)).length;
  const fmtDate = (d?: string) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: TIMEZONE }) : "rolling");
  const rows = jobs
    .slice(0, 25)
    .map(
      (j) =>
        `<tr><td style="padding:6px 12px 6px 0"><b>${esc(j.company)}</b><br>${esc(j.role)}</td><td style="padding:6px 12px 6px 0;color:#666">${fmtDate(j.deadline)}</td><td style="padding:6px 0;color:#666">${j.status === "ready" ? "Filled, ready to submit" : "Answers ready to copy"}</td></tr>`,
    )
    .join("");
  const page = `${origin}/#jobs`;
  const subject = `${jobs.length} new application${jobs.length === 1 ? "" : "s"} ready for you`;
  const html = `<div style="font-family:system-ui,sans-serif;font-size:14px;color:#111">
<p>${jobs.length} new application${jobs.length === 1 ? " is" : "s are"} ready to review and submit (${total} waiting in all).</p>
<table style="border-collapse:collapse">${rows}</table>
${jobs.length > 25 ? `<p>…and ${jobs.length - 25} more.</p>` : ""}
<p><a href="${page}">Open Job applications in Mission Control</a></p>
<p style="color:#888;font-size:12px">Nothing was submitted. Read each one over, then press Submit yourself.</p></div>`;
  const raw = [
    `From: Mission Control <${me.email}>`,
    `To: ${me.email}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`,
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    "",
    html,
  ].join("\r\n");
  try {
    await google(me, "/gmail/v1/users/me/messages/send", { method: "POST", body: { raw: b64url(raw) } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/403|insufficient|scope/i.test(msg)) return "Email not sent: sign in to your personal Google account again on the Inbox tab so the dashboard can send email";
    return `Email not sent: ${msg.slice(0, 120)}`;
  }
  const now = new Date().toISOString();
  await hashSet(JOBS_KEY, Object.fromEntries(jobs.map((j) => [j.id, { ...j, notifiedAt: now }])));
  return `Emailed ${me.email} about ${jobs.length}`;
}
