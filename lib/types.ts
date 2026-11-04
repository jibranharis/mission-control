/** live: real data. off: not connected yet. demo: sample data (SAMPLE_DATA=1). */
export type SourceStatus = "live" | "off" | "demo" | "error";

export type TaskSource = "CANVAS" | "CAL" | "TODO" | "CLAUDE" | "GMAIL" | "LOGIN" | "GYM" | "PLAN";

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
  description?: string;
  /** Google account and calendar the event lives on; set only for Google events. */
  account?: string;
  calendarId?: string;
  calendarName?: string;
  /** True when Mission Control can edit or delete it in Google Calendar. */
  editable?: boolean;
  /** One occurrence of a repeating event; edits change only this occurrence. */
  recurring?: boolean;
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
  /** Every event for the next two weeks, for picking another day on the schedule. */
  events?: CalendarEvent[];
}

export interface GoogleAccountStatus {
  email: string;
  label: string;
  status: "ok" | "reconnect";
  detail?: string;
  /** What went wrong on the last read of this account's mail or calendar, in plain words. */
  problem?: string;
}

/** A calendar item found in an email, ready to add with one click. */
export interface MailEvent {
  title: string;
  /** YYYY-MM-DD, local */
  date: string;
  /** HH:MM, local; absent for all-day. */
  start?: string;
  end?: string;
  allDay: boolean;
  location?: string;
}

export type MailState = "new" | "done" | "dismissed" | "added";

/** An email worth a look, with Claude's read of it. */
export interface MailAlert {
  id: string;
  account: string;
  accountLabel: string;
  from: string;
  subject: string;
  snippet: string;
  at: string;
  url: string;
  importance: "high" | "normal" | "low";
  category: "deadline" | "action" | "event" | "update" | "info";
  summary: string;
  action?: string;
  event?: MailEvent;
  /** "claude" when Claude triaged it, "rules" for the built-in fallback. */
  triagedBy: "claude" | "rules";
  state: MailState;
  /** Link to the calendar event made from this email. */
  eventUrl?: string;
}

export interface MailData {
  alerts: MailAlert[];
  accounts: GoogleAccountStatus[];
  /** Google OAuth client set up on the server (GOOGLE_CLIENT_ID / SECRET). */
  canConnect: boolean;
  /** ANTHROPIC_API_KEY set, so Claude reads the mail. */
  claude: boolean;
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
  /** Set while the session is stuck until you answer (state is then "needs_you"). */
  waiting?: ClaudeWait;
  /** Where a Mac session runs, so the dashboard can say how to get back to it. */
  app?: "desktop" | "terminal" | "vscode";
  cwd?: string;
}

export interface ClaudeWait {
  kind: "permission" | "question" | "plan" | "review";
  /** What it's waiting for, in plain words, e.g. "Needs your OK to run `npm test`". */
  text: string;
  since?: string;
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
  /** Claude Code usage in this project, from the Mac collector: what the flow chart is drawn from. */
  usage?: {
    total: TokenRow;
    byModel: (TokenRow & { model: string })[];
    /** Most expensive sessions first, each split by model. */
    sessions: { id: string; title: string; tokens: number; cost: number; byModel: Record<string, { tokens: number; cost: number }>; state?: ThreadState; updatedAt?: string }[];
  };
  /** Shown before any data arrives, e.g. a pinned project the collector hasn't reported yet. */
  placeholder?: boolean;
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
  mail: MailData;
  canvas: CanvasData;
  claude: ClaudeSnapshot;
  updates: UpdateItem[];
  gym: GymDay[];
  /** The split, the weekdays you lift and the workout log. */
  gymPlan: import("@/lib/gym").GymData;
  notes: string;
  /** Automations, their runs, and the logins they depend on. */
  ops: import("@/lib/ops").OpsView;
}
