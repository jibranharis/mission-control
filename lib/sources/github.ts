import type { ClaudeProject, GraphNode, RepoCard } from "@/lib/types";
import { getJSON, setJSON, KEYS } from "@/lib/store";

/**
 * GitHub, read directly by the server. Public repositories need no token;
 * GITHUB_TOKEN (a fine-grained token with read access) adds private ones
 * and the pull requests and commits that make up each project's flow chart.
 */
const USERS = (process.env.GITHUB_USERS ?? "jibranharis,z57333").split(",").map((s) => s.trim()).filter(Boolean);
const TOKEN = process.env.GITHUB_TOKEN;
export const githubConfigured = USERS.length > 0;

const API = "https://api.github.com";
const TTL = TOKEN ? 10 * 60_000 : 30 * 60_000;
const GRAPH_REPOS = 12;

interface Cached {
  at: string;
  repos: RepoCard[];
  projects: ClaudeProject[];
}

async function gh<T>(path: string): Promise<T | null> {
  const res = await fetch(`${API}${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "mission-control",
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    },
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`github ${path}: ${res.status}`);
  return (await res.json()) as T;
}

interface ApiRepo {
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  pushed_at: string;
  private: boolean;
  fork: boolean;
  homepage: string | null;
  topics?: string[];
  default_branch: string;
}

interface ApiPull {
  number: number;
  title: string;
  html_url: string;
  state: "open" | "closed";
  merged_at: string | null;
  updated_at: string;
  user?: { login: string };
}

interface ApiCommit {
  sha: string;
  html_url: string;
  commit: { message: string; author: { date: string; name: string } };
}

async function reposFor(user: string): Promise<ApiRepo[]> {
  // With a token, /user/repos includes private repositories of the signed-in user.
  const mine = TOKEN ? await gh<{ login: string }>("/user").then((u) => u?.login === user).catch(() => false) : false;
  const path = mine ? "/user/repos?per_page=100&sort=pushed&affiliation=owner" : `/users/${user}/repos?per_page=100&sort=pushed`;
  return (await gh<ApiRepo[]>(path)) ?? [];
}

const short = (s: string, n = 56) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const day = (iso: string) => iso.slice(0, 10);

/** Project → pull requests (merged ones count as done) and the latest commits on the default branch. */
async function projectFor(r: ApiRepo): Promise<ClaudeProject> {
  const id = r.full_name.toLowerCase();
  const nodes: GraphNode[] = [{ id, kind: "project", label: r.name, url: r.html_url, meta: r.language ?? undefined }];
  const edges: [string, string][] = [];
  const stats: ClaudeProject["stats"] = {};
  const [pulls, commits] = await Promise.all([
    gh<ApiPull[]>(`/repos/${r.full_name}/pulls?state=all&per_page=20&sort=updated&direction=desc`).catch(() => null),
    gh<ApiCommit[]>(`/repos/${r.full_name}/commits?per_page=12&sha=${encodeURIComponent(r.default_branch)}`).catch(() => null),
  ]);
  if (pulls) {
    stats.openPRs = pulls.filter((p) => p.state === "open").length;
    stats.mergedPRs = pulls.filter((p) => p.merged_at).length;
    for (const p of pulls) {
      const nid = `${id}:pr:${p.number}`;
      nodes.push({
        id: nid,
        kind: "pr",
        label: short(p.title),
        meta: `#${p.number} · ${p.merged_at ? "MERGED " + day(p.merged_at) : p.state.toUpperCase()}`,
        state: p.merged_at ? "done" : p.state === "open" ? "needs_you" : "idle",
        url: p.html_url,
      });
      edges.push([id, nid]);
    }
  }
  if (commits) {
    const bid = `${id}:branch:${r.default_branch}`;
    nodes.push({ id: bid, kind: "branch", label: r.default_branch, url: `${r.html_url}/tree/${r.default_branch}`, meta: "LATEST COMMITS" });
    edges.push([id, bid]);
    for (const c of commits) {
      const nid = `${id}:commit:${c.sha.slice(0, 7)}`;
      nodes.push({ id: nid, kind: "commit", label: short(c.commit.message.split("\n")[0]), meta: `${c.sha.slice(0, 7)} · ${day(c.commit.author.date)}`, state: "done", url: c.html_url });
      edges.push([bid, nid]);
    }
  }
  return {
    id,
    name: r.name,
    repo: r.full_name,
    url: r.html_url,
    description: r.description ?? undefined,
    language: r.language ?? undefined,
    branch: r.default_branch,
    updatedAt: r.pushed_at,
    stats,
    graph: { nodes, edges },
  };
}

export async function fetchGitHub(): Promise<Cached | null> {
  if (!githubConfigured) return null;
  const cached = await getJSON<Cached | null>(KEYS.github, null);
  if (cached && Date.now() - new Date(cached.at).getTime() < TTL) return cached;
  try {
    const lists = await Promise.all(USERS.map(reposFor));
    const all = lists.flat().filter((r) => !r.fork);
    const repos: RepoCard[] = all.map((r) => ({
      name: r.name,
      fullName: r.full_name,
      url: r.html_url,
      description: r.description ?? undefined,
      language: r.language ?? undefined,
      stars: r.stargazers_count,
      pushedAt: r.pushed_at,
      private: r.private,
      homepage: r.homepage || undefined,
      topics: r.topics,
    }));
    // Flow charts need many requests, so only with a token and only for the most recent repos.
    const projects = TOKEN ? await Promise.all(all.slice(0, GRAPH_REPOS).map(projectFor)) : [];
    const fresh = { at: new Date().toISOString(), repos, projects };
    await setJSON(KEYS.github, fresh);
    return fresh;
  } catch (err) {
    console.error(err);
    return cached;
  }
}
