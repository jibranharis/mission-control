/**
 * Life data that only lives in Mission Control: projects with their own
 * to-do lists, the study log and the plan of when things get done.
 * Each collection is one Redis key, read and replaced whole by /api/life.
 */

export interface ProjectTask {
  id: string;
  title: string;
  done: boolean;
  /** Local date (YYYY-MM-DD). */
  due?: string;
  createdAt: string;
}

export interface LifeProject {
  id: string;
  name: string;
  blurb?: string;
  tasks: ProjectTask[];
}

export interface StudySession {
  id: string;
  subject: string;
  minutes: number;
  /** Local date (YYYY-MM-DD). */
  date: string;
  note?: string;
}

export interface StudyData {
  sessions: StudySession[];
  /** Weekly goal in minutes, by subject. */
  goals: Record<string, number>;
  /** Subjects added by hand, on top of the synced courses. */
  subjects: string[];
  /** A running timer, shared by laptop and phone. */
  timer?: { subject: string; startedAt: string } | null;
}

export interface PlanBlock {
  id: string;
  title: string;
  /** Local date (YYYY-MM-DD) it is planned for. */
  date: string;
  /** Optional start time, "HH:MM". */
  time?: string;
  minutes?: number;
  /** What it plans: "docket:<id>", "docket:task:<id>" or "project:<projectId>:<taskId>". */
  ref?: string;
  done: boolean;
}

export interface LifeData {
  projects: LifeProject[];
  study: StudyData;
  plan: PlanBlock[];
}

export const LIFE_KEYS = {
  projects: "mc:life:projects",
  study: "mc:life:study",
  plan: "mc:life:plan",
} as const;

export const DEFAULT_PROJECTS: LifeProject[] = [
  { id: "burlap-and-barrel", name: "Burlap and Barrel", blurb: "", tasks: [] },
  { id: "school", name: "School", blurb: "Admin and logistics, not coursework", tasks: [] },
  { id: "apply", name: "Things to apply for", blurb: "Programs, jobs, internships, scholarships", tasks: [] },
  { id: "wizards", name: "Wizards project", blurb: "", tasks: [] },
];

export const DEFAULT_STUDY: StudyData = { sessions: [], goals: {}, subjects: [], timer: null };

export const DEFAULT_LIFE: LifeData = { projects: DEFAULT_PROJECTS, study: DEFAULT_STUDY, plan: [] };
