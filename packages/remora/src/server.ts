import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { Engine } from './engine.js';
import { redact } from './store.js';
import { safePath, manifest } from './workspace.js';

const equal = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export async function createServer(
  engine: Engine,
  token: string,
  port = 7437,
  onShutdown?: () => void | Promise<void>,
) {
  const app = Fastify({ logger: false, bodyLimit: 1024 * 1024, requestTimeout: 30000 });
  const session = randomBytes(32).toString('hex');
  let shuttingDown = false;
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  app.addHook('onRequest', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    const host = request.headers.host ?? '';
    if (!hosts.has(host)) return reply.code(403).send({ error: 'Invalid Host header' });
    const origin = request.headers.origin;
    if (origin && ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(origin))
      return reply.code(403).send({ error: 'Cross-origin requests are not permitted' });
    if (request.url.startsWith('/api/')) {
      if (shuttingDown && request.url.split('?')[0] !== '/api/shutdown')
        return reply
          .code(503)
          .send({ error: 'Remora is shutting down; retry after it starts again' });
      reply.header('Cache-Control', 'no-store');
      if (request.url.split('?')[0] === '/api/session') return;
      const bearer = request.headers.authorization?.replace(/^Bearer /, '') ?? '';
      const cookie =
        request.headers.cookie
          ?.split(';')
          .map((v) => v.trim())
          .find((v) => v.startsWith('remora_session='))
          ?.slice(15) ?? '';
      if (!equal(bearer, token) && !equal(cookie, session))
        return reply.code(401).send({
          error: 'Open the dashboard URL printed by remora up, or connect with the local CLI',
        });
    }
  });
  app.setErrorHandler((error, _request, reply) => {
    const message =
      error instanceof z.ZodError
        ? error.issues
            .map((issue) => `${issue.path.join('.') || 'Input'}: ${issue.message}`)
            .join('; ')
        : error instanceof Error
          ? error.message
          : 'Request failed';
    reply.code(400).send({ error: redact(message) });
  });
  app.post('/api/session', async (request, reply) => {
    const body = z.object({ token: z.string() }).parse(request.body);
    if (!equal(body.token, token)) return reply.code(401).send({ error: 'Invalid session token' });
    reply.header('Set-Cookie', `remora_session=${session}; HttpOnly; SameSite=Strict; Path=/`);
    return { ok: true };
  });
  app.post('/api/shutdown', async (_request, reply) => {
    if (!onShutdown) return reply.code(503).send({ error: 'Shutdown is unavailable' });
    reply.send({ ok: true });
    shuttingDown = true;
    queueMicrotask(() => {
      void Promise.resolve(onShutdown()).catch(() => {
        // The owning CLI reports shutdown failures in its foreground terminal.
      });
    });
  });
  app.get('/api/state', async () => engine.snapshot());
  app.post('/api/accounts', async (request) => engine.addAccount(request.body));
  app.post<{ Params: { id: string } }>('/api/accounts/:id/recover', async (request) =>
    engine.recoverAccount(
      request.params.id,
      z.object({ confirmedStopped: z.literal(true) }).parse(request.body).confirmedStopped,
    ),
  );
  for (const action of ['login', 'logout', 'refresh', 'remove'] as const) {
    app.post<{ Params: { id: string } }>(`/api/accounts/:id/${action}`, async (request) => {
      const id = request.params.id;
      if (action === 'login') return engine.login(id);
      if (action === 'refresh') return engine.refreshAccount(id);
      if (action === 'logout') await engine.logout(id);
      else await engine.removeAccount(id);
      return { ok: true };
    });
  }
  app.get<{ Params: { id: string } }>('/api/accounts/:id/models', async (request) =>
    engine.models(request.params.id),
  );
  app.post<{ Params: { id: string } }>('/api/accounts/:id/settings', async (request) => {
    const body = z
      .object({ model: z.string().min(1).max(100).nullable().optional() })
      .parse(request.body);
    return engine.updateAccountModel(request.params.id, body.model);
  });
  app.post('/api/projects', async (request) => engine.createProject(request.body));
  app.get<{ Params: { id: string }; Querystring: { after?: string } }>(
    '/api/projects/:id/messages',
    async (request) => engine.messages(request.params.id, request.query.after),
  );
  app.post<{ Params: { id: string } }>('/api/projects/:id/messages', async (request) =>
    engine.sendProjectMessage(request.params.id, request.body),
  );
  app.post('/api/demo', async () => engine.demo());
  app.post<{ Params: { id: string } }>('/api/projects/:id/plan', async (request, reply) => {
    const body = z
      .object({ goal: z.string().min(1).max(20000), plan: z.any().optional() })
      .parse(request.body);
    await engine.plan(request.params.id, body.goal, body.plan);
    return reply.code(202).send(engine.project(request.params.id));
  });
  for (const action of ['approve', 'run', 'pause', 'resume', 'cancel', 'accept'] as const) {
    app.post<{ Params: { id: string } }>(`/api/projects/:id/${action}`, async (request) => {
      const id = request.params.id;
      return action === 'approve'
        ? engine.approve(id)
        : action === 'run' || action === 'resume'
          ? engine.start(id)
          : action === 'pause'
            ? engine.pause(id)
            : action === 'cancel'
              ? engine.cancel(id)
              : engine.accept(id);
    });
  }
  app.post<{ Params: { id: string } }>('/api/projects/:id/retry', async (request) =>
    engine.retry(request.params.id, z.object({ taskId: z.string() }).parse(request.body).taskId),
  );
  app.post<{ Params: { id: string } }>('/api/projects/:id/team', async (request) => {
    const body = z
      .object({ lead: z.string().min(1), workers: z.array(z.string().min(1)).min(1) })
      .parse(request.body);
    return engine.updateTeam(request.params.id, body.lead, body.workers);
  });
  app.get<{ Params: { id: string } }>('/api/projects/:id/results', async (request) =>
    engine.results(request.params.id),
  );
  app.get<{ Params: { id: string }; Querystring: { path: string } }>(
    '/api/projects/:id/artifact',
    async (request, reply) => {
      const project = engine.project(request.params.id);
      if (!project.staging) throw new Error('Results are not staged');
      const path = z.string().min(1).parse(request.query.path);
      if (!Object.hasOwn(manifest(project.staging), path)) throw new Error('Artifact not found');
      const full = safePath(project.staging, path);
      reply.header(
        'Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(basename(path))}`,
      );
      return reply.type('application/octet-stream').send(createReadStream(full));
    },
  );
  app.post<{ Params: { id: string } }>('/api/approvals/:id', async (request) => {
    const body = z
      .object({
        decision: z.enum(['accept', 'acceptForSession', 'decline']),
      })
      .parse(request.body);
    engine.decide(request.params.id, body.decision);
    return { ok: true };
  });
  app.get<{ Querystring: { projectId?: string; after?: string } }>(
    '/api/events',
    async (request) => {
      const after = z.coerce.number().int().min(0).default(0).parse(request.query.after);
      return engine.store.logs(request.query.projectId, after);
    },
  );
  const ui = resolve(dirname(fileURLToPath(import.meta.url)), '../../../apps/dashboard/dist');
  if (existsSync(ui))
    await app.register(fastifyStatic, {
      root: ui,
      index: 'index.html',
      wildcard: true,
      list: false,
    });
  else
    app.get('/', async (_request, reply) =>
      reply.type('text/plain').send('Build the dashboard with npm run build, then restart Remora.'),
    );
  return app;
}
