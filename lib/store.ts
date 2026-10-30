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
} as const;
