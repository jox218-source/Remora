import { randomUUID } from 'node:crypto';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { Store, redact } from './store.js';
import { Workspaces } from './workspace.js';
import { CodexProvider } from './providers/codex.js';
import { DemoProvider } from './providers/demo.js';
import {
  aliasSchema,
  planSchema,
  reviewSchema,
  validatePlan,
  type Account,
  type Approval,
  type MessageKind,
  type ProjectMessage,
  type MessageSender,
  type Plan,
  type Project,
  type Provider,
  type RunRequest,
} from './types.js';

const MAX_PROJECT_MESSAGES = 500;
const MAX_REPLY_DEPTH = 8;

export class Engine {
  readonly workspaces: Workspaces;
  readonly providers: Record<string, Provider>;
  readonly approvals = new Map<
    string,
    Approval & {
      resolve(decision: 'accept' | 'acceptForSession' | 'decline'): void;
    }
  >();
  private active = new Map<
    string,
    { account: string; projectId: string; controller: AbortController; done: Promise<void> }
  >();
  private ticking = false;
  private closing = false;
  private authBusy = new Set<string>();
  private statusBusy = new Set<string>();
  private statusOperations = new Map<string, Promise<Account>>();
  private loginPending = new Set<string>();
  private pendingProviderOperations = new Set<Promise<unknown>>();
  private epochs = new Map<string, number>();
  private recovering = false;
  private timer: NodeJS.Timeout;
  private nextAccountRefresh = 0;
  private trackProviderOperation<T>(operation: Promise<T>): Promise<T> {
    this.pendingProviderOperations.add(operation);
    operation.then(
      () => this.pendingProviderOperations.delete(operation),
      () => this.pendingProviderOperations.delete(operation),
    );
    return operation;
  }
  constructor(
    readonly store: Store,
    providers?: Record<string, Provider>,
  ) {
    this.workspaces = new Workspaces(store.home);
    this.providers = providers ?? {
      demo: new DemoProvider(),
      codex: new CodexProvider(
        store.home,
        (run, method, details) => this.requestApproval(run, method, details),
        (id, event) => {
          if (event === 'account/login/completed') {
            this.loginPending.delete(id);
            this.bump(id);
          }
          if (!this.loginPending.has(id)) void this.refreshAccount(id).catch(() => {});
        },
      ),
    };
    this.timer = setInterval(() => {
      void this.tick();
      if (Date.now() >= this.nextAccountRefresh) {
        this.nextAccountRefresh = Date.now() + 30_000;
        void this.refreshAccounts();
      }
    }, 250);
    this.timer.unref();
  }
  listProjects() {
    return this.store.list<Project>('projects');
  }
  project(id: string) {
    return this.store.get<Project>('projects', id);
  }
  account(id: string) {
    return this.store.get<Account>('accounts', id);
  }
  busyAccount(id: string) {
    return (
      this.authBusy.has(id) ||
      this.loginPending.has(id) ||
      this.account(id).status === 'quarantined' ||
      [...this.active.values()].some((a) => a.account === id)
    );
  }
  private bump(id: string) {
    this.epochs.set(id, (this.epochs.get(id) ?? 0) + 1);
  }
  save(project: Project) {
    this.store.put('projects', project);
  }
  addAccount(input: unknown) {
    const parsed = z
      .object({
        id: aliasSchema,
        provider: z.enum(['codex', 'demo']).default('codex'),
        model: z.string().min(1).max(100).optional(),
      })
      .parse(input);
    if (this.store.list<Account>('accounts').some((a) => a.id === parsed.id))
      throw new Error('Account alias already exists');
    const account: Account = {
      ...parsed,
      status: parsed.provider === 'demo' ? 'demo' : 'signed-out',
    };
    this.store.put('accounts', account);
    return account;
  }
  async refreshAccount(id: string) {
    if (this.closing) return this.account(id);
    const pending = this.statusOperations.get(id);
    if (pending) return pending;
    const operation = this.trackProviderOperation(this.refreshAccountImpl(id));
    this.statusOperations.set(id, operation);
    operation.then(
      () => this.statusOperations.delete(id),
      () => this.statusOperations.delete(id),
    );
    return operation;
  }
  private async refreshAccountImpl(id: string) {
    const account = this.account(id);
    if (
      this.authBusy.has(id) ||
      this.loginPending.has(id) ||
      this.statusBusy.has(id) ||
      account.status === 'quarantined'
    )
      return account;
    this.statusBusy.add(id);
    const epoch = this.epochs.get(id) ?? 0;
    try {
      const observed = await this.providers[account.provider].status(account);
      const bound = account.boundIdentity ?? account.identity;
      if (bound && observed.identity && bound.toLowerCase() !== observed.identity.toLowerCase()) {
        account.status = 'identity-mismatch';
        account.observedIdentity = observed.identity;
        account.usage = observed.usage;
        account.checkedAt = observed.checkedAt;
        this.store.log('account', `Identity mismatch for ${id}; explicit rebind required`);
      } else {
        Object.assign(account, observed);
        if (observed.identity && !account.boundIdentity) {
          account.boundIdentity = observed.identity;
          account.identity = observed.identity;
        }
      }
      const current = this.store.list<Account>('accounts').find((a) => a.id === id);
      if (!current || epoch !== (this.epochs.get(id) ?? 0) || current.status === 'quarantined')
        return current ?? { ...account, status: 'removed' };
      this.store.put('accounts', account);
      return account;
    } catch (error) {
      const current = this.store.list<Account>('accounts').find((a) => a.id === id);
      if (!current || epoch !== (this.epochs.get(id) ?? 0) || current.status === 'quarantined')
        return current ?? { ...account, status: 'removed' };
      account.status = 'unavailable';
      account.usage = null;
      this.store.log('account', error instanceof Error ? error.message : 'Account unavailable');
      this.store.put('accounts', account);
      return account;
    } finally {
      this.statusBusy.delete(id);
    }
  }
  async models(id: string) {
    if (this.closing) throw new Error('Remora is shutting down; retry after it starts again');
    return this.trackProviderOperation(this.modelsImpl(id));
  }
  private async modelsImpl(id: string) {
    const account = this.account(id);
    const provider = this.providers[account.provider];
    if (!provider.models) return [];
    return provider.models(account);
  }
  updateAccountModel(id: string, model?: string | null) {
    const account = this.account(id);
    if (
      this.authBusy.has(id) ||
      this.loginPending.has(id) ||
      account.status === 'quarantined' ||
      [...this.active.values()].some((active) => active.account === id)
    )
      throw new Error('Account is busy; wait for active work to finish');
    if (model != null && !model.trim()) throw new Error('Model must be a non-empty string');
    account.model = model == null ? undefined : model.trim();
    this.bump(id);
    this.store.put('accounts', account);
    this.store.log('account', `Updated model selection for ${id}`);
    return account;
  }
  private async refreshAccounts() {
    await Promise.allSettled(
      this.store.list<Account>('accounts').map((account) => this.refreshAccount(account.id)),
    );
  }
  async login(id: string) {
    if (this.closing) throw new Error('Remora is shutting down; retry after it starts again');
    return this.trackProviderOperation(this.loginImpl(id));
  }
  private async loginImpl(id: string) {
    if (this.busyAccount(id)) throw new Error('Account is busy');
    this.authBusy.add(id);
    this.bump(id);
    const account = this.account(id);
    account.status = 'authenticating';
    this.store.put('accounts', account);
    if (account.provider !== 'demo') this.loginPending.add(id);
    try {
      return await this.providers[account.provider].login(account);
    } catch (error) {
      this.loginPending.delete(id);
      throw error;
    } finally {
      this.authBusy.delete(id);
      if (!this.loginPending.has(id)) void this.refreshAccount(id).catch(() => {});
    }
  }
  async logout(id: string) {
    if (this.closing) throw new Error('Remora is shutting down; retry after it starts again');
    return this.trackProviderOperation(this.logoutImpl(id));
  }
  private async logoutImpl(id: string) {
    if (this.account(id).status === 'quarantined')
      throw new Error(
        'Account is quarantined; stop its provider processes and explicitly recover it first',
      );
    if (this.authBusy.has(id) || [...this.active.values()].some((a) => a.account === id))
      throw new Error('Account is busy; cancel its active work before logout');
    this.authBusy.add(id);
    this.loginPending.delete(id);
    this.bump(id);
    try {
      const account = this.account(id);
      await this.providers[account.provider].logout(account);
      account.status = 'signed-out';
      delete account.identity;
      delete account.usage;
      this.store.put('accounts', account);
    } finally {
      this.authBusy.delete(id);
    }
  }
  async removeAccount(id: string) {
    if (
      this.listProjects().some(
        (p) => !['accepted', 'cancelled'].includes(p.state) && [p.lead, ...p.workers].includes(id),
      )
    )
      throw new Error('Account is used by an unfinished project');
    await this.logout(id);
    this.bump(id);
    this.store.removeAccount(id);
  }
  async recoverAccount(id: string, confirmedStopped: boolean) {
    const account = this.account(id);
    if (!confirmedStopped || account.status !== 'quarantined')
      throw new Error(
        'Recovery requires a quarantined account and confirmation that its provider processes were stopped',
      );
    this.bump(id);
    account.status = 'signed-out';
    this.store.put('accounts', account);
    this.store.log('account', `User confirmed provider processes stopped and recovered ${id}`);
    return this.refreshAccount(id);
  }
  createProject(input: unknown): Project {
    const data = z
      .object({
        root: z.string().min(1),
        name: z.string().min(1).max(100),
        lead: aliasSchema,
        workers: z.array(aliasSchema).min(1),
        maxConcurrency: z.number().int().min(1).max(16).default(4),
        network: z.boolean().default(false),
        approvalPolicy: z.enum(['on-request', 'never']).default('on-request'),
      })
      .parse(input);
    [data.lead, ...data.workers].forEach((id) => this.account(id));
    const root = realpathSync(resolve(data.root));
    const project: Project = {
      ...data,
      root,
      id: randomUUID(),
      state: 'idle',
      goal: '',
      tasks: [],
      maxRevisions: 2,
      approvalPolicy: data.approvalPolicy,
      createdAt: new Date().toISOString(),
    };
    this.save(project);
    this.store.log('project', `Created ${project.name}`, project.id);
    return project;
  }
  private ensureMutable(project: Project) {
    if (!['idle', 'draft'].includes(project.state))
      throw new Error(
        'Plans can only be changed before approval; create a new project run for a changed goal',
      );
  }
  async plan(id: string, goal: string, imported?: Plan) {
    const project = this.project(id);
    this.ensureMutable(project);
    if (!goal.trim()) throw new Error('A project goal is required');
    project.goal = goal;
    this.workspaces.prepare(project);
    if (imported) {
      this.setPlan(project, imported);
      return;
    }
    if (this.busyAccount(project.lead) || this.active.size >= 4)
      throw new Error('Lead account or global capacity is busy; retry when available');
    project.state = 'planning';
    delete project.error;
    this.save(project);
    this.launch(`plan:${id}`, project, project.lead, async (signal) => {
      try {
        const output = await this.invoke(project, project.lead, {
          cwd: this.workspaces.directory(project, 'input'),
          readOnly: true,
          signal,
          role: 'planner',
          prompt: `Plan this project. Do not execute tasks. Use only the eligible account aliases. Return JSON matching the schema. Tasks must have explicit acceptance criteria and an acyclic dependency graph. Keep tasks small and avoid simultaneous edits to the same file.\nGOAL: ${goal}\nELIGIBLE_ACCOUNTS=${JSON.stringify(project.workers)}\nTasks may include research, writing, or coding. Each task runs in a separate workspace.`,
          schema: z.toJSONSchema(planSchema),
          onSession: (ref) => {
            const current = this.project(id);
            current.planningSession = ref;
            this.save(current);
          },
        });
        const current = this.project(id);
        if (current.state === 'planning') this.setPlan(current, JSON.parse(output));
      } catch (error) {
        this.failProject(id, error);
      }
    });
  }
  private setPlan(project: Project, plan: Plan) {
    project.plan = validatePlan(plan, project.workers);
    project.tasks = project.plan.tasks.map((t) => ({ ...t, status: 'pending', revision: 0 }));
    project.state = 'draft';
    this.save(project);
    this.store.log('plan', 'Plan ready for your approval', project.id);
  }
  approve(id: string) {
    const project = this.project(id);
    if (project.state !== 'draft' || !project.plan) throw new Error('No draft plan to approve');
    validatePlan(project.plan, project.workers);
    project.state = 'approved';
    this.save(project);
    this.store.log('approval', 'User approved the plan and configured workspace permissions', id);
    return project;
  }
  updateTeam(id: string, lead: string, workers: string[]) {
    const project = this.project(id);
    if (!['idle', 'draft', 'paused'].includes(project.state))
      throw new Error('Team changes are only allowed for idle, draft, or paused projects');
    if (
      project.state === 'paused' &&
      [...this.active.values()].some((active) => active.projectId === id)
    )
      throw new Error('Wait for active project work to settle before changing its team');
    const uniqueWorkers = [...new Set(workers)];
    if (!uniqueWorkers.length) throw new Error('Choose at least one worker account');
    this.account(lead);
    uniqueWorkers.forEach((account) => this.account(account));
    if (project.state === 'draft') {
      delete project.plan;
      project.tasks = [];
      project.state = 'idle';
      project.error = 'Team changed; create a new plan before running this project';
    } else if (project.state === 'paused') {
      const eligible = new Set(uniqueWorkers);
      const queued = project.tasks.filter((task) =>
        ['pending', 'review', 'reviewing', 'running', 'interrupted'].includes(task.status),
      );
      if (queued.some((task) => !eligible.has(task.account)))
        throw new Error('The new worker team does not include an account assigned to queued work');
    }
    project.lead = lead;
    project.workers = uniqueWorkers;
    this.save(project);
    this.store.log('team', `Updated project lead and worker team`, id);
    return project;
  }
  start(id: string) {
    const project = this.project(id);
    if (
      !['approved', 'paused'].includes(project.state) &&
      !(
        project.state === 'blocked' &&
        project.tasks.length &&
        project.tasks.every((t) => t.status === 'accepted')
      )
    )
      throw new Error('Approve a plan or resolve blocked tasks before starting');
    project.state = 'running';
    delete project.error;
    this.save(project);
    this.store.log('run', 'Dispatch enabled', id);
    void this.tick();
    return project;
  }
  pause(id: string) {
    const project = this.project(id);
    if (project.state !== 'running') throw new Error('Only running projects can be paused');
    project.state = 'paused';
    this.save(project);
    this.store.log('pause', 'New dispatch paused; active work may finish', id);
    return project;
  }
  cancel(id: string) {
    const project = this.project(id);
    if (['accepted', 'cancelled'].includes(project.state))
      throw new Error('Project is already closed');
    project.state = 'cancelled';
    project.tasks.forEach((t) => {
      if (t.status !== 'accepted') t.status = 'cancelled';
    });
    this.save(project);
    for (const active of this.active.values())
      if (active.projectId === id) active.controller.abort();
    this.store.log('cancel', 'Project cancelled; workspaces retained', id);
    return project;
  }
  retry(id: string, taskId: string) {
    const project = this.project(id);
    if (this.active.size && [...this.active.values()].some((a) => a.projectId === id))
      throw new Error('Wait for active project tasks to settle before retrying');
    const task = project.tasks.find((t) => t.id === taskId);
    if (
      !task ||
      !['blocked', 'interrupted', ...(project.state === 'blocked' ? ['accepted'] : [])].includes(
        task.status,
      )
    )
      throw new Error(
        'Choose a blocked/interrupted task, or an accepted task in a blocked assembly',
      );
    if (project.state === 'cancelled' || project.state === 'accepted')
      throw new Error('Create a new run for a closed project');
    const rework = task.status === 'accepted';
    if (rework) {
      const invalid = new Set([task.id]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const t of project.tasks)
          if (!invalid.has(t.id) && t.dependencies.some((id) => invalid.has(id))) {
            invalid.add(t.id);
            changed = true;
          }
      }
      for (const t of project.tasks)
        if (invalid.has(t.id)) {
          t.status = 'pending';
          delete t.result;
          t.feedback =
            'User requested rework after assembly failure. Resolve conflicting output paths and preserve unrelated work.';
          if (t.id !== task.id) t.revision++;
        }
    }
    task.status = task.result ? 'review' : 'pending';
    if (!task.result && task.workspace) task.revision += 1;
    task.feedback =
      task.feedback ??
      'User requested recovery of this attempt. Inspect existing output before repeating commands.';
    project.state = project.tasks.some((t) => ['blocked', 'interrupted'].includes(t.status))
      ? 'blocked'
      : 'paused';
    delete project.error;
    this.save(project);
    this.store.log('retry', 'User explicitly requested task recovery', id, taskId);
    return project;
  }
  private invoke(
    project: Project,
    accountId: string,
    options: Pick<RunRequest, 'cwd' | 'prompt' | 'readOnly' | 'signal' | 'onSession'> &
      Partial<RunRequest> & { role: 'planner' | 'worker' | 'reviewer' },
  ) {
    const account = this.account(accountId);
    return this.providers[account.provider]
      .run({
        ...options,
        projectId: project.id,
        account,
        network: project.network,
        approvalPolicy: project.approvalPolicy ?? 'on-request',
        onEvent: (message) =>
          this.store.log('provider', message, project.id, options.taskId, accountId),
        onIdentity: (identity, checkedAt) => {
          const current = this.project(project.id);
          const evidence = { account: accountId, identity, checkedAt, role: options.role };
          if (options.taskId) {
            const task = current.tasks.find((item) => item.id === options.taskId);
            if (task) {
              if (options.role === 'reviewer') task.reviewerIdentityEvidence = evidence;
              else task.workerIdentityEvidence = evidence;
            }
          } else current.planningIdentityEvidence = evidence;
          this.save(current);
        },
        sendProjectMessage: (input: unknown) =>
          this.sendAgentMessage(
            project.id,
            accountId,
            options.role === 'planner' || options.role === 'reviewer' ? 'lead' : 'worker',
            input,
          ),
        readProjectMessages: (after?: string) => this.messages(project.id, after),
      })
      .catch((error) => {
        if (error instanceof Error && error.message.includes('Unconfirmed provider shutdown')) {
          this.bump(accountId);
          const current = this.account(accountId);
          current.status = 'quarantined';
          this.store.put('accounts', current);
        }
        throw error;
      })
      .finally(() => {
        for (const approval of this.approvals.values())
          if (approval.projectId === project.id && approval.taskId === options.taskId)
            approval.resolve('decline');
      });
  }
  private launch(
    key: string,
    project: Project,
    account: string,
    work: (signal: AbortSignal) => Promise<void>,
  ) {
    const controller = new AbortController();
    const entry = { account, projectId: project.id, controller, done: Promise.resolve() };
    this.active.set(key, entry);
    entry.done = work(controller.signal)
      .catch((error) => this.failProject(project.id, error))
      .finally(() => {
        this.active.delete(key);
        void this.tick();
      });
  }
  private async tick() {
    if (this.ticking || this.closing || this.recovering) return;
    this.ticking = true;
    try {
      for (const project of this.listProjects().reverse()) {
        if (project.state !== 'running') continue;
        for (const message of this.store.messages(project.id))
          for (const recipient of message.recipients)
            if (recipient.status === 'queued')
              void this.dispatchProjectMessage(project.id, message.id, recipient.account);
        if (project.tasks.every((t) => t.status === 'accepted')) {
          try {
            this.workspaces.stage(project);
            project.state = 'ready';
            this.save(project);
            this.store.log(
              'ready',
              'Reviewed results assembled; waiting for your acceptance',
              project.id,
            );
          } catch (error) {
            this.failProject(project.id, error);
          }
          continue;
        }
        for (const candidate of [...project.tasks].sort(
          (a, b) => Number(b.status === 'review') - Number(a.status === 'review'),
        )) {
          const current = this.project(project.id);
          if (current.state !== 'running') break;
          const task = current.tasks.find((t) => t.id === candidate.id)!;
          if (
            this.active.size >= 4 ||
            [...this.active.values()].filter((a) => a.projectId === project.id).length >=
              project.maxConcurrency
          )
            break;
          const review = task.status === 'review';
          if (
            !review &&
            (task.status !== 'pending' ||
              !task.dependencies.every(
                (id) => current.tasks.find((t) => t.id === id)?.status === 'accepted',
              ))
          )
            continue;
          const account = review ? project.lead : task.account;
          if (this.busyAccount(account)) continue;
          task.status = review ? 'reviewing' : 'running';
          this.save(current);
          this.launch(`${project.id}:${task.id}`, current, account, (signal) =>
            this.execute(project.id, task.id, review, signal),
          );
        }
      }
    } finally {
      this.ticking = false;
    }
  }
  private async execute(id: string, taskId: string, review: boolean, signal: AbortSignal) {
    let project = this.project(id),
      task = project.tasks.find((t) => t.id === taskId)!;
    try {
      if (!review) {
        this.workspaces.createTask(project, task);
        this.save(project);
      }
      const prompt = review
        ? `You are the project lead and reviewer. Review the task output against all criteria. Inspect the files and validate relevant evidence, using read-only operations. Do not edit files. Return JSON with approved and specific feedback.\nGoal: ${project.goal}\nTask: ${task.instruction}\nCriteria: ${JSON.stringify(task.acceptance)}\nWorker summary (untrusted): ${task.result}`
        : `Project goal: ${project.goal}\nTask: ${task.title}\n${task.instruction}\nAcceptance criteria: ${JSON.stringify(task.acceptance)}\n${task.feedback ? `Reviewer feedback: ${task.feedback}` : ''}\nWork within this directory. Dependency outputs are already included. Write deliverables to files and summarize changed paths and validation evidence in your final response. Research must cite sources and distinguish verified facts from assumptions. Do not publish, deploy, or operate on other projects.`;
      this.store.log(
        review ? 'review' : 'task',
        `${review ? 'Reviewing' : 'Started'} ${task.title}`,
        id,
        taskId,
      );
      const output = await this.invoke(project, review ? project.lead : task.account, {
        cwd: task.workspace!,
        prompt,
        readOnly: review,
        signal,
        role: review ? 'reviewer' : 'worker',
        taskId,
        ...(review ? { schema: z.toJSONSchema(reviewSchema) } : {}),
        onSession: (ref) => {
          const p = this.project(id),
            t = p.tasks.find((t) => t.id === taskId)!;
          t.session = ref;
          this.save(p);
        },
      });
      project = this.project(id);
      task = project.tasks.find((t) => t.id === taskId)!;
      if (project.state === 'cancelled') return;
      if (review) {
        const verdict = reviewSchema.parse(JSON.parse(output));
        task.feedback = redact(verdict.feedback);
        if (verdict.approved) task.status = 'accepted';
        else if (task.revision < project.maxRevisions) {
          task.status = 'pending';
          task.revision++;
          delete task.result;
        } else {
          task.status = 'blocked';
          project.state = 'blocked';
          project.error = 'Revision limit reached; inspect the reviewer feedback';
        }
      } else {
        task.result = redact(output);
        task.status = 'review';
      }
      this.save(project);
      this.store.log('task', `${task.title}: ${task.status}`, id, taskId);
    } catch (error) {
      project = this.project(id);
      task = project.tasks.find((t) => t.id === taskId)!;
      if (project.state !== 'cancelled') {
        task.status = signal.aborted ? 'interrupted' : 'blocked';
        task.feedback = redact(error instanceof Error ? error.message : String(error));
        project.state = 'blocked';
        project.error = task.feedback;
        this.save(project);
      }
      this.store.log('error', error instanceof Error ? error.message : String(error), id, taskId);
    }
  }
  private failProject(id: string, error: unknown) {
    const project = this.project(id);
    if (project.state === 'cancelled') return;
    project.state = 'blocked';
    project.error = redact(error instanceof Error ? error.message : String(error));
    this.save(project);
    this.store.log('error', project.error, id);
  }
  requestApproval(
    run: RunRequest,
    method: string,
    details: unknown,
  ): Promise<'accept' | 'acceptForSession' | 'decline'> {
    return new Promise((resolve) => {
      const id = randomUUID();
      const abort = () => finish('decline');
      const finish = (decision: 'accept' | 'acceptForSession' | 'decline') => {
        this.approvals.delete(id);
        run.signal.removeEventListener('abort', abort);
        resolve(decision);
      };
      this.approvals.set(id, {
        id,
        projectId: run.projectId,
        taskId: run.taskId,
        account: run.account.id,
        method,
        details: JSON.parse(redact(JSON.stringify(details))),
        createdAt: new Date().toISOString(),
        resolve: finish,
      });
      run.signal.addEventListener('abort', abort, { once: true });
      if (run.signal.aborted) abort();
      this.store.log(
        'permission',
        `Waiting for user permission: ${method}`,
        run.projectId,
        run.taskId,
      );
    });
  }
  decide(id: string, decision: 'accept' | 'acceptForSession' | 'decline') {
    const approval = this.approvals.get(id);
    if (!approval) throw new Error('Approval is no longer pending');
    const available = (approval.details as { availableDecisions?: unknown }).availableDecisions;
    if (
      decision === 'acceptForSession' &&
      Array.isArray(available) &&
      !available.includes(decision)
    )
      throw new Error('The provider did not offer session approval for this request');
    approval.resolve(decision);
    this.store.log(
      'permission',
      `User ${decision === 'decline' ? 'declined' : decision === 'acceptForSession' ? 'approved provider requests for this task session' : 'approved one provider request'}`,
      approval.projectId,
      approval.taskId,
    );
  }
  async recover() {
    this.recovering = true;
    try {
      for (const project of this.listProjects()) {
        if (project.state === 'planning') {
          project.state = 'blocked';
          project.error =
            'Planning was interrupted. Inspect saved provider session; create a new project run if needed.';
        }
        for (const task of project.tasks) {
          if (!['running', 'reviewing'].includes(task.status)) continue;
          const wasReview = task.status === 'reviewing';
          task.status = 'interrupted';
          project.state = 'blocked';
          if (task.session) {
            try {
              const result = await this.providers[
                this.account(task.session.account).provider
              ].reconcile(task.session);
              if (result.status === 'completed' && result.output && !wasReview) {
                task.result = redact(result.output);
                task.status = 'review';
              } else
                task.feedback = `Recovered provider status: ${result.status}. Inspect the workspace before retrying.`;
            } catch {
              task.feedback =
                'Provider session could not be reconciled. Inspect the workspace before retrying.';
            }
          }
        }
        if (project.state === 'running') project.state = 'paused';
        if (
          project.state === 'blocked' &&
          project.tasks.length &&
          project.tasks.every((t) => !['blocked', 'interrupted'].includes(t.status))
        )
          project.state = 'paused';
        this.save(project);
      }
    } finally {
      this.recovering = false;
    }
  }
  results(id: string) {
    return this.workspaces.results(this.project(id));
  }
  messages(id: string, after?: string) {
    this.project(id);
    return this.store.messages(id, after);
  }
  private messageInput(input: unknown) {
    return z
      .object({
        recipients: z
          .array(z.union([aliasSchema, z.literal('user')]))
          .min(1)
          .max(8),
        content: z.string().trim().min(1).max(4000),
        kind: z.enum(['update', 'question', 'answer', 'blocker']).default('update'),
        replyTo: z.string().uuid().optional(),
        idempotencyKey: z.string().trim().min(1).max(120).optional(),
      })
      .parse(input);
  }
  private assertMessageRecipients(project: Project, recipients: string[]) {
    const members = new Set([project.lead, ...project.workers]);
    const unique = [...new Set(recipients)];
    if (unique.length !== recipients.length) throw new Error('Recipients must be unique');
    for (const recipient of recipients) {
      if (recipient === 'user') continue;
      if (!members.has(recipient))
        throw new Error(`Recipient is not a project member: ${recipient}`);
    }
    return unique;
  }
  private createProjectMessage(
    project: Project,
    input: unknown,
    sender: MessageSender,
  ): ProjectMessage {
    const data = this.messageInput(input);
    if (project.state === 'cancelled')
      throw new Error('Cannot send messages to a cancelled project');
    const history = this.store.messages(project.id);
    const duplicate = data.idempotencyKey
      ? history.find((message) => message.idempotencyKey === data.idempotencyKey)
      : undefined;
    if (duplicate) return duplicate;
    if (history.length >= MAX_PROJECT_MESSAGES)
      throw new Error(`Project conversation limit reached (${MAX_PROJECT_MESSAGES} messages)`);
    const recipients = this.assertMessageRecipients(project, data.recipients);
    if (recipients.includes('user') && sender.kind !== 'agent')
      throw new Error('Only an authenticated agent can address the user');
    if (data.replyTo) {
      const parent = history.find((message) => message.id === data.replyTo);
      if (!parent) throw new Error('Reply target does not belong to this project');
      let depth = 1;
      let current = parent;
      const seen = new Set<string>();
      while (current.replyTo && !seen.has(current.id)) {
        seen.add(current.id);
        const ancestor = history.find((message) => message.id === current.replyTo);
        if (!ancestor) break;
        depth++;
        current = ancestor;
      }
      if (depth >= MAX_REPLY_DEPTH)
        throw new Error(`Reply chain limit reached (${MAX_REPLY_DEPTH} messages)`);
    }
    if (data.replyTo && data.kind === 'answer' && sender.kind === 'agent') {
      const parent = history.find((message) => message.id === data.replyTo);
      if (parent) {
        this.store.updateMessage(parent.id, (current) => {
          const item = current.recipients.find((entry) => entry.account === sender.id);
          if (item) {
            item.status = 'answered';
            item.answeredAt = new Date().toISOString();
            item.reason = 'Answered by the authenticated project agent';
          }
        });
      }
    }
    const now = new Date().toISOString();
    const message: ProjectMessage = {
      id: randomUUID(),
      projectId: project.id,
      ...(data.idempotencyKey ? { idempotencyKey: data.idempotencyKey } : {}),
      sender,
      recipients: recipients.map((account) => ({
        account,
        status: account === 'user' ? 'delivered' : 'queued',
        reason:
          account === 'user'
            ? 'Displayed to the authenticated project user'
            : 'Queued; waiting for a provider that advertises project messaging',
        ...(account === 'user' ? { deliveredAt: now } : {}),
      })),
      content: redact(data.content).slice(0, 4000),
      kind: data.kind as MessageKind,
      ...(data.replyTo ? { replyTo: data.replyTo } : {}),
      createdAt: now,
    };
    const saved = this.store.putMessage(message);
    this.store.log('message', `Project message ${saved.id} created`, project.id);
    for (const recipient of saved.recipients)
      void this.dispatchProjectMessage(saved.projectId, saved.id, recipient.account);
    return saved;
  }
  sendProjectMessage(projectId: string, input: unknown) {
    return this.createProjectMessage(this.project(projectId), input, { kind: 'user', id: 'user' });
  }
  sendAgentMessage(projectId: string, account: string, role: 'lead' | 'worker', input: unknown) {
    const project = this.project(projectId);
    if (![project.lead, ...project.workers].includes(account))
      throw new Error('Agent is not a member of this project');
    if (role === 'lead' && project.lead !== account)
      throw new Error('Agent lead identity mismatch');
    if (role === 'worker' && project.lead === account && !project.workers.includes(account))
      throw new Error('Agent worker identity mismatch');
    return this.createProjectMessage(project, input, { kind: 'agent', id: account, role });
  }
  private async dispatchProjectMessage(projectId: string, id: string, recipient: string) {
    if (recipient === 'user') return;
    const project = this.project(projectId);
    if (project.state === 'cancelled') return;
    if (project.state === 'paused') {
      this.store.updateMessage(id, (current) => {
        const item = current.recipients.find((entry) => entry.account === recipient);
        if (item && item.status === 'queued')
          item.reason = 'Queued while the project is paused; no new provider turn was started';
      });
      return;
    }
    const message = this.store.messages(projectId).find((item) => item.id === id);
    if (!message) return;
    const delivery = message.recipients.find((item) => item.account === recipient);
    if (!delivery || delivery.status !== 'queued') return;
    const account = this.account(recipient);
    const provider = this.providers[account.provider];
    if (!provider.capabilities.projectMessaging || !provider.sendProjectMessage) return;
    this.store.updateMessage(id, (current) => {
      const item = current.recipients.find((entry) => entry.account === recipient);
      if (item) {
        item.status = 'sent';
        item.reason = 'Provider accepted the delivery request';
        item.sentAt = new Date().toISOString();
      }
    });
    try {
      const result = await provider.sendProjectMessage({
        projectId: message.projectId,
        message,
        recipient,
      });
      this.store.updateMessage(id, (current) => {
        const item = current.recipients.find((entry) => entry.account === recipient);
        if (!item) return;
        // A provider-level negative receipt means the recipient did not receive it. Keep it
        // queued for a later authenticated checkpoint; only an exception is terminal failure.
        item.status = result.delivered ? 'delivered' : 'queued';
        item.reason = result.reason;
        if (result.delivered) item.deliveredAt = new Date().toISOString();
      });
      if (result.answer?.content) {
        this.store.updateMessage(id, (current) => {
          const item = current.recipients.find((entry) => entry.account === recipient);
          if (item) {
            item.status = 'answered';
            item.answeredAt = new Date().toISOString();
          }
        });
        const project = this.project(message.projectId);
        const sender: MessageSender = {
          kind: 'agent',
          id: recipient,
          role: project.lead === recipient ? 'lead' : 'worker',
        };
        const answerRecipient = message.sender.kind === 'agent' ? message.sender.id : 'user';
        if (answerRecipient) {
          this.createProjectMessage(
            this.project(message.projectId),
            {
              recipients: [answerRecipient],
              content: result.answer.content,
              kind: result.answer.kind ?? 'answer',
              replyTo: message.id,
            },
            sender,
          );
        }
      }
    } catch (error) {
      this.store.updateMessage(id, (current) => {
        const item = current.recipients.find((entry) => entry.account === recipient);
        if (item) {
          item.status = 'failed';
          item.reason = redact(error instanceof Error ? error.message : String(error));
        }
      });
    }
  }
  accept(id: string) {
    const project = this.project(id);
    this.workspaces.accept(project);
    project.state = 'accepted';
    project.acceptedAt = new Date().toISOString();
    this.save(project);
    this.store.log('accepted', 'User accepted reviewed outputs into the project', id);
    return project;
  }
  demo() {
    for (const id of ['demo-one', 'demo-two']) {
      const existing = this.store.list<Account>('accounts').find((a) => a.id === id);
      if (existing && existing.provider !== 'demo')
        throw new Error(
          `Alias ${id} belongs to a real provider; rename/remove it before creating an offline demo`,
        );
      if (!existing) this.addAccount({ id, provider: 'demo' });
    }
    const root = join(this.store.home, 'demo-projects', randomUUID());
    mkdirSync(root, { recursive: true });
    writeFileSync(
      join(root, 'BRIEF.md'),
      '# Offline demonstration\n\nCreate research notes, an outline, and a report. All outputs must be labeled simulated.\n',
    );
    return this.createProject({
      root,
      name: 'A first coordinated project',
      lead: 'demo-one',
      workers: ['demo-one', 'demo-two'],
    });
  }
  snapshot() {
    return {
      accounts: this.store.list<Account>('accounts'),
      projects: this.listProjects(),
      approvals: [...this.approvals.values()].map(({ resolve: _resolve, ...a }) => a),
      events: this.store.recentLogs(),
    };
  }
  async close() {
    this.closing = true;
    clearInterval(this.timer);
    for (const active of this.active.values()) active.controller.abort();
    for (const approval of this.approvals.values()) approval.resolve('decline');
    await Promise.allSettled([...this.active.values()].map((a) => a.done));
    await Promise.allSettled([...this.pendingProviderOperations]);
    await Promise.allSettled(Object.values(this.providers).map((p) => p.close()));
  }
}
