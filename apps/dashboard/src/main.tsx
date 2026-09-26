import { FormEvent, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity,
  AlertCircle,
  ArrowRight,
  Check,
  ChevronRight,
  Clock3,
  CirclePlay,
  ClipboardList,
  CircleAlert,
  CircleCheck,
  Download,
  ExternalLink,
  FileText,
  FolderKanban,
  LayoutDashboard,
  Link2,
  LoaderCircle,
  LogIn,
  LogOut,
  Menu,
  MessageCircle,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Send,
  Sparkles,
  Terminal,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import './style.css';

type UsageWindow = { usedPercent?: number; resetsAt?: number; windowDurationMins?: number };
type AccountUsage = {
  rateLimitsByLimitId?: Record<string, UsageWindow>;
  rateLimits?: Record<string, UsageWindow> | UsageWindow;
};
type ModelOption = {
  id: string;
  model: string;
  displayName: string;
  description?: string;
  isDefault?: boolean;
};
type Account = {
  id: string;
  provider: 'codex' | 'demo';
  model?: string;
  status: string;
  identity?: string;
  authType?: string;
  boundIdentity?: string;
  observedIdentity?: string;
  usage?: AccountUsage | null;
  checkedAt?: string;
};
type Task = {
  id: string;
  title: string;
  instruction?: string;
  account?: string;
  dependencies?: string[];
  acceptance?: string[];
  status?: string;
  revision?: number;
  workspace?: string;
  feedback?: string;
  result?: string;
  session?: { account?: string; threadId?: string };
  workerIdentityEvidence?: { account: string; identity?: string; checkedAt: string; role: string };
  reviewerIdentityEvidence?: {
    account: string;
    identity?: string;
    checkedAt: string;
    role: string;
  };
};
type Project = {
  id: string;
  name: string;
  root: string;
  goal?: string;
  lead: string;
  workers: string[];
  state: string;
  plan?: { summary: string; tasks: Task[] };
  tasks: Task[];
  maxConcurrency: number;
  network: boolean;
  approvalPolicy?: 'on-request' | 'never';
  staging?: string;
  integrationBranch?: string;
  error?: string;
};
type Artifact = {
  path: string;
  size: number;
  text?: string;
  diff?: string;
  change?: 'added' | 'modified' | 'deleted' | 'unchanged';
};
type Approval = {
  id: string;
  projectId: string;
  taskId?: string;
  account: string;
  method: string;
  details: unknown;
};
type Event = {
  id?: number;
  time?: string;
  type?: string;
  message?: string;
  projectId?: string;
  account?: string;
};
type MessageStatus = 'queued' | 'sent' | 'delivered' | 'answered' | 'failed';
type ProjectMessageRecipient = {
  account: string;
  status: MessageStatus;
  reason?: string;
  sentAt?: string;
  deliveredAt?: string;
  answeredAt?: string;
};
type ProjectMessage = {
  id: string;
  projectId: string;
  sender: { kind: 'user'; id: 'user' } | { kind: 'agent'; id: string; role: 'lead' | 'worker' };
  recipients: ProjectMessageRecipient[];
  content: string;
  kind: 'update' | 'question' | 'answer' | 'blocker';
  replyTo?: string;
  createdAt: string;
};
type State = { accounts: Account[]; projects: Project[]; approvals: Approval[]; events: Event[] };

const emptyState: State = { accounts: [], projects: [], approvals: [], events: [] };
const api = async <T,>(url: string, init: RequestInit = {}): Promise<T> => {
  const response = await fetch(url, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
    ...init,
  });
  if (!response.ok) {
    const body = await response.text();
    let message = body || `${response.status} ${response.statusText}`;
    try {
      const parsed: unknown = JSON.parse(body);
      if (
        parsed &&
        typeof parsed === 'object' &&
        'error' in parsed &&
        typeof parsed.error === 'string'
      )
        message = parsed.error;
    } catch {
      // Non-JSON errors can come from an intermediary or an unavailable runtime.
    }
    throw new Error(message);
  }
  return response.status === 204 ? (undefined as T) : response.json();
};
const post = <T,>(url: string, body: unknown = {}) =>
  api<T>(url, { method: 'POST', body: JSON.stringify(body) });
const label = (value?: string) =>
  (value || 'unknown').replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

function App() {
  const [state, setState] = useState<State>(emptyState);
  const [view, setView] = useState<'overview' | 'accounts' | 'projects' | 'activity' | 'results'>(
    'overview',
  );
  const [selected, setSelected] = useState<string>();
  const [actionError, setActionError] = useState('');
  const [connectionError, setConnectionError] = useState('');
  const [busy, setBusy] = useState('');
  const [mobileNav, setMobileNav] = useState(false);
  const [runtimeConnected, setRuntimeConnected] = useState(false);
  const refresh = async (clearError = true) => {
    try {
      setState(await api<State>('/api/state'));
      setRuntimeConnected(true);
      setConnectionError('');
      if (clearError) setActionError('');
      return true;
    } catch (e) {
      setRuntimeConnected(false);
      setConnectionError(e instanceof Error ? e.message : 'Unable to load Remora state');
      return false;
    }
  };
  useEffect(() => {
    let cancelled = false;
    const initialize = async (token = '') => {
      try {
        if (token) await post('/api/session', { token });
        const loaded = !cancelled && (await refresh());
        if (token && loaded) history.replaceState(null, '', location.pathname + location.search);
      } catch (e) {
        if (!cancelled) setConnectionError(e instanceof Error ? e.message : 'Session setup failed');
      }
    };
    const readHashToken = () =>
      location.hash.startsWith('#token=') ? decodeURIComponent(location.hash.slice(7)) : '';
    const onHashChange = () => {
      const token = readHashToken();
      if (token) void initialize(token);
    };
    let timer: number | undefined;
    void initialize(readHashToken()).then(() => {
      if (!cancelled) timer = window.setInterval(() => void refresh(false), 2000);
    });
    window.addEventListener('hashchange', onHashChange);
    return () => {
      cancelled = true;
      window.removeEventListener('hashchange', onHashChange);
      if (timer) window.clearInterval(timer);
    };
  }, []);
  const selectedProject = state.projects.find((p) => p.id === selected) || state.projects[0];
  const act = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await action();
      await refresh(true);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setBusy('');
    }
  };
  const navigate = (next: typeof view) => {
    setView(next);
    setMobileNav(false);
  };
  const nav = [
    { id: 'overview', name: 'Overview', icon: LayoutDashboard },
    { id: 'accounts', name: 'Accounts', icon: Users },
    { id: 'projects', name: 'Projects & tasks', icon: FolderKanban },
    { id: 'results', name: 'Results', icon: FileText },
    { id: 'activity', name: 'Activity', icon: Activity },
  ];
  return (
    <div className="app-shell">
      <aside className={mobileNav ? 'sidebar open' : 'sidebar'}>
        <div className="brand">
          <span className="brand-mark">
            <Sparkles size={17} />
          </span>
          <span>remora</span>
          <button className="mobile-close" onClick={() => setMobileNav(false)}>
            <X size={18} />
          </button>
        </div>
        <div className="workspace-label">Workspace</div>
        <nav>
          {nav.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={view === item.id ? 'nav-item active' : 'nav-item'}
                onClick={() => navigate(item.id as typeof view)}
              >
                <Icon size={17} />
                <span>{item.name}</span>
                {item.id === 'projects' && state.projects.length > 0 && (
                  <span className="nav-count">{state.projects.length}</span>
                )}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="connection">
            <span className={runtimeConnected ? 'status-dot' : 'status-dot disconnected'} />
            {runtimeConnected ? 'Local runtime' : 'Runtime disconnected'}{' '}
            <span className="connected">{runtimeConnected ? 'connected' : 'offline'}</span>
          </div>
          <div className="user-card">
            <span className="avatar">
              <Terminal size={13} />
            </span>
            <div>
              <strong>Local workspace</strong>
              <small>Remora operator</small>
            </div>
            <MoreHorizontal size={16} />
          </div>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setMobileNav(true)}>
            <Menu size={20} />
          </button>
          <div className="breadcrumbs">
            <span>Workspace</span>
            <ChevronRight size={14} />
            <strong>
              {view === 'projects' && selectedProject ? selectedProject.name : label(view)}
            </strong>
          </div>
          <div className="top-actions">
            <button className="icon-button" onClick={() => act('refresh', refresh)} title="Refresh">
              <RefreshCw size={17} className={busy === 'refresh' ? 'spin' : ''} />
            </button>
            <span className="top-status">
              <span className="status-dot" />
              Local only
            </span>
          </div>
        </header>
        {(actionError || connectionError) && (
          <div className="error-banner">
            <AlertCircle size={18} />
            <span>
              {!runtimeConnected && connectionError && (
                <strong>Dashboard session required. </strong>
              )}
              {actionError || connectionError}
              {!runtimeConnected && connectionError && (
                <>
                  {' '}
                  Reopen the dashboard URL printed by <code>remora up</code> so this tab can
                  reconnect.
                </>
              )}
            </span>
            <button
              onClick={() => {
                setActionError('');
                setConnectionError('');
              }}
            >
              <X size={16} />
            </button>
          </div>
        )}
        <div className="content">
          {state.approvals.length > 0 && (
            <ApprovalBar approvals={state.approvals} projects={state.projects} act={act} />
          )}{' '}
          {view === 'overview' && (
            <Overview
              state={state}
              onNavigate={navigate}
              onDemo={() =>
                act('demo', async () => {
                  const result = await post<Project>('/api/demo');
                  setSelected(result.id);
                  setView('projects');
                })
              }
            />
          )}
          {view === 'accounts' && (
            <Accounts
              accounts={state.accounts}
              projects={state.projects}
              events={state.events}
              act={act}
              busy={busy}
            />
          )}{' '}
          {view === 'projects' && (
            <Projects
              state={state}
              selected={selectedProject!}
              setSelected={setSelected}
              act={act}
              busy={busy}
              onResults={(p) => {
                setSelected(p.id);
                setView('results');
              }}
            />
          )}{' '}
          {view === 'activity' && <ActivityView events={state.events} />}{' '}
          {view === 'results' && <Results project={selectedProject} />}
        </div>
      </main>
    </div>
  );
}

