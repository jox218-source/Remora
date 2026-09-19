import { z } from 'zod';

export const aliasSchema = z
  .string()
  .regex(
    /^[a-z0-9][a-z0-9_-]{0,47}$/,
    'Use lowercase letters, digits, underscores or hyphens (1–48 characters)',
  )
  .refine(
    (value) => !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/.test(value),
    'Windows device names are reserved',
  );
export const taskSpecSchema = z.object({
  id: aliasSchema,
  title: z.string().min(1).max(200),
  instruction: z.string().min(1).max(20000),
  account: aliasSchema,
  dependencies: z.array(aliasSchema).max(50),
  acceptance: z.array(z.string().min(1)).min(1).max(20),
});
export const planSchema = z.object({
  summary: z.string().min(1),
  tasks: z.array(taskSpecSchema).min(1).max(50),
});
export const reviewSchema = z.object({ approved: z.boolean(), feedback: z.string().min(1) });
export type Plan = z.infer<typeof planSchema>;
export type TaskSpec = z.infer<typeof taskSpecSchema>;
export type Account = {
  id: string;
  provider: 'codex' | 'demo';
  model?: string;
  status: string;
  identity?: string;
  usage?: unknown;
  checkedAt?: string;
};
export type TaskStatus =
  | 'pending'
  | 'running'
  | 'review'
  | 'reviewing'
  | 'accepted'
  | 'blocked'
  | 'cancelled'
  | 'interrupted';
export type Task = TaskSpec & {
  status: TaskStatus;
  revision: number;
  workspace?: string;
  baseline?: Record<string, string>;
  gitBase?: string;
  result?: string;
  feedback?: string;
  session?: SessionRef;
};
export type SessionRef = { account: string; threadId: string; turnId?: string };
export type Project = {
  id: string;
  name: string;
  root: string;
  goal: string;
  lead: string;
  workers: string[];
  state:
    | 'idle'
    | 'planning'
    | 'draft'
    | 'approved'
    | 'running'
    | 'paused'
    | 'blocked'
    | 'ready'
    | 'accepted'
    | 'cancelled';
  plan?: Plan;
  tasks: Task[];
  maxConcurrency: number;
  maxRevisions: number;
  network: boolean;
  createdAt: string;
  error?: string;
  baseline?: Record<string, string>;
  baseCommit?: string;
  staging?: string;
  integrationBranch?: string;
  acceptedAt?: string;
  planningSession?: SessionRef;
};
export type Event = {
  id: number;
  time: string;
  projectId?: string;
  type: string;
  message: string;
  taskId?: string;
};
export type Approval = {
  id: string;
  projectId: string;
  taskId?: string;
  account: string;
  method: string;
  details: unknown;
  createdAt: string;
};
export interface RunRequest {
  projectId: string;
  taskId?: string;
  account: Account;
  cwd: string;
  prompt: string;
  readOnly: boolean;
  network: boolean;
  schema?: Record<string, unknown>;
  signal: AbortSignal;
  onSession(ref: SessionRef): void;
  onEvent(message: string): void;
}
export interface Provider {
  readonly capabilities: { version: 1; sessions: boolean; usage: boolean; approvals: boolean };
  status(account: Account): Promise<Partial<Account>>;
  login(account: Account): Promise<unknown>;
  logout(account: Account): Promise<void>;
  run(request: RunRequest): Promise<string>;
  reconcile(ref: SessionRef): Promise<{ status: string; output?: string }>;
  close(): Promise<void>;
}
export function validatePlan(plan: Plan, accounts: string[]): Plan {
  plan = planSchema.parse(plan);
  const ids = new Set(plan.tasks.map((t) => t.id));
  if (ids.size !== plan.tasks.length) throw new Error('Task IDs must be unique');
  const visited = new Set<string>(),
    visiting = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) throw new Error('Task dependencies contain a cycle');
    if (visited.has(id)) return;
    const task = plan.tasks.find((t) => t.id === id);
    if (!task) throw new Error(`Unknown dependency: ${id}`);
    if (!accounts.includes(task.account))
      throw new Error(`Account is not eligible: ${task.account}`);
    visiting.add(id);
    task.dependencies.forEach(visit);
    visiting.delete(id);
    visited.add(id);
  };
  plan.tasks.forEach((t) => visit(t.id));
  return plan;
}
