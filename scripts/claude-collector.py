#!/usr/bin/env python3
"""
Collects Claude Code activity on this Mac and pushes it to Mission Control:
token usage per model, project and day (from ~/.claude/projects transcripts),
the local sessions as threads, and a flow chart per project from its git history.

Runs on a schedule (see install-collector.sh) and needs only python3 and git.
Configuration comes from the environment:
  MC_URL        https://your-app.vercel.app
  MC_TOKEN      the INGEST_TOKEN of your deployment
  MC_SCAN_DIRS  colon-separated folders whose sub-folders are projects (default ~/Projects:~/Documents/GitHub)
  MC_PINNED     comma-separated project names to show first (default "Solo Kitchen")
  MC_NAMES      folder=name aliases, e.g. "Solo=Solo Kitchen"
"""
import glob
import json
import os
import subprocess
import sys
import time
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone

HOME = os.path.expanduser("~")
CLAUDE_DIR = os.path.join(HOME, ".claude", "projects")
URL = os.environ.get("MC_URL", "").rstrip("/")
TOKEN = os.environ.get("MC_TOKEN", "")
SCAN_DIRS = [os.path.expanduser(d) for d in os.environ.get("MC_SCAN_DIRS", "~/Projects:~/Documents/GitHub").split(":") if d]
PINNED = {s.strip().lower() for s in os.environ.get("MC_PINNED", "Solo Kitchen").split(",") if s.strip()}
NAMES = {"Solo": "Solo Kitchen"}
for pair in os.environ.get("MC_NAMES", "").split(","):
    if "=" in pair:
        k, v = pair.split("=", 1)
        NAMES[k.strip()] = v.strip()

# USD per million tokens: input, output, cache read, cache write. Matched by substring, first wins.
PRICES = [
    ("fable-5", (10, 50, 0.25, 12.5)),
    ("mythos", (10, 50, 0.25, 12.5)),
    ("opus-5-5", (4, 20, 0.20, 5)),
    ("opus-5", (5, 25, 0.50, 6.25)),
    ("opus-4", (5, 25, 0.50, 6.25)),
    ("sonnet-5", (2, 10, 0.20, 2.5)),
    ("sonnet-4", (3, 15, 0.30, 3.75)),
    ("haiku-5", (0.1, 0.5, 0.01, 0.125)),
    ("haiku-4", (1, 5, 0.10, 1.25)),
]


def price(model):
    for key, p in PRICES:
        if key in model:
            return p
    return (5, 25, 0.5, 6.25)


def cost(model, inp, out, cr, cw):
    pi, po, pr, pw = price(model)
    return (inp * pi + out * po + cr * pr + cw * pw) / 1e6


def row():
    return {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "cost": 0.0, "messages": 0, "sessions": set()}


def add(r, model, u, session):
    inp, out = u.get("input_tokens", 0), u.get("output_tokens", 0)
    cr, cw = u.get("cache_read_input_tokens", 0), u.get("cache_creation_input_tokens", 0)
    r["input"] += inp
    r["output"] += out
    r["cacheRead"] += cr
    r["cacheWrite"] += cw
    r["cost"] += cost(model, inp, out, cr, cw)
    r["messages"] += 1
    r["sessions"].add(session)


def finish(r):
    out = {k: (round(v, 4) if k == "cost" else v) for k, v in r.items() if k != "sessions"}
    out["sessions"] = len(r["sessions"])
    return out


def local_day(ts):
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone().strftime("%Y-%m-%d")
    except Exception:
        return ts[:10]


def project_name(cwd):
    base = os.path.basename(cwd.rstrip("/")) or cwd
    return NAMES.get(base, base)