function Overview({
  state,
  onNavigate,
  onDemo,
}: {
  state: State;
  onNavigate: (v: any) => void;
  onDemo: () => void;
}) {
  const active = state.projects.filter((p) => ['running', 'planning'].includes(p.state)).length;
  const completed = state.projects.filter((p) => p.state === 'ready').length;
  const connected = state.accounts.filter((a) => a.status === 'connected').length;
  const demos = state.accounts.filter((a) => a.provider === 'demo').length;
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">LOCAL AI ORCHESTRATION</p>
          <h1>Your local workspace.</h1>
          <p className="subhead">
            Coordinate accounts, projects, and agent work from one calm workspace.
          </p>
        </div>
        <button className="button primary" onClick={() => onNavigate('projects')}>
          <Plus size={17} /> New project
        </button>
      </div>
      <section className="metric-grid">
        <Metric
          icon={FolderKanban}
          name="Projects"
          value={state.projects.length}
          note={state.projects.length ? `${active} running or planning` : 'Ready when you are'}
        />
        <Metric
          icon={Users}
          name="Connected accounts"
          value={connected + demos}
          note={`${connected} connected · ${demos} demo`}
        />
        <Metric
          icon={CirclePlay}
          name="Active runs"
          value={active}
          note={active ? 'Work in progress' : 'No runs in progress'}
        />
        <Metric icon={Check} name="Completed" value={completed} note="Projects ready" />
      </section>
      <div className="overview-grid">
        <section className="panel welcome-panel">
          <div className="panel-kicker">
            <Sparkles size={16} /> Getting started
          </div>
          <h2>Bring your local agents together.</h2>
          <p>
            Manage accounts and review project outputs locally. Task content is sent to the selected
            AI provider.
          </p>
          <div className="onboarding">
            <Step n="01" title="Connect an account" done={state.accounts.length > 0} />
            <Step n="02" title="Create a project" done={state.projects.length > 0} />
            <Step n="03" title="Plan, approve, run" done={state.projects.some((p) => p.plan)} />
          </div>
          <div className="welcome-actions">
            {!state.accounts.length && (
              <button className="button primary" onClick={() => onNavigate('accounts')}>
                Connect account <ArrowRight size={16} />
              </button>
            )}
            {!state.projects.length && (
              <button className="button secondary" onClick={onDemo}>
                Try a demo project
              </button>
            )}
          </div>
        </section>
        <section className="panel activity-panel">
          <div className="panel-title">
            <div>
              <span className="eyebrow">RECENT</span>
              <h3>Activity</h3>
            </div>
            <button className="text-button" onClick={() => onNavigate('activity')}>
              View all <ArrowRight size={14} />
            </button>
          </div>
          {state.events
            .slice(-5)
            .reverse()
            .map((e, i) => (
              <EventRow key={e.id || i} event={e} />
            ))}
          {!state.events.length && (
            <Empty
              icon={Activity}
              title="Nothing here yet"
              text="Events will appear as Remora coordinates your work."
            />
          )}
        </section>
      </div>
    </>
  );
}
function Metric({
  icon: Icon,
  name,
  value,
  note,
}: {
  icon: any;
  name: string;
  value: number;
  note: string;
}) {
  return (
    <div className="metric">
      <span className="metric-icon">
        <Icon size={18} />
      </span>
      <div>
        <div className="metric-name">{name}</div>
        <strong>{value}</strong>
        <small>{note}</small>
      </div>
    </div>
  );
}
function Step({ n, title, done }: { n: string; title: string; done: boolean }) {
  return (
    <div className={done ? 'step done' : 'step'}>
      <span>{done ? <Check size={13} /> : n}</span>
      <div>
        {title}
        <small>{done ? 'Complete' : 'Up next'}</small>
      </div>
    </div>
  );
}
function Empty({ icon: Icon, title, text }: { icon: any; title: string; text: string }) {
  return (
    <div className="empty">
      <Icon size={27} />
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}
function EventRow({ event }: { event: Event }) {
  return (
    <div className="event-row">
      <span className="event-icon">
        <Activity size={14} />
      </span>
      <div>
        <strong>{event.message || label(event.type) || 'Workspace event'}</strong>
        <small>
          {event.projectId ? `Project ${event.projectId} · ` : ''}
          {event.time ? new Date(event.time).toLocaleString() : 'Just now'}
        </small>
      </div>
    </div>
  );
}
function approvalAction(method: string) {
  if (method.includes('commandExecution')) return 'Run a command';
  if (method.includes('fileChange')) return 'Change a file';
  return 'Provider action';
}
function approvalDetails(details: unknown) {
  return typeof details === 'string' ? details : JSON.stringify(details, null, 2);
}
function approvalPaths(details: unknown) {
  if (!details || typeof details !== 'object') return [];
  const value = details as Record<string, unknown>;
  return ['cwd', 'path', 'file', 'grantRoot', 'root', 'scope'].flatMap((key) =>
    typeof value[key] === 'string' ? [value[key] as string] : [],
  );
}
function approvalScopeStatus(details: unknown, task?: Task) {
  const paths = approvalPaths(details);
  if (!task?.workspace || !paths.length) return 'unknown' as const;
  const workspaceRoot = task.workspace.replace(/[\\/]+$/, '').toLowerCase();
  for (const path of paths) {
    const isAbsolute =
      /^[a-z]:[\\/]/i.test(path) || path.startsWith('/') || path.startsWith('\\\\');
    if (!isAbsolute) return 'unknown' as const;
    const normalized = path.replace(/[\\/]+$/, '').toLowerCase();
    if (
      normalized !== workspaceRoot &&
      !normalized.startsWith(`${workspaceRoot}\\`) &&
      !normalized.startsWith(`${workspaceRoot}/`)
    )
      return 'outside' as const;
  }
  return 'inside' as const;
}
function ApprovalBar({
  approvals,
  projects,
  act,
}: {
  approvals: Approval[];
  projects: Project[];
  act: (k: string, fn: () => Promise<unknown>) => Promise<void>;
}) {
  const canAcceptForSession = (approval: Approval) => {
    const decisions =
      approval.details && typeof approval.details === 'object'
        ? (approval.details as { availableDecisions?: unknown }).availableDecisions
        : undefined;
    return Array.isArray(decisions) && decisions.includes('acceptForSession');
  };
  return (
    <section className="approval-bar">
      <div className="approval-heading">
        <ShieldCheck size={17} />
        <div>
          <strong>Approval required</strong>
          <small>Remora is waiting for a one-off provider decision.</small>
        </div>
      </div>
      {approvals.map((approval) => (
        <div className="approval-item" key={approval.id}>
          {(() => {
            const project = projects.find((candidate) => candidate.id === approval.projectId);
            const task = project?.tasks.find((candidate) => candidate.id === approval.taskId);
            const scopeStatus = approvalScopeStatus(approval.details, task);
            return (
              <>
                <div>
                  <small className="approval-project">{project?.name ?? 'Unknown project'}</small>
                  <strong>{approvalAction(approval.method)}</strong>
                  <small className="approval-context">
                    Account <b>{approval.account}</b>
                    {' · '}
                    Task <b>{task?.title ?? approval.taskId ?? 'Unknown task'}</b>
                  </small>
                  {scopeStatus === 'outside' && (
                    <p className="approval-warning">
                      Warning: this request reaches outside the assigned task workspace. Review the
                      scope before allowing it.
                    </p>
                  )}
                  {scopeStatus === 'unknown' && (
                    <p className="approval-warning approval-warning-unknown">
                      Scope could not be verified for this request. Review the technical details
                      before allowing it.
                    </p>
                  )}
                  <details className="approval-details">
                    <summary>Review technical details</summary>
                    <div className="approval-technical">
                      <div>Project ID: {approval.projectId}</div>
                      <pre>{approvalDetails(approval.details)}</pre>
                    </div>
                  </details>
                </div>
                <div className="approval-actions">
                  <button
                    className="button small secondary"
                    onClick={() =>
                      act(`decline-${approval.id}`, () =>
                        post(`/api/approvals/${encodeURIComponent(approval.id)}`, {
                          decision: 'decline',
                        }),
                      )
                    }
                  >
                    <X size={14} /> Decline
                  </button>
                  <button
                    className="button small primary"
                    onClick={() =>
                      act(`accept-${approval.id}`, () =>
                        post(`/api/approvals/${encodeURIComponent(approval.id)}`, {
                          decision: 'accept',
                        }),
                      )
                    }
                  >
                    <Check size={14} /> Allow once
                  </button>
                  {canAcceptForSession(approval) && (
                    <button
                      className="button small primary"
                      title="Allow matching requests for this provider task session only"
                      onClick={() =>
                        act(`session-${approval.id}`, () =>
                          post(`/api/approvals/${encodeURIComponent(approval.id)}`, {
                            decision: 'acceptForSession',
                          }),
                        )
                      }
                    >
                      <ShieldCheck size={14} /> Allow for this task
                    </button>
                  )}
                </div>
              </>
            );
          })()}
        </div>
      ))}
    </section>
  );
}
function usageText(usage?: AccountUsage | null) {
  if (!usage) return 'Usage unavailable';
  const source = usage.rateLimitsByLimitId || usage.rateLimits;
  if (!source) return 'Usage unavailable';
  const windows: Array<{ label: string; value: UsageWindow }> = [];
  const add = (label: string, value: unknown) => {
    if (value && typeof value === 'object') windows.push({ label, value: value as UsageWindow });
  };
  if (Array.isArray(source)) source.forEach((value, i) => add(`window ${i + 1}`, value));
  else
    Object.entries(source).forEach(([label, value]) => {
      if (value && typeof value === 'object' && ('primary' in value || 'secondary' in value))
        Object.entries(value).forEach(([nestedLabel, nestedValue]) =>
          add(nestedLabel, nestedValue),
        );
      else add(label, value);
    });
  const rendered = windows.flatMap(({ label, value }) => {
    if (typeof value.usedPercent !== 'number') return [];
    const remaining = Math.max(0, Math.min(100, 100 - value.usedPercent));
    const reset =
      typeof value.resetsAt === 'number'
        ? ` · resets ${new Date(value.resetsAt * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
        : '';
    return `${label}: ${Math.round(remaining)}% remaining${reset}`;
  });
  return rendered.length ? rendered.join(' · ') : 'Usage unavailable';
}

function AccountModelControl({
  account,
  act,
  busy,
}: {
  account: Account;
  act: (k: string, fn: () => Promise<unknown>) => Promise<void>;
  busy: string;
}) {
  const [models, setModels] = useState<ModelOption[]>([]);
  const [loading, setLoading] = useState(account.provider === 'codex');
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    if (account.provider !== 'codex') {
      setLoading(false);
      setModels([]);
      return;
    }
    setLoading(true);
    setError('');
    void api<unknown>(`/api/accounts/${encodeURIComponent(account.id)}/models`)
      .then((payload) => {
        if (cancelled) return;
        const values = Array.isArray(payload)
          ? payload
          : payload &&
              typeof payload === 'object' &&
              Array.isArray((payload as { models?: unknown }).models)
            ? (payload as { models: unknown[] }).models
            : [];
        setModels(
          values.flatMap((value) => {
            if (!value || typeof value !== 'object') return [];
            const model = value as Record<string, unknown>;
            if (typeof model.model !== 'string' || typeof model.id !== 'string') return [];
            return [
              {
                id: model.id,
                model: model.model,
                displayName:
                  typeof model.displayName === 'string' ? model.displayName : model.model,
                description: typeof model.description === 'string' ? model.description : '',
                isDefault: model.isDefault === true,
              },
            ];
          }),
        );
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Models unavailable');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [account.id, account.provider]);
  const modelOptions = models.length
    ? models
    : account.model
      ? [{ id: account.model, model: account.model, displayName: account.model }]
      : [];
  return (
    <label className="account-model">
      Model
      <select
        value={account.model ?? ''}
        disabled={loading || Boolean(error) || busy === `model-${account.id}`}
        title={error || undefined}
        onChange={(e) =>
          act(`model-${account.id}`, () =>
            post(`/api/accounts/${encodeURIComponent(account.id)}/settings`, {
              model: e.target.value || null,
            }),
          )
        }
      >
        <option value="">Provider default</option>
        {modelOptions.map((model) => (
          <option key={model.id} value={model.model}>
            {model.displayName}
            {model.isDefault ? ' (default)' : ''}
          </option>
        ))}
      </select>
      <small>
        {loading
          ? 'Loading provider models…'
          : error || 'Choose a provider model or use the default.'}
      </small>
    </label>
  );
}

function Accounts({
  accounts,
  projects,
  events,
  act,
  busy,
}: {
  accounts: Account[];
  projects: Project[];
  events: Event[];
  act: (k: string, fn: () => Promise<unknown>) => Promise<void>;
  busy: string;
}) {
  const [form, setForm] = useState({ id: '', provider: 'codex' });
  const [removeConfirm, setRemoveConfirm] = useState<string>();
  const identityCounts = new Map<string, number>();
  accounts.forEach((account) => {
    if (account.identity)
      identityCounts.set(account.identity, (identityCounts.get(account.identity) ?? 0) + 1);
  });
  const [login, setLogin] = useState<{
    id: string;
    authUrl?: string;
    verificationUrl?: string;
    userCode?: string;
  }>();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!form.id) return;
    act('add-account', async () => {
      await post('/api/accounts', form);
      setForm({ id: '', provider: 'codex' });
    });
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">ACCOUNTS</p>
          <h1>Connected accounts</h1>
          <p className="subhead">Keep your provider sessions close to the work they power.</p>
        </div>
        <button
          className="button primary"
          onClick={() =>
            document.getElementById('add-account')?.scrollIntoView({ behavior: 'smooth' })
          }
        >
          <Plus size={17} /> Add account
        </button>
      </div>
      <div className="account-grid">
        {accounts.map((a) => (
          <div className="panel account-card" key={a.id}>
            <div className="account-head">
              <span className={a.provider === 'demo' ? 'provider-badge demo' : 'provider-badge'}>
                {a.provider === 'demo' ? 'D' : 'C'}
              </span>
              <div>
                <h3>{a.id}</h3>
                <small>
                  {a.identity || 'Identity unknown'}
                  {a.model ? ` · ${a.model}` : ''}
                </small>
              </div>
              <span
                className={
                  a.status === 'connected' || a.status === 'ready' || a.provider === 'demo'
                    ? 'pill green'
                    : 'pill'
                }
              >
                {label(a.status)}
              </span>
            </div>
            <div className="account-meta">
              <span>
                <span className="status-dot" />{' '}
                {a.checkedAt
                  ? `Checked ${new Date(a.checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                  : 'Not checked'}
              </span>
              <span>{usageText(a.usage)}</span>
            </div>
            <AccountModelControl account={a} act={act} busy={busy} />
            {a.identity && identityCounts.get(a.identity)! > 1 && (
              <div className="account-warning">
                <AlertCircle size={13} /> Duplicate provider identity detected; do not run an
                independent-account pilot until aliases resolve to different identities.
              </div>
            )}
            {a.status === 'identity-mismatch' && (
              <div className="account-warning">
                <AlertCircle size={13} /> Provider identity changed from{' '}
                {a.boundIdentity ?? a.identity}
                to {a.observedIdentity ?? 'unknown'}; rebind explicitly before running.
              </div>
            )}
            <div className="account-activity">
              {projects
                .filter((project) => project.state === 'planning' && project.lead === a.id)
                .map((project) => (
                  <span key={`${project.id}-planning`}>Planning · {project.name}</span>
                ))}
              {projects
                .flatMap((project) =>
                  project.tasks
                    .filter(
                      (task) =>
                        (task.status === 'running' && task.account === a.id) ||
                        (task.status === 'reviewing' && project.lead === a.id) ||
                        (task.status === 'review' &&
                          (project.lead === a.id ||
                            ((task.account ?? task.session?.account) === a.id &&
                              project.lead !== a.id))),
                    )
                    .map((task) => ({ project, task })),
                )
                .slice(0, 2)
                .map(({ project, task }) => (
                  <span key={`${project.id}-${task.id}`}>
                    {task.status === 'reviewing'
                      ? 'Reviewing'
                      : task.status === 'review' && project.lead === a.id
                        ? 'Queued for review'
                        : task.status === 'review'
                          ? 'Work complete — awaiting lead review · available'
                          : 'Working on'}{' '}
                    <strong>{task.title}</strong> · {project.name}
                  </span>
                ))}
              {!projects.some(
                (project) =>
                  (project.state === 'planning' && project.lead === a.id) ||
                  project.tasks.some(
                    (task) =>
                      (task.status === 'running' && task.account === a.id) ||
                      (['reviewing', 'review'].includes(task.status || '') &&
                        (project.lead === a.id ||
                          (task.status === 'review' &&
                            (task.account ?? task.session?.account) === a.id))),
                  ),
              ) && <span>Idle · no active task</span>}
              {events
                .filter((event) => event.account === a.id && event.type === 'provider')
                .sort((left, right) => (left.id ?? 0) - (right.id ?? 0))
                .slice(-1)
                .map((event) => (
                  <span key={event.id}>Last action: {event.message}</span>
                ))}
            </div>
            <div className="card-actions">
              <button
                className="button small secondary"
                onClick={() =>
                  act(`refresh-${a.id}`, () =>
                    post(`/api/accounts/${encodeURIComponent(a.id)}/refresh`),
                  )
                }
              >
                <RefreshCw size={14} /> Refresh
              </button>
              <button
                className="button small secondary"
                onClick={() =>
                  act(`login-${a.id}`, async () =>
                    setLogin({
                      id: a.id,
                      ...(await post(`/api/accounts/${encodeURIComponent(a.id)}/login`)),
                    }),
                  )
                }
              >
                <LogIn size={14} /> Login
              </button>
              <button
                className="button small ghost"
                aria-label="Log out"
                onClick={() =>
                  act(`logout-${a.id}`, () =>
                    post(`/api/accounts/${encodeURIComponent(a.id)}/logout`),
                  )
                }
              >
                <LogOut size={14} />
              </button>
              <button
                className="button small danger"
                onClick={() => setRemoveConfirm(a.id)}
                disabled={busy === `remove-${a.id}`}
              >
                <X size={14} /> Remove account
              </button>
            </div>
          </div>
        ))}
        {!accounts.length && (
          <div className="panel empty-wide">
            <Empty
              icon={Users}
              title="No accounts connected"
              text="Add a Codex account or create a demo workspace to get moving."
            />
          </div>
        )}
      </div>
      <section className="panel add-account" id="add-account">
        <div>
          <span className="eyebrow">NEW CONNECTION</span>
          <h2>Add an account</h2>
          <p>Account credentials stay with the local runtime.</p>
        </div>
        <form onSubmit={submit}>
          <label>
            Account ID
            <input
              value={form.id}
              onChange={(e) => setForm({ ...form, id: e.target.value })}
              placeholder="personal-codex"
              pattern="[a-z0-9][a-z0-9_\-]{0,47}"
              maxLength={48}
              title="Use 1–48 lowercase letters, digits, underscores or hyphens; start with a letter or digit."
              aria-describedby="account-id-help"
              required
            />
            <span id="account-id-help" className="optional">
              A nickname, not your email. Use lowercase letters, numbers, underscores or hyphens.
            </span>
          </label>
          <label>
            Provider
            <select
              value={form.provider}
              onChange={(e) => setForm({ ...form, provider: e.target.value })}
            >
              <option value="codex">Codex</option>
              <option value="demo">Demo</option>
            </select>
          </label>
          <button className="button primary" disabled={busy === 'add-account'}>
            {busy === 'add-account' ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Plus size={16} />
            )}{' '}
            Add account
          </button>
        </form>
      </section>
      {login && (
        <div className="modal-backdrop">
          <div className="modal">
            <button className="modal-close" onClick={() => setLogin(undefined)}>
              <X size={17} />
            </button>
            <span className="modal-icon">
              <LogIn size={19} />
            </span>
            <h2>Continue sign-in</h2>
            <p>
              Open the provider page to finish signing in for <strong>{login.id}</strong>.
            </p>
            {login.userCode && <div className="code-box">{login.userCode}</div>}
            {(login.authUrl || login.verificationUrl) && (
              <a
                className="button primary"
                href={login.authUrl || login.verificationUrl}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink size={16} /> Open provider
              </a>
            )}
          </div>
        </div>
      )}
      {removeConfirm &&
        (() => {
          const account = accounts.find((candidate) => candidate.id === removeConfirm);
          if (!account) return null;
          return (
            <div className="modal-backdrop">
              <div className="modal">
                <button className="modal-close" onClick={() => setRemoveConfirm(undefined)}>
                  <X size={17} />
                </button>
                <span className="modal-icon">
                  <X size={19} />
                </span>
                <h2>Remove {account.id}?</h2>
                <p>
                  Remora will log out this local provider session and remove its local registration.
                  Your provider or cloud account will not be deleted.
                </p>
                <div className="modal-actions">
                  <button className="button secondary" onClick={() => setRemoveConfirm(undefined)}>
                    Keep account
                  </button>
                  <button
                    className="button danger"
                    disabled={busy === `remove-${account.id}`}
                    onClick={() => {
                      setRemoveConfirm(undefined);
                      void act(`remove-${account.id}`, () =>
                        post(`/api/accounts/${encodeURIComponent(account.id)}/remove`),
                      );
                    }}
                  >
                    Remove local account
                  </button>
                </div>
              </div>
            </div>
          );
        })()}
    </>
  );
}

