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
  location?: string;
  /** Daily routine (prayer, meals, gym) rather than something to act on. */
  routine?: boolean;
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
  /** Where the thread ran: a cloud session (claude.ai) or Claude Code on the Mac. */
  origin?: "cloud" | "mac";
  model?: string;
  tokens?: number;
  cost?: number;
}

export type GraphNodeKind = "agent" | "project" | "thread" | "subagent" | "branch" | "commit" | "pr" | "session";

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  label: string;
  /** Small mono line under the label, e.g. a date or an author. */
  meta?: string;
  state?: ThreadState;
  url?: string;
}

/** Token counts for one slice of Claude Code usage (a model, a project, a day). */
export interface TokenRow {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** API-equivalent value in USD at list prices (a Pro plan isn't billed per token). */
  cost: number;
  messages: number;
  sessions?: number;
}

export interface TokenUsage {
  /** Earliest transcript included. */
  since?: string;
  collectedAt: string;
  total: TokenRow;
  byModel: (TokenRow & { model: string })[];
  byProject: (TokenRow & { project: string })[];
  /** Oldest first, one row per local day. */
  daily: { date: string; input: number; output: number; cost: number; messages: number }[];
}

/** A project Claude has worked on: a local repo, a GitHub repo, or both. */
export interface ClaudeProject {
  id: string;
  name: string;
  path?: string;
  repo?: string;
  url?: string;
  description?: string;
  language?: string;
  pinned?: boolean;
  branch?: string;
  updatedAt?: string;
  stats: { commits?: number; openPRs?: number; mergedPRs?: number; sessions?: number; tokens?: number; cost?: number };
  graph: { nodes: GraphNode[]; edges: [string, string][] };
}

export interface RepoCard {
  name: string;
  fullName: string;
  url: string;
  description?: string;
  language?: string;
  stars: number;
  pushedAt: string;
  private: boolean;
  homepage?: string;
  topics?: string[];
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
    /** Every limit bar shown on claude.ai's usage page, e.g. "Current session". */
    limits?: { label: string; pct: number; resetsAt?: string; resets?: string }[];
    /** Past readings of the session and weekly limits, oldest first. */
    history?: { at: string; session?: number; weekly?: number }[];
    /** When the usage numbers were read. */
    readAt?: string;
  };
  threads: ClaudeThread[];
  graph: { nodes: GraphNode[]; edges: [string, string][] };
  updates: UpdateItem[];
  /** Claude Code token usage from the Mac collector. */
  tokens?: TokenUsage;
  /** Every project, with its flow chart. */
  projects?: ClaudeProject[];
  /** GitHub repositories, for the showcase. */
  repos?: RepoCard[];
}

export interface GymDay {
  date: string;
  split: string;
  status: "done" | "today" | "planned" | "missed" | "rest";
}

export interface DashboardData {
  docket: import("@/lib/sources/docket").DocketView | null;
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