def read_transcripts():
    """Token usage and sessions from every Claude Code transcript on this Mac."""
    by_model, by_project, by_day = defaultdict(row), defaultdict(row), defaultdict(row)
    total = row()
    sessions = {}
    seen = set()
    since = None
    files = glob.glob(os.path.join(CLAUDE_DIR, "**", "*.jsonl"), recursive=True)
    for path in files:
        sid = os.path.splitext(os.path.basename(path))[0]
        mtime = os.path.getmtime(path)
        s = sessions.setdefault(sid, {"id": sid, "cwd": None, "title": None, "summary": None, "first": None, "last": None,
                                      "model": None, "tokens": 0, "cost": 0.0, "messages": 0, "mtime": 0})
        s["mtime"] = max(s["mtime"], mtime)
        try:
            with open(path, "r", encoding="utf-8", errors="replace") as f:
                for line in f:
                    try:
                        e = json.loads(line)
                    except Exception:
                        continue
                    if not isinstance(e, dict):
                        continue
                    if e.get("cwd") and not s["cwd"]:
                        s["cwd"] = e["cwd"]
                    ts = e.get("timestamp")
                    if ts:
                        s["first"] = min(s["first"] or ts, ts)
                        s["last"] = max(s["last"] or ts, ts)
                        since = min(since or ts, ts)
                    t = e.get("type")
                    if t == "summary" and e.get("summary"):
                        s["summary"] = e["summary"]
                    msg = e.get("message") if isinstance(e.get("message"), dict) else None
                    if t == "user" and msg and not s["title"] and not e.get("isMeta"):
                        c = msg.get("content")
                        text = c if isinstance(c, str) else " ".join(b.get("text", "") for b in c if isinstance(b, dict) and b.get("type") == "text") if isinstance(c, list) else ""
                        text = " ".join(text.split())
                        if text and not text.startswith("<"):
                            s["title"] = text[:80]
                    if t == "assistant" and msg and msg.get("usage"):
                        key = (msg.get("id"), e.get("requestId"))
                        if key in seen:
                            continue
                        seen.add(key)
                        model = msg.get("model") or "unknown"
                        if model == "<synthetic>":
                            continue
                        u = msg["usage"]
                        proj = project_name(s["cwd"] or e.get("cwd") or "Other")
                        add(by_model[model], model, u, sid)
                        add(by_project[proj], model, u, sid)
                        add(by_day[local_day(ts or "")], model, u, sid)
                        add(total, model, u, sid)
                        s["model"] = model
                        s["messages"] += 1
                        s["tokens"] += u.get("input_tokens", 0) + u.get("output_tokens", 0) + u.get("cache_read_input_tokens", 0) + u.get("cache_creation_input_tokens", 0)
                        s["cost"] += cost(model, u.get("input_tokens", 0), u.get("output_tokens", 0), u.get("cache_read_input_tokens", 0), u.get("cache_creation_input_tokens", 0))
        except OSError:
            continue
    tokens = {
        "since": since,
        "collectedAt": datetime.now(timezone.utc).isoformat(),
        "total": finish(total),
        "byModel": sorted([dict(model=m, **finish(r)) for m, r in by_model.items()], key=lambda r: -r["cost"]),
        "byProject": sorted([dict(project=p, **finish(r)) for p, r in by_project.items()], key=lambda r: -r["cost"]),
        "daily": [dict(date=d, input=r["input"] + r["cacheRead"] + r["cacheWrite"], output=r["output"], cost=round(r["cost"], 4), messages=r["messages"])
                  for d, r in sorted(by_day.items())][-60:],
    }
    return tokens, [s for s in sessions.values() if s["messages"]]


def git(path, *args):
    try:
        out = subprocess.run(["git", "-C", path, *args], capture_output=True, text=True, timeout=20)
        return out.stdout.strip() if out.returncode == 0 else None
    except Exception:
        return None


def repo_url(path):
    remote = git(path, "remote", "get-url", "origin") or ""
    remote = remote.strip()
    if remote.startswith("git@github.com:"):
        remote = "https://github.com/" + remote[len("git@github.com:"):]
    if remote.endswith(".git"):
        remote = remote[:-4]
    return remote if remote.startswith("https://github.com/") else None


def short(s, n=56):
    return s if len(s) <= n else s[: n - 1] + "…"


