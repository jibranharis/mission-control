/**
 * Tiny key-value store. Uses Upstash Redis over REST when configured
 * (Vercel's KV integration sets KV_REST_API_URL / KV_REST_API_TOKEN),
 * otherwise falls back to process memory, which is fine for local dev.
 */

const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;

const memory = new Map<string, string>();

export const storeIsPersistent = Boolean(url && token);

async function redis(command: (string | number)[]): Promise<unknown> {
  const res = await fetch(url!, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`store ${command[0]} failed: ${res.status}`);
  const body = (await res.json()) as { result: unknown };
  return body.result;
}

export async function getJSON<T>(key: string, fallback: T): Promise<T> {
  const raw = storeIsPersistent ? ((await redis(["GET", key])) as string | null) : memory.get(key) ?? null;
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function setJSON(key: string, value: unknown): Promise<void> {
  const raw = JSON.stringify(value);
  if (storeIsPersistent) await redis(["SET", key, raw]);
  else memory.set(key, raw);
}

export const KEYS = {
  todos: "mc:todos",
  done: "mc:done",
  notes: "mc:notes",
  claude: "mc:claude",
  canvas: "mc:canvas",
  docket: "mc:docket",
  usageHistory: "mc:usage-history",
  github: "mc:github",
  runs: "mc:runs",
  automations: "mc:automations",
  logins: "mc:logins",
} as const;

/* Hashes: one field per record, for collections too big to rewrite whole. */

const memoryHashes = new Map<string, Map<string, string>>();

export async function hashGetAll<T>(key: string): Promise<Record<string, T>> {
  const out: Record<string, T> = {};
  if (storeIsPersistent) {
    const flat = ((await redis(["HGETALL", key])) as string[] | null) ?? [];
    for (let i = 0; i + 1 < flat.length; i += 2) {
      try {
        out[flat[i]] = JSON.parse(flat[i + 1]) as T;
      } catch {
        /* skip a broken record */
      }
    }
  } else {
    for (const [k, v] of memoryHashes.get(key) ?? []) out[k] = JSON.parse(v) as T;
  }
  return out;
}

export async function hashGet<T>(key: string, field: string): Promise<T | null> {
  const raw = storeIsPersistent ? ((await redis(["HGET", key, field])) as string | null) : memoryHashes.get(key)?.get(field) ?? null;
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Writes many records, in chunks so no single request gets too big. */
export async function hashSet(key: string, records: Record<string, unknown>): Promise<void> {
  const entries = Object.entries(records);
  if (!storeIsPersistent) {
    const m = memoryHashes.get(key) ?? new Map<string, string>();
    for (const [k, v] of entries) m.set(k, JSON.stringify(v));
    memoryHashes.set(key, m);
    return;
  }
  for (let i = 0; i < entries.length; i += 200) {
    const cmd: string[] = ["HSET", key];
    for (const [k, v] of entries.slice(i, i + 200)) cmd.push(k, JSON.stringify(v));
    await redis(cmd);
  }
}

export async function hashDelete(key: string, fields: string[]): Promise<void> {
  if (!fields.length) return;
  if (!storeIsPersistent) {
    for (const f of fields) memoryHashes.get(key)?.delete(f);
    return;
  }
  for (let i = 0; i < fields.length; i += 500) await redis(["HDEL", key, ...fields.slice(i, i + 500)]);
}
