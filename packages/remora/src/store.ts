import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import type { Account, Project, Event } from './types.js';

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
      CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, time TEXT NOT NULL, projectId TEXT, type TEXT NOT NULL, message TEXT NOT NULL, taskId TEXT);
      INSERT OR IGNORE INTO meta VALUES ('schema_version','1');`);
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
  log(type: string, message: string, projectId?: string, taskId?: string) {
    const time = new Date().toISOString();
    const safe = redact(message).slice(0, 12000);
    const result = this.db
      .prepare('INSERT INTO events(time,projectId,type,message,taskId) VALUES (?,?,?,?,?)')
      .run(time, projectId ?? null, type, safe, taskId ?? null);
    const event = {
      id: Number(result.lastInsertRowid),
      time,
      projectId,
      type,
      message: safe,
      taskId,
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
