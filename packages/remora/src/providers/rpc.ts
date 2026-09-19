import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';

export class RpcClient extends EventEmitter {
  private child: ChildProcessWithoutNullStreams;
  private sequence = 0;
  private pending = new Map<
    number,
    { resolve(value: any): void; reject(error: Error): void; timer: NodeJS.Timeout }
  >();
  private ended = false;
  get pid() {
    return this.child.pid;
  }
  constructor(command: string, args: string[], env: NodeJS.ProcessEnv) {
    super();
    this.child = spawn(command, args, {
      env,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const reader = createInterface({ input: this.child.stdout, crlfDelay: Infinity });
    reader.on('line', (line) => {
      let message: any;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (message.method) this.emit(message.id !== undefined ? 'request' : 'notification', message);
      else if (message.id !== undefined) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(message.id);
        if (message.error)
          pending.reject(new Error(message.error.message ?? 'Provider request failed'));
        else pending.resolve(message.result);
      }
    });
    // Never persist raw stderr: authentication tools can include secrets.
    this.child.stderr.resume();
    this.child.on('error', (error) => this.finish(error));
    this.child.on('exit', () =>
      this.finish(new Error('Provider process exited; inspect and retry the interrupted task')),
    );
    this.child.stdin.on('error', (error) => this.finish(error));
  }
  private finish(error: Error) {
    if (this.ended) return;
    this.ended = true;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    this.pending.clear();
    this.emit('closed', error);
  }
  request(method: string, params: unknown = {}, timeout = 30000): Promise<any> {
    if (this.ended) return Promise.reject(new Error('Provider is disconnected'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Provider request timed out: ${method}`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ id, method, params });
    });
  }
  send(message: unknown) {
    if (!this.ended) this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }
  async close() {
    const pid = this.child.pid;
    if (pid && !this.ended) {
      if (process.platform === 'win32') {
        await new Promise<void>((resolve, reject) =>
          execFile(
            'taskkill',
            ['/PID', String(pid), '/T', '/F'],
            { windowsHide: true, timeout: 10000 },
            (error) => {
              if (error && !this.ended) reject(error);
              else resolve();
            },
          ),
        );
      } else {
        try {
          process.kill(-pid, 'SIGKILL');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
        }
      }
      await new Promise<void>((resolve, reject) => {
        if (this.child.exitCode !== null || this.child.signalCode !== null) return resolve();
        const exited = () => {
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(() => {
          this.child.off('exit', exited);
          reject(new Error('Provider did not confirm process exit after termination'));
        }, 5000);
        this.child.once('exit', exited);
      });
    }
    this.child.stdin.destroy();
    this.finish(new Error('Provider closed'));
  }
}
