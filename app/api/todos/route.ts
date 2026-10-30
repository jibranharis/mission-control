import { NextResponse, type NextRequest } from "next/server";
import type { Todo } from "@/lib/aggregate";
import { getJSON, setJSON, KEYS } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { title?: string; due?: string };
  const title = body.title?.trim().slice(0, 200);
  if (!title) return NextResponse.json({ error: "title required" }, { status: 400 });
  const due = body.due && !Number.isNaN(Date.parse(body.due)) ? new Date(body.due).toISOString() : undefined;
  const todo: Todo = { id: `todo:${crypto.randomUUID()}`, title, due, createdAt: new Date().toISOString() };
  const todos = await getJSON<Todo[]>(KEYS.todos, []);
  await setJSON(KEYS.todos, [...todos, todo]);
  return NextResponse.json(todo, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  const todos = await getJSON<Todo[]>(KEYS.todos, []);
  await setJSON(KEYS.todos, todos.filter((t) => t.id !== id));
  return new NextResponse(null, { status: 204 });
}
