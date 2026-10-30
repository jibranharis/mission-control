/** live: real data. off: not connected yet. demo: sample data (SAMPLE_DATA=1). */
export type SourceStatus = "live" | "off" | "demo" | "error";

export type TaskSource = "CANVAS" | "CAL" | "TODO" | "CLAUDE" | "GMAIL";

export interface TaskItem {
  id: string;
  title: string;
  meta: string;
  source: TaskSource;
  /** ISO timestamp the item is due, if it has one. */
  due?: string;
  dueToday: boolean;
  done: boolean;
  url?: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  kind: "class" | "gym" | "focus" | "other";
  url?: string;
}

export interface WeekDay {
  date: string;
  count: number;
}

export interface CanvasAssignment {
  id: string;
  title: string;
  course: string;
  due: string;
  points?: number;
  submitted: boolean;
  url?: string;
}

export interface CourseGrade {
  course: string;
  score: number | null;
}

export interface CanvasData {
  assignments: CanvasAssignment[];
  grades: CourseGrade[];
  updates: UpdateItem[];
}

export interface CalendarData {
  today: CalendarEvent[];
  week: WeekDay[];
}

export interface UpdateItem {
  id: string;
  at: string;
  source: "CANVAS" | "CLAUDE" | "GITHUB" | "GMAIL" | "CAL";
  text: string;
  url?: string;
}

export type ThreadState = "running" | "needs_you" | "done" | "failed" | "idle";

export interface ClaudeThread {
  id: string;
  title: string;
  project: string;
  state: ThreadState;
  step: string;
  /** 0 to 1 */
  progress?: number;
  url?: string;
  updatedAt?: string;
}

export interface GraphNode {
  id: string;
  kind: "agent" | "project" | "thread" | "subagent";
  label: string;
  state?: ThreadState;
  url?: string;
}

export interface ClaudeSnapshot {
  generatedAt: string;
  usage: {
    plan: string;
    session?: { pct: number; resetsAt?: string };
    weekly?: { pct: number; resetsAt?: string };
    byProject: { name: string; pct: number }[];
    /** Messages per day, oldest first. */
    daily: number[];
    estimated: boolean;
  };
  threads: ClaudeThread[];
  graph: { nodes: GraphNode[]; edges: [string, string][] };
  updates: UpdateItem[];
}

export interface GymDay {
  date: string;
  split: string;
  status: "done" | "today" | "planned" | "missed" | "rest";
}

export interface DashboardData {
  generatedAt: string;
  timezone: string;
  sources: Record<"calendar" | "gmail" | "canvas" | "claude", SourceStatus>;
  tasks: TaskItem[];
  calendar: CalendarData;
  canvas: CanvasData;
  claude: ClaudeSnapshot;
  updates: UpdateItem[];
  gym: GymDay[];
  notes: string;
}