function Projects({
  state,
  selected,
  setSelected,
  act,
  busy,
  onResults,
}: {
  state: State;
  selected?: Project;
  setSelected: (s: string) => void;
  act: (k: string, fn: () => Promise<unknown>) => Promise<void>;
  busy: string;
  onResults: (p: Project) => void;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [goal, setGoal] = useState(selected?.goal || '');
  const [form, setForm] = useState({
    name: '',
    root: '',
    lead: '',
    workers: [] as string[],
    network: false,
    approvalPolicy: 'on-request' as 'on-request' | 'never',
    maxConcurrency: 4,
  });
  useEffect(() => setGoal(selected?.goal || ''), [selected?.id, selected?.goal]);
  const create = (e: FormEvent) => {
    e.preventDefault();
    if (!form.workers.length && !form.lead) return;
    act('create-project', async () => {
      const p = await post<Project>('/api/projects', {
        ...form,
        workers: form.workers.length ? form.workers : [form.lead],
        maxConcurrency: Number(form.maxConcurrency),
      });
      setSelected(p.id);
      setCreateOpen(false);
    });
  };
  const toggleWorker = (id: string) =>
    setForm((f) => ({
      ...f,
      workers: f.workers.includes(id) ? f.workers.filter((w) => w !== id) : [...f.workers, id],
    }));
  const projectAction = (action: string) =>
    act(action, () => post(`/api/projects/${selected?.id}/${action}`));
  if (!selected && !createOpen)
    return (
      <>
        <div className="page-heading">
          <div>
            <p className="eyebrow">PROJECTS & TASKS</p>
            <h1>Workspaces for agent work.</h1>
            <p className="subhead">Plan a goal, review the draft, then run it with confidence.</p>
          </div>
          <button className="button primary" onClick={() => setCreateOpen(true)}>
            <Plus size={17} /> New project
          </button>
        </div>
        <div className="panel empty-large">
          <Empty
            icon={FolderKanban}
            title="No projects yet"
            text="Create a project or start the demo to see orchestration in action."
          />
          <div>
            <button className="button primary" onClick={() => setCreateOpen(true)}>
              Create project
            </button>
          </div>
        </div>
      </>
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">PROJECTS & TASKS</p>
          <h1>Projects & tasks</h1>
          <p className="subhead">Review plans, approve work, and watch agents move.</p>
        </div>
        <button className="button primary" onClick={() => setCreateOpen(true)}>
          <Plus size={17} /> New project
        </button>
      </div>
      <div className="project-layout">
        <div className="project-list panel">
          <div className="panel-title">
            <h3>Projects</h3>
            <span className="count">{state.projects.length}</span>
          </div>
          {state.projects.map((p) => (
            <button
              key={p.id}
              className={p.id === selected?.id ? 'project-list-item selected' : 'project-list-item'}
              onClick={() => setSelected(p.id)}
            >
              <span className="project-dot" />
              <span>
                <strong>{p.name}</strong>
                <small>
                  {label(p.state)} · {p.tasks?.length || p.plan?.tasks?.length || 0} tasks
                </small>
              </span>
              <ChevronRight size={15} />
            </button>
          ))}
        </div>
        {selected && (
          <ProjectDetail
            project={selected}
            accounts={state.accounts}
            goal={goal}
            setGoal={setGoal}
            act={act}
            busy={busy}
            onResults={onResults}
            projectAction={projectAction}
          />
        )}
      </div>
      {createOpen && (
        <div className="modal-backdrop">
          <div className="modal wide">
            <button className="modal-close" onClick={() => setCreateOpen(false)}>
              <X size={17} />
            </button>
            <span className="modal-icon">
              <FolderKanban size={19} />
            </span>
            <h2>Create a project</h2>
            <p>Set the local workspace and lead account for a new orchestration.</p>
            <form className="modal-form" onSubmit={create}>
              <label>
                Project name
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Release notes"
                  required
                />
              </label>
              <label>
                Root directory
                <input
                  value={form.root}
                  onChange={(e) => setForm({ ...form, root: e.target.value })}
                  placeholder="C:\\work\\project"
                  required
                />
              </label>
              <label>
                Lead and reviewer account
                <select
                  value={form.lead}
                  onChange={(e) => setForm({ ...form, lead: e.target.value })}
                  required
                >
                  <option value="">Select account</option>
                  {state.accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.id}
                    </option>
                  ))}
                </select>
              </label>
              <fieldset className="worker-picker">
                <legend>Worker accounts · grunt work</legend>
                <small>Choose one or more accounts for independent task execution.</small>
                {state.accounts.map((a) => (
                  <label key={a.id} className="check-label">
                    <input
                      type="checkbox"
                      checked={form.workers.includes(a.id)}
                      onChange={() => toggleWorker(a.id)}
                    />
                    {a.id}
                  </label>
                ))}
                {!state.accounts.length && <small>No accounts connected.</small>}
              </fieldset>
              <p className="assignment-summary">
                Lead/reviewer: <strong>{form.lead || 'Choose an account'}</strong> · Workers:{' '}
                <strong>
                  {form.workers.length ? form.workers.join(', ') : 'Choose at least one'}
                </strong>
              </p>
              <div className="form-row">
                <label>
                  Max concurrency
                  <input
                    type="number"
                    min="1"
                    max="16"
                    value={form.maxConcurrency}
                    onChange={(e) => setForm({ ...form, maxConcurrency: Number(e.target.value) })}
                  />
                </label>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={form.network}
                    onChange={(e) => setForm({ ...form, network: e.target.checked })}
                  />{' '}
                  Allow network access
                </label>
                <label>
                  Permission mode
                  <select
                    value={form.approvalPolicy}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        approvalPolicy: e.target.value as 'on-request' | 'never',
                      })
                    }
                  >
                    <option value="on-request">Ask when more access is needed</option>
                    <option value="never">Sandbox only — stop if more access is needed</option>
                  </select>
                </label>
              </div>
              <button
                className="button primary"
                disabled={busy === 'create-project' || form.workers.length === 0}
              >
                {busy === 'create-project' ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <Plus size={16} />
                )}{' '}
                Create project
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
function ProjectDetail({
  project,
  accounts,
  goal,
  setGoal,
  act,
  busy,
  onResults,
  projectAction,
}: {
  project: Project;
  accounts: Account[];
  goal: string;
  setGoal: (v: string) => void;
  act: (k: string, fn: () => Promise<unknown>) => Promise<void>;
  busy: string;
  onResults: (p: Project) => void;
  projectAction: (a: string) => void;
}) {
  const tasks = project.tasks || project.plan?.tasks || [];
  const planReady = Boolean(project.plan);
  const canRun = ['approved', 'paused'].includes(project.state);
  const [confirmAccept, setConfirmAccept] = useState(false);
  const [editingTeam, setEditingTeam] = useState(false);
  const [teamForm, setTeamForm] = useState({ lead: project.lead, workers: project.workers });
  const teamEditable = ['idle', 'draft', 'paused'].includes(project.state);
  useEffect(() => {
    setTeamForm({ lead: project.lead, workers: project.workers });
    setEditingTeam(false);
  }, [project.id, project.lead, project.workers.join(',')]);
  const toggleTeamWorker = (id: string) =>
    setTeamForm((current) => ({
      ...current,
      workers: current.workers.includes(id)
        ? current.workers.filter((worker) => worker !== id)
        : [...current.workers, id],
    }));
  const saveTeam = () => {
    if (!teamForm.lead || !teamForm.workers.length) return;
    void act('team', async () => {
      await post(`/api/projects/${project.id}/team`, teamForm);
      setEditingTeam(false);
    });
  };
  return (
    <div className="project-detail">
      <div className="detail-header">
        <div>
          <div className="detail-title">
            <span className="project-dot large" />
            <h2>{project.name}</h2>
            <span
              className={`pill ${project.state === 'ready' ? 'green' : project.state === 'failed' ? 'red' : ''}`}
            >
              {label(project.state)}
            </span>
          </div>
          <p className="path">
            <Terminal size={14} />
            {project.root}
          </p>
        </div>
        <div className="detail-actions">
          <button
            className="button small secondary"
            onClick={() =>
              document
                .getElementById('project-conversation')
                ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }
          >
            <MessageCircle size={14} /> Conversation
          </button>
          <button
            className="button small secondary"
            disabled={!teamEditable || busy === 'team'}
            title={
              teamEditable
                ? 'Edit the lead and worker accounts for future work'
                : 'Team changes are available before approval or after pausing'
            }
            onClick={() => setEditingTeam(true)}
          >
            <Users size={14} /> Edit team
          </button>
          {['running', 'paused'].includes(project.state) && (
            <button
              className="button small secondary"
              onClick={() => projectAction(project.state === 'running' ? 'pause' : 'resume')}
            >
              <Pause size={14} />
              {project.state === 'running' ? 'Pause' : 'Resume'}
            </button>
          )}
          {project.state === 'running' && (
            <button className="button small danger" onClick={() => projectAction('cancel')}>
              <X size={14} /> Cancel
            </button>
          )}
          {project.state === 'ready' && (
            <button className="button small primary" onClick={() => setConfirmAccept(true)}>
              <Check size={14} /> Accept results
            </button>
          )}
          {(project.state === 'blocked' || project.state === 'paused') &&
            project.tasks.some((t) => t.status === 'blocked' || t.status === 'interrupted') && (
              <button
                className="button small secondary"
                onClick={() => {
                  const task = project.tasks.find(
                    (t) => t.status === 'blocked' || t.status === 'interrupted',
                  );
                  if (task)
                    act('retry', () =>
                      post(`/api/projects/${project.id}/retry`, { taskId: task.id }),
                    );
                }}
              >
                <RotateCcw size={14} /> Retry
              </button>
            )}
          <button className="button small secondary" onClick={() => onResults(project)}>
            <FileText size={14} /> Results
          </button>
        </div>
      </div>
      <section className="panel goal-panel">
        <div className="panel-title">
          <div>
            <span className="eyebrow">PROJECT GOAL</span>
            <h3>What should Remora accomplish?</h3>
          </div>
          {project.plan && (
            <span className="pill green">
              <Check size={13} /> Plan ready
            </span>
          )}
        </div>
        {editingTeam && (
          <div className="team-editor">
            <div className="team-editor-heading">
              <div>
                <span className="eyebrow">TEAM ASSIGNMENT</span>
                <strong>Choose who plans, reviews, and executes this project.</strong>
              </div>
              <button className="button small ghost" onClick={() => setEditingTeam(false)}>
                Cancel
              </button>
            </div>
            <label>
              Lead and reviewer
              <select
                value={teamForm.lead}
                onChange={(e) => setTeamForm({ ...teamForm, lead: e.target.value })}
              >
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.id}
                  </option>
                ))}
              </select>
            </label>
            <fieldset className="team-worker-picker">
              <legend>Worker accounts</legend>
              {accounts.map((account) => (
                <label key={account.id} className="check-label">
                  <input
                    type="checkbox"
                    checked={teamForm.workers.includes(account.id)}
                    onChange={() => toggleTeamWorker(account.id)}
                  />
                  {account.id}
                </label>
              ))}
            </fieldset>
            <div className="team-editor-actions">
              <small>
                Changes apply to future work. A draft plan will need to be created again.
              </small>
              <button
                className="button small primary"
                disabled={!teamForm.lead || !teamForm.workers.length || busy === 'team'}
                onClick={saveTeam}
              >
                {busy === 'team' ? (
                  <LoaderCircle className="spin" size={14} />
                ) : (
                  <Check size={14} />
                )}{' '}
                Save team
              </button>
            </div>
          </div>
        )}
        {project.plan?.summary && <p className="plan-summary">{project.plan.summary}</p>}
        <textarea
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="Describe the outcome and any constraints..."
        />
        <div className="goal-footer">
          <span>
            {project.lead ? `Lead: ${project.lead}` : 'No lead assigned'} · {project.maxConcurrency}{' '}
            workers max · {project.network ? 'Network on' : 'Network off'} ·{' '}
            {project.approvalPolicy === 'never' ? 'Sandbox only' : 'Ask when more access is needed'}
          </span>
          <button
            className="button primary"
            disabled={!goal.trim() || busy === 'plan' || !['idle', 'draft'].includes(project.state)}
            onClick={() => act('plan', () => post(`/api/projects/${project.id}/plan`, { goal }))}
          >
            {busy === 'plan' ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}{' '}
            {planReady ? 'Regenerate plan' : 'Create plan'}
          </button>
        </div>
      </section>
      {project.error && (
        <div className="inline-error">
          <AlertCircle size={16} />
          {project.error}
        </div>
      )}
      <ProjectChat project={project} />
      <section className="panel task-panel">
        <div className="panel-title">
          <div>
            <span className="eyebrow">{planReady ? 'PLAN DRAFT' : 'TASKS'}</span>
            <h3>{tasks.length ? `${tasks.length} tasks` : 'No tasks yet'}</h3>
          </div>
          {planReady && project.state === 'draft' && (
            <button className="button primary" onClick={() => projectAction('approve')}>
              <ShieldCheck size={16} /> Approve plan
            </button>
          )}
          {canRun && (
            <button className="button primary" onClick={() => projectAction('run')}>
              <Play size={16} /> Run project
            </button>
          )}
        </div>
        {tasks.length ? (
          <div className="task-list">
            {tasks.map((task, i) => (
              <TaskRow key={task.id || i} task={task} index={i} />
            ))}
          </div>
        ) : (
          <Empty
            icon={ClipboardList}
            title="Plan your first task"
            text="Write a goal above and Remora will turn it into an inspectable task plan."
          />
        )}
      </section>
      {confirmAccept && (
        <div className="modal-backdrop">
          <div className="modal">
            <button className="modal-close" onClick={() => setConfirmAccept(false)}>
              <X size={17} />
            </button>
            <span className="modal-icon">
              <Check size={19} />
            </span>
            <h2>Accept results?</h2>
            <p>
              This will apply the staged files to the original project at{' '}
              <strong>{project.root}</strong> and mark <strong>{project.name}</strong> complete.
            </p>
            <div className="modal-actions">
              <button className="button secondary" onClick={() => setConfirmAccept(false)}>
                Go back
              </button>
              <button
                className="button primary"
                onClick={() => {
                  setConfirmAccept(false);
                  act('accept', () => post(`/api/projects/${project.id}/accept`));
                }}
              >
                Accept results
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
function ProjectChat({ project }: { project: Project }) {
  const members = [...new Set([project.lead, ...project.workers].filter(Boolean))];
  const [messages, setMessages] = useState<ProjectMessage[]>([]);
  const [recipient, setRecipient] = useState('all');
  const [kind, setKind] = useState<'update' | 'question' | 'blocker'>('question');
  const [content, setContent] = useState('');
  const [replyTo, setReplyTo] = useState<string>();
  const [threadRoot, setThreadRoot] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const messagesRef = useRef<ProjectMessage[]>([]);
  const cursorRef = useRef('');
  const lastFullSyncRef = useRef(0);

  const mergeMessages = (incoming: ProjectMessage[], replace = false) => {
    if (replace) {
      const next = incoming.slice(-80);
      messagesRef.current = next;
      setMessages(next);
      cursorRef.current = next.at(-1)?.id || '';
      return;
    }
    if (!incoming.length) return;
    setMessages((current) => {
      const byId = new Map(current.map((message) => [message.id, message]));
      incoming.forEach((message) => byId.set(message.id, message));
      const next = [...byId.values()]
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .slice(-80);
      messagesRef.current = next;
      cursorRef.current = next.at(-1)?.id || cursorRef.current;
      return next;
    });
  };

  const sync = async (full = false) => {
    try {
      const query =
        full || !cursorRef.current ? '' : `?after=${encodeURIComponent(cursorRef.current)}`;
      const incoming = await api<ProjectMessage[]>(
        `/api/projects/${encodeURIComponent(project.id)}/messages${query}`,
      );
      mergeMessages(incoming, full || !cursorRef.current);
      if (full) lastFullSyncRef.current = Date.now();
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Conversation is unavailable');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setMessages([]);
    messagesRef.current = [];
    cursorRef.current = '';
    lastFullSyncRef.current = 0;
    setRecipient('all');
    setKind('question');
    setContent('');
    setReplyTo(undefined);
    setThreadRoot(undefined);
    setError('');
    setLoading(true);
    void sync(true);
    const timer = window.setInterval(() => {
      const hasPending = messagesRef.current.some((message) =>
        message.recipients.some((item) => item.status === 'queued' || item.status === 'sent'),
      );
      // Incremental reads keep normal polling light. A short full sync while delivery is pending
      // lets the UI pick up status changes on the original message as well as new replies.
      void sync(hasPending && Date.now() - lastFullSyncRef.current > 5000);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [project.id]);

  const byId = new Map(messages.map((message) => [message.id, message]));
  const rootFor = (message: ProjectMessage) => {
    let current = message;
    const seen = new Set<string>();
    while (current.replyTo && !seen.has(current.id)) {
      seen.add(current.id);
      const parent = byId.get(current.replyTo);
      if (!parent) break;
      current = parent;
    }
    return current.id;
  };
  const visibleMessages = threadRoot
    ? messages.filter((message) => rootFor(message) === threadRoot)
    : messages;
  const selectedReply = replyTo ? byId.get(replyTo) : undefined;
  const send = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = content.trim();
    if (!trimmed || !members.length || sending) return;
    const recipients = recipient === 'all' ? members : [recipient];
    setSending(true);
    setError('');
    try {
      const idempotencyKey =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `ui-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const message = await post<ProjectMessage>(
        `/api/projects/${encodeURIComponent(project.id)}/messages`,
        { recipients, content: trimmed, kind, ...(replyTo ? { replyTo } : {}), idempotencyKey },
      );
      mergeMessages([message]);
      setContent('');
      setReplyTo(undefined);
      setThreadRoot(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Message could not be sent');
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="panel project-chat" id="project-conversation">
      <div className="panel-title project-chat-heading">
        <div>
          <span className="eyebrow">PROJECT CONVERSATION</span>
          <h3>
            <MessageCircle size={16} /> Talk with the project team
          </h3>
          <p>Messages stay with this project, so the latest context is here when you resume.</p>
        </div>
        {threadRoot && (
          <button className="text-button" type="button" onClick={() => setThreadRoot(undefined)}>
            Show all messages
          </button>
        )}
      </div>
      {error && (
        <div className="chat-error">
          <CircleAlert size={15} /> {error}
        </div>
      )}
      <div className="chat-history" aria-live="polite">
        {loading ? (
          <div className="chat-empty">
            <LoaderCircle className="spin" size={17} /> Loading conversation…
          </div>
        ) : !visibleMessages.length ? (
          <div className="chat-empty">
            <MessageCircle size={22} />
            <strong>No messages yet</strong>
            <span>Ask a project agent for an update or send context before resuming work.</span>
          </div>
        ) : (
          visibleMessages.map((message) => {
            const sender =
              message.sender.kind === 'user'
                ? 'You'
                : `${message.sender.id} · ${label(message.sender.role)}`;
            const parent = message.replyTo ? byId.get(message.replyTo) : undefined;
            return (
              <article
                className={message.sender.kind === 'user' ? 'chat-message mine' : 'chat-message'}
                key={message.id}
              >
                <div className="chat-message-meta">
                  <strong>{sender}</strong>
                  <span>{label(message.kind)}</span>
                  <time dateTime={message.createdAt}>
                    {new Date(message.createdAt).toLocaleString()}
                  </time>
                </div>
                {parent && (
                  <button
                    className="chat-reply-link"
                    type="button"
                    onClick={() => setThreadRoot(rootFor(parent))}
                  >
                    Reply to {parent.sender.kind === 'user' ? 'your message' : parent.sender.id}
                  </button>
                )}
                <p>{message.content}</p>
                <div className="chat-message-footer">
                  <div className="chat-statuses">
                    {message.recipients.map((item) => (
                      <span
                        className={`chat-status ${item.status}`}
                        key={`${message.id}-${item.account}`}
                        title={item.reason || undefined}
                      >
                        {item.status === 'answered' ? (
                          <CircleCheck size={12} />
                        ) : item.status === 'failed' ? (
                          <CircleAlert size={12} />
                        ) : (
                          <Clock3 size={12} />
                        )}
                        {item.account === 'user' ? 'You' : item.account}: {label(item.status)}
                      </span>
                    ))}
                  </div>
                  {message.recipients.length > 0 && (
                    <button
                      className="chat-reply-button"
                      type="button"
                      onClick={() => {
                        setReplyTo(message.id);
                        setThreadRoot(rootFor(message));
                      }}
                    >
                      Reply
                    </button>
                  )}
                </div>
                {message.recipients.some((item) => item.status === 'queued' && item.reason) && (
                  <small className="chat-queue-note">
                    Queued while one or more selected agents are unavailable. Hover a status for
                    details.
                  </small>
                )}
              </article>
            );
          })
        )}
      </div>
      <form className="chat-composer" onSubmit={send}>
        {selectedReply && (
          <div className="chat-replying">
            <span>
              Replying to{' '}
              {selectedReply.sender.kind === 'user' ? 'your message' : selectedReply.sender.id}: “
              {selectedReply.content.slice(0, 110)}
              {selectedReply.content.length > 110 ? '…' : ''}”
            </span>
            <button type="button" aria-label="Cancel reply" onClick={() => setReplyTo(undefined)}>
              <X size={14} />
            </button>
          </div>
        )}
        <div className="chat-composer-row">
          <label>
            Send to
            <select
              value={recipient}
              onChange={(event) => setRecipient(event.target.value)}
              disabled={!members.length || sending}
            >
              <option value="all">All project agents</option>
              {members.map((member) => (
                <option key={member} value={member}>
                  {member}
                  {member === project.lead ? ' · lead' : ' · worker'}
                </option>
              ))}
            </select>
          </label>
          <label>
            Message type
            <select
              value={kind}
              onChange={(event) => setKind(event.target.value as typeof kind)}
              disabled={sending}
            >
              <option value="question">Request a response</option>
              <option value="update">Share an update</option>
              <option value="blocker">Flag a blocker</option>
            </select>
          </label>
        </div>
        <div className="chat-input-row">
          <textarea
            value={content}
            maxLength={4000}
            onChange={(event) => setContent(event.target.value)}
            placeholder="Write a short project message…"
            disabled={!members.length || sending}
            rows={3}
          />
          <button
            className="button primary chat-send"
            type="submit"
            disabled={!content.trim() || !members.length || sending}
          >
            {sending ? <LoaderCircle className="spin" size={15} /> : <Send size={15} />} Send
          </button>
        </div>
        <small className="chat-limit">
          {content.length.toLocaleString()} / 4,000 characters · up to 8 recipients
        </small>
        {!members.length && (
          <small className="chat-limit">
            Add a lead or worker account to start a conversation.
          </small>
        )}
      </form>
    </section>
  );
}

function TaskRow({ task, index }: { task: Task; index: number }) {
  const workerEvidence = task.workerIdentityEvidence;
  const reviewerEvidence = task.reviewerIdentityEvidence;
  const evidenceMismatch = Boolean(
    workerEvidence && task.account && workerEvidence.account !== task.account,
  );
  return (
    <div className="task-row">
      <span
        className={`task-status ${task.status === 'completed' || task.status === 'done' ? 'complete' : task.status === 'running' ? 'running' : ''}`}
      >
        {task.status === 'completed' || task.status === 'done' ? (
          <Check size={13} />
        ) : task.status === 'running' ? (
          <LoaderCircle className="spin" size={13} />
        ) : (
          String(index + 1).padStart(2, '0')
        )}
      </span>
      <div className="task-main">
        <strong>{task.title}</strong>
        <p>{task.instruction || 'No instruction provided.'}</p>
        <div className="task-tags">
          {task.account && (
            <span>
              <UserRound size={12} />
              {task.account}
            </span>
          )}
          {workerEvidence && (
            <span>
              <ShieldCheck size={12} /> Worker identity: {workerEvidence.identity ?? 'unknown'}
            </span>
          )}
          {reviewerEvidence && (
            <span>
              <ShieldCheck size={12} /> Reviewer identity: {reviewerEvidence.identity ?? 'unknown'}
            </span>
          )}
          {!workerEvidence && !reviewerEvidence && <span>Provider identity: unknown</span>}
          {evidenceMismatch && <span className="account-warning">Runtime account mismatch</span>}
          {task.dependencies?.length ? (
            <span>
              <Link2 size={12} />
              {task.dependencies.length} dependencies
            </span>
          ) : null}
        </div>
        <details className="task-details">
          <summary>Acceptance & dependencies</summary>
          <div>
            {task.dependencies?.length ? (
              <p>
                <strong>Depends on:</strong> {task.dependencies.join(', ')}
              </p>
            ) : (
              <p>
                <strong>Depends on:</strong> None
              </p>
            )}
            {task.acceptance?.length ? (
              <p>
                <strong>Acceptance:</strong> {task.acceptance.join(' · ')}
              </p>
            ) : (
              <p>
                <strong>Acceptance:</strong> None specified
              </p>
            )}
            {task.feedback && (
              <p>
                <strong>Feedback:</strong> {task.feedback}
              </p>
            )}
            {task.result && (
              <p>
                <strong>Result:</strong> {task.result}
              </p>
            )}
          </div>
        </details>
      </div>
      <span className="task-state">{label(task.status || 'queued')}</span>
    </div>
  );
}

function ActivityView({ events }: { events: Event[] }) {
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">ACTIVITY</p>
          <h1>Workspace activity</h1>
          <p className="subhead">A local timeline of sessions, plans, and agent work.</p>
        </div>
      </div>
      <section className="panel activity-list">
        {events.map((e, i) => (
          <EventRow event={e} key={e.id || i} />
        ))}
        {!events.length && (
          <Empty
            icon={Activity}
            title="No activity yet"
            text="Your workspace timeline will appear here."
          />
        )}
      </section>
    </>
  );
}
function Results({ project }: { project?: Project }) {
  const [files, setFiles] = useState<Artifact[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const load = async () => {
    if (!project) return;
    setLoading(true);
    setError('');
    try {
      const result = await api<{ files: Artifact[] }>('/api/projects/' + project.id + '/results');
      setFiles(result.files || []);
    } catch (e) {
      setFiles([]);
      setError(e instanceof Error ? e.message : 'Unable to load project results');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, [project?.id]);
  if (!project)
    return (
      <Empty
        icon={FileText}
        title="No project selected"
        text="Choose a project to inspect its artifacts."
      />
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">RESULTS</p>
          <h1>{project.name} artifacts</h1>
          <p className="subhead">
            Inspect files produced in the staging area before accepting the project.
          </p>
        </div>
        <button className="button secondary" onClick={() => void load()}>
          <RefreshCw size={16} /> Refresh
        </button>
      </div>
      <section className="panel results-panel">
        {loading ? (
          <div className="loading">
            <LoaderCircle className="spin" /> Loading artifacts…
          </div>
        ) : error ? (
          <div className="inline-error">
            <AlertCircle size={16} />
            {error}
          </div>
        ) : files.length ? (
          files.map((file) => (
            <div className="file-row" key={file.path}>
              <FileText size={18} />
              <div>
                <strong>{file.path}</strong>
                <small>
                  {file.size} bytes · {label(file.change || 'unchanged')}
                </small>
                {(file.text || file.diff) && (
                  <details className="artifact-preview">
                    <summary>{file.diff ? 'View diff' : 'Preview file'}</summary>
                    <pre>{file.diff || file.text}</pre>
                  </details>
                )}
              </div>
              {file.change !== 'deleted' && (
                <a
                  className="icon-button"
                  href={
                    '/api/projects/' +
                    encodeURIComponent(project.id) +
                    '/artifact?path=' +
                    encodeURIComponent(file.path)
                  }
                  download
                  title="Download"
                >
                  <Download size={16} />
                </a>
              )}
            </div>
          ))
        ) : (
          <Empty
            icon={FileText}
            title="No artifacts yet"
            text="Run the project to produce staged files."
          />
        )}
      </section>
    </>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
