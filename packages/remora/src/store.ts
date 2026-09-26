import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import type { Account, Project, Event, ProjectMessage } from './types.js';

export function redact(value: string): string {
  return value
    .replace(/\b(?:sk-|gh[pousr]_|xai-)[A-Za-z0-9_-]{8,}/g, '[REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED]')
    .replace(
      /((?:access_token|refresh_token|api_key|authorization|password)["']?\s*[:=]\s*["']?)([^\s,"'}]+)/gi,
      '$1[REDACTED]',
    );
}
export class Store {
  readonly db: DatabaseSync;
  readonly events = new EventEmitter();
  constructor(readonly home: string) {
    mkdirSync(home, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(join(home, 'remora.sqlite'));
    if (process.platform !== 'win32') chmodSync(join(home, 'remora.sqlite'), 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS project_messages (
        id TEXT PRIMARY KEY,
        projectId TEXT NOT NULL,
        idempotencyKey TEXT,
        data TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        UNIQUE(projectId, idempotencyKey)
      );
      CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, time TEXT NOT NULL, projectId TEXT, type TEXT NOT NULL, message TEXT NOT NULL, taskId TEXT);
      INSERT OR IGNORE INTO meta VALUES ('schema_version','1');`);
    try {
      this.db.exec('ALTER TABLE events ADD COLUMN account TEXT');
    } catch {
      // Existing databases already have the account column.
    }
    const schema = this.db.prepare("SELECT value FROM meta WHERE key='schema_version'").get() as
      { value?: string } | undefined;
    if (schema?.value !== '2')
      this.db.prepare("UPDATE meta SET value='2' WHERE key='schema_version'").run();
  }
  putMessage(message: ProjectMessage): ProjectMessage {
    const existing = message.idempotencyKey
      ? this.db
          .prepare('SELECT data FROM project_messages WHERE projectId=? AND idempotencyKey=?')
          .get(message.projectId, message.idempotencyKey)
      : undefined;
    if (existing) return JSON.parse((existing as { data: string }).data) as ProjectMessage;
    this.db
      .prepare(
        'INSERT INTO project_messages(id,projectId,idempotencyKey,data,createdAt) VALUES (?,?,?,?,?)',
      )
      .run(
        message.id,
        message.projectId,
        message.idempotencyKey ?? null,
        JSON.stringify(message),
        message.createdAt,
      );
    this.events.emit('message', message);
    return message;
  }
  updateMessage(id: string, update: (message: ProjectMessage) => void): ProjectMessage {
    const row = this.db.prepare('SELECT data FROM project_messages WHERE id=?').get(id);
    if (!row) throw new Error(`Project message not found: ${id}`);
    const message = JSON.parse((row as { data: string }).data) as ProjectMessage;
    update(message);
    this.db
      .prepare('UPDATE project_messages SET data=? WHERE id=?')
      .run(JSON.stringify(message), id);
    this.events.emit('message', message);
    return message;
  }
  messages(projectId: string, after?: string): ProjectMessage[] {
    const rows = this.db
      .prepare('SELECT data FROM project_messages WHERE projectId=? ORDER BY createdAt,id')
      .all(projectId) as unknown as Array<{ data: string }>;
    const messages = rows.map((row) => JSON.parse(row.data) as ProjectMessage);
    if (!after) return messages;
    const index = messages.findIndex((message) => message.id === after);
    return index < 0 ? messages : messages.slice(index + 1);
  }
  list<T>(table: 'accounts' | 'projects'): T[] {
    return this.db
      .prepare(`SELECT data FROM ${table} ORDER BY rowid DESC`)
      .all()
      .map((r) => JSON.parse(r.data as string));
  }
  get<T>(table: 'accounts' | 'projects', id: string): T {
    const row = this.db.prepare(`SELECT data FROM ${table} WHERE id=?`).get(id);
    if (!row) throw new Error(`${table === 'accounts' ? 'Account' : 'Project'} not found: ${id}`);
    return JSON.parse(row.data as string) as T;
  }
  put(table: 'accounts' | 'projects', value: Account | Project) {
    this.db
      .prepare(
        `INSERT INTO ${table}(id,data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`,
      )
      .run(value.id, JSON.stringify(value));
  }
  removeAccount(id: string) {
    this.db.prepare('DELETE FROM accounts WHERE id=?').run(id);
  }
  log(type: string, message: string, projectId?: string, taskId?: string, account?: string) {
    const time = new Date().toISOString();
    const safe = redact(message).slice(0, 12000);
    const result = this.db
      .prepare(
        'INSERT INTO events(time,projectId,type,message,taskId,account) VALUES (?,?,?,?,?,?)',
      )
      .run(time, projectId ?? null, type, safe, taskId ?? null, account ?? null);
    const event = {
      id: Number(result.lastInsertRowid),
      time,
      projectId,
      type,
      message: safe,
      taskId,
      account,
    };
    this.events.emit('event', event);
    return event;
  }
  logs(projectId?: string, after = 0): Event[] {
    return (projectId
      ? this.db
          .prepare('SELECT * FROM events WHERE projectId=? AND id>? ORDER BY id LIMIT 1000')
          .all(projectId, after)
      : this.db
          .prepare('SELECT * FROM events WHERE id>? ORDER BY id LIMIT 1000')
          .all(after)) as unknown as Event[];
  }
  recentLogs(): Event[] {
    return (
      this.db.prepare('SELECT * FROM events ORDER BY id DESC LIMIT 100').all() as unknown as Event[]
    ).reverse();
  }
  close() {
    this.db.close();
  }
}