def project_graph(path, sessions_here):
    """Project → branches → commits, plus the Claude sessions that worked in it."""
    top = git(path, "rev-parse", "--show-toplevel")
    if not top:
        return None
    url = repo_url(top)
    name = project_name(top)
    pid = url[len("https://github.com/"):].lower() if url else "local:" + os.path.basename(top).lower()
    head = git(top, "rev-parse", "--abbrev-ref", "HEAD") or "main"
    default = "main" if git(top, "rev-parse", "--verify", "-q", "main") is not None else ("master" if git(top, "rev-parse", "--verify", "-q", "master") is not None else head)
    nodes = [{"id": pid, "kind": "project", "label": name, "url": url, "meta": os.path.basename(top)}]
    edges = []
    branches = (git(top, "for-each-ref", "--sort=-committerdate", "--format=%(refname:short)|%(committerdate:iso-strict)", "refs/heads", "--count=8") or "").splitlines()
    ordered = [default] + [b.split("|")[0] for b in branches if b.split("|")[0] != default]
    for i, b in enumerate(ordered[:8]):
        bid = f"{pid}:branch:{b}"
        rng = b if b == default else f"{default}..{b}"
        log = git(top, "log", rng, "-n", "12" if b == default else "6", "--format=%H|%s|%cI|%an") or ""
        commits = [l.split("|", 3) for l in log.splitlines() if l.count("|") >= 3]
        if b != default and not commits:
            continue
        merged = b != default and git(top, "merge-base", "--is-ancestor", b, default) is not None
        nodes.append({"id": bid, "kind": "branch", "label": b, "url": f"{url}/tree/{b}" if url else None,
                      "meta": "DEFAULT BRANCH" if b == default else ("MERGED" if merged else f"{len(commits)} AHEAD"),
                      "state": "done" if (b == default or merged) else "running" if b == head else "idle"})
        edges.append([pid, bid])
        for sha, subject, date, author in commits:
            cid = f"{pid}:commit:{sha[:7]}"
            nodes.append({"id": cid, "kind": "commit", "label": short(subject), "meta": f"{sha[:7]} · {date[:10]}", "state": "done",
                          "url": f"{url}/commit/{sha}" if url else None})
            edges.append([bid, cid])
    for s in sessions_here[:10]:
        nid = f"{pid}:session:{s['id']}"
        nodes.append({"id": nid, "kind": "session", "label": short(s["title"] or s["id"]), "meta": (s["last"] or "")[:10] + " · " + (s["model"] or ""), "state": s["state"]})
        edges.append([pid, nid])
    commits_total = git(top, "rev-list", "--count", "HEAD")
    last = git(top, "log", "-1", "--format=%cI") or None
    return {
        "id": pid, "name": name, "path": top, "repo": url[len("https://github.com/"):] if url else None, "url": url,
        "pinned": name.lower() in PINNED, "branch": head, "updatedAt": max([last or ""] + [s["last"] or "" for s in sessions_here]) or None,
        "stats": {"commits": int(commits_total) if commits_total and commits_total.isdigit() else None, "sessions": len(sessions_here),
                  "tokens": sum(s["tokens"] for s in sessions_here), "cost": round(sum(s["cost"] for s in sessions_here), 2)},
        "graph": {"nodes": [{k: v for k, v in n.items() if v is not None} for n in nodes], "edges": edges},
    }


def main():
    if not URL or not TOKEN:
        sys.exit("MC_URL and MC_TOKEN are required")
    tokens, sessions = read_transcripts()
    now = time.time()
    for s in sessions:
        age = now - s["mtime"]
        s["state"] = "running" if age < 180 else "idle" if age < 86400 else "done"
    sessions.sort(key=lambda s: s["mtime"], reverse=True)

    # Projects: every folder Claude worked in, plus the repos in the scan folders.
    roots = {}
    for s in sessions:
        if s["cwd"] and os.path.isdir(s["cwd"]):
            top = git(s["cwd"], "rev-parse", "--show-toplevel") or s["cwd"]
            roots.setdefault(top, []).append(s)
    for d in SCAN_DIRS:
        if os.path.isdir(d):
            for sub in sorted(os.listdir(d)):
                p = os.path.join(d, sub)
                if os.path.isdir(os.path.join(p, ".git")):
                    roots.setdefault(p, [])
    projects = []
    for top, here in roots.items():
        g = project_graph(top, here)
        if g:
            projects.append(g)
    projects.sort(key=lambda p: (not p["pinned"], p["updatedAt"] or ""), reverse=False)
    projects.sort(key=lambda p: p["updatedAt"] or "", reverse=True)
    projects.sort(key=lambda p: not p["pinned"])

    threads = [{
        "id": s["id"], "title": s["summary"] or s["title"] or s["id"], "project": project_name(s["cwd"] or "Other"),
        "state": s["state"], "step": f"{s['messages']} turns", "updatedAt": datetime.fromtimestamp(s["mtime"], timezone.utc).isoformat(),
        "origin": "mac", "model": s["model"], "tokens": s["tokens"], "cost": round(s["cost"], 2),
    } for s in sessions[:40]]

    body = json.dumps({"origin": "mac", "tokens": tokens, "projects": projects, "threads": threads}).encode()
    req = urllib.request.Request(f"{URL}/api/ingest/claude", data=body, method="POST",
                                 headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as res:
        print(res.status, res.read().decode()[:200])
    print(f"{len(sessions)} sessions, {len(projects)} projects, {tokens['total']['messages']} messages, ${tokens['total']['cost']:.2f} API-equivalent")


if __name__ == "__main__":
    main()
