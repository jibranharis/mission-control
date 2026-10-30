/**
 * Sample data for trying the dashboard out (and for the README screenshot).
 * It is only shown when SAMPLE_DATA=1; otherwise a source that isn't
 * connected stays empty, so nothing on screen is ever made up.
 */
export const SAMPLE_DATA = process.env.SAMPLE_DATA === "1";

import type { CalendarData, CanvasData, ClaudeSnapshot, UpdateItem } from "@/lib/types";
import { dateKey, startOfDay } from "@/lib/time";

const at = (days: number, hours: number) => new Date(startOfDay(days).getTime() + hours * 3_600_000).toISOString();
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

export function demoCalendar(): CalendarData {
  return {
    today: [
      { id: "d-c1", title: "MAT 21C lecture", start: at(0, 9), end: at(0, 9.83), allDay: false, kind: "class" },
      { id: "d-c2", title: "ENG 35 discussion", start: at(0, 11), end: at(0, 11.83), allDay: false, kind: "class" },
      { id: "d-c3", title: "CHE 2B lab", start: at(0, 13.17), end: at(0, 16), allDay: false, kind: "class" },
      { id: "d-c4", title: "Leg day · ARC", start: at(0, 18.5), end: at(0, 19.75), allDay: false, kind: "gym" },
      { id: "d-c5", title: "Deep work: problem set", start: at(0, 20), end: at(0, 22), allDay: false, kind: "focus" },
    ],
    week: [3, 5, 2, 4, 1, 0, 2].map((count, i) => ({ date: dateKey(startOfDay(i)), count })),
  };
}

export function demoCanvas(): CanvasData {
  return {
    assignments: [
      { id: "d-a1", title: "Problem set 6", course: "ENG 35", due: at(0, 23.98), points: 40, submitted: false },
      { id: "d-a2", title: "Quiz 7: series and convergence", course: "MAT 21C", due: at(1, 11), points: 20, submitted: false },
      { id: "d-a3", title: "Lab report 4 draft", course: "CHE 2B", due: at(2, 23.98), points: 50, submitted: false },
      { id: "d-a4", title: "Reflection essay", course: "UWP 1", due: at(4, 23.98), points: 25, submitted: false },
      { id: "d-a5", title: "Midterm 2", course: "MAT 21C", due: at(6, 10), points: 100, submitted: false },
    ],
    grades: [
      { course: "MAT 21C", score: 91.2 },
      { course: "ENG 35", score: 87.4 },
      { course: "CHE 2B", score: 84.1 },
      { course: "UWP 1", score: 95 },
    ],
    updates: [
      { id: "d-u1", at: ago(35), source: "CANVAS", text: "Grade posted: CHE 2B Lab 3, 46/50" },
      { id: "d-u5", at: ago(360), source: "CANVAS", text: "New assignment: UWP 1 reflection essay" },
    ],
  };
}

export function demoGmail(): UpdateItem[] {
  return [{ id: "d-u4", at: ago(200), source: "GMAIL", text: "Club treasurer: budget sheet needs sign-off" }];
}

export function demoClaude(): ClaudeSnapshot {
  return {
    generatedAt: new Date().toISOString(),
    usage: {
      plan: "Pro",
      session: { pct: 62, resetsAt: new Date(Date.now() + 108 * 60_000).toISOString() },
      weekly: { pct: 38 },
      byProject: [
        { name: "Solo Kitchen", pct: 46 },
        { name: "Dashboard for Life", pct: 22 },
        { name: "Coursework", pct: 20 },
        { name: "Other chats", pct: 12 },
      ],
      daily: [22, 30, 18, 41, 36, 12, 8, 26, 44, 39, 51, 33, 47, 58],
      estimated: true,
    },
    threads: [
      { id: "sk1", title: "Onboarding flow redesign", project: "Solo Kitchen", state: "needs_you", step: "Waiting on your review", progress: 0.8 },
      { id: "sk2", title: "Recipe import API", project: "Solo Kitchen", state: "running", step: "Running tests with 3 sub-agents", progress: 0.55 },
      { id: "d1", title: "Build life command dashboard", project: "Dashboard for Life", state: "running", step: "Building v1", progress: 0.3 },
      { id: "sk3", title: "Pricing page copy", project: "Solo Kitchen", state: "done", step: "Finished 2h ago", progress: 1 },
    ],
    graph: {
      nodes: [
        { id: "hub", kind: "agent", label: "Coordinator" },
        { id: "sk", kind: "project", label: "Solo Kitchen" },
        { id: "dfl", kind: "project", label: "Dashboard for Life" },
        { id: "sk1", kind: "thread", label: "Onboarding flow", state: "needs_you" },
        { id: "sk2", kind: "thread", label: "Recipe import API", state: "running" },
        { id: "sk3", kind: "thread", label: "Pricing copy", state: "done" },
        { id: "sk4", kind: "subagent", label: "Test runner", state: "running" },
        { id: "d1", kind: "thread", label: "Command dashboard", state: "running" },
        { id: "d2", kind: "subagent", label: "Canvas sync" },
        { id: "d3", kind: "subagent", label: "Calendar sync" },
      ],
      edges: [
        ["hub", "sk"],
        ["hub", "dfl"],
        ["sk", "sk1"],
        ["sk", "sk2"],
        ["sk", "sk3"],
        ["sk2", "sk4"],
        ["dfl", "d1"],
        ["d1", "d2"],
        ["d1", "d3"],
      ],
    },
    updates: [
      { id: "d-u2", at: ago(55), source: "CLAUDE", text: "Pricing page copy finished in Solo Kitchen" },
      { id: "d-u3", at: ago(130), source: "GITHUB", text: "PR opened: onboarding flow v2" },
    ],
  };
}

export const emptyCalendar = (): CalendarData => ({
  today: [],
  week: Array.from({ length: 7 }, (_, i) => ({ date: dateKey(startOfDay(i)), count: 0 })),
});

export const emptyCanvas = (): CanvasData => ({ assignments: [], grades: [], updates: [] });

export const emptyClaude = (): ClaudeSnapshot => ({
  generatedAt: new Date().toISOString(),
  usage: { plan: "Pro", byProject: [], daily: [], estimated: true },
  threads: [],
  graph: { nodes: [], edges: [] },
  updates: [],
});
