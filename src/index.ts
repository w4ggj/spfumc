import { Hono } from 'hono';
import type { Env, SessionData } from './types';
import { hashPin } from './auth';
import authRoutes from './routes/auth';
import usersRoutes from './routes/users';
import screensRoutes from './routes/screens';
import imagesRoutes from './routes/images';
import groupsRoutes from './routes/groups';
import displayRoutes from './routes/display';

const app = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

// One-time seed: create first admin (only works when users table is empty)
app.post('/api/seed', async (c) => {
  const count = await c.env.DB.prepare('SELECT COUNT(*) as cnt FROM users').first<{ cnt: number }>();
  if ((count?.cnt ?? 0) > 0) {
    return c.json({ error: 'Seed disabled: users already exist' }, 403);
  }
  const body = await c.req.json().catch(() => null);
  if (!body?.username || !body?.pin) {
    return c.json({ error: 'username and pin required' }, 400);
  }
  if (typeof body.pin !== 'string' || body.pin.length < 4) {
    return c.json({ error: 'PIN must be at least 4 characters' }, 400);
  }
  const { hash, salt } = await hashPin(body.pin);
  const id = crypto.randomUUID();
  const now = Date.now();
  await c.env.DB.prepare(
    'INSERT INTO users (id, username, pin_hash, pin_salt, role, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(id, body.username, hash, salt, 'admin', now).run();
  return c.json({ id, username: body.username, role: 'admin' }, 201);
});

// Image proxy — streams private R2 bytes; long cache
app.get('/img/:key', async (c) => {
  const key = c.req.param('key');
  const obj = await c.env.BUCKET.get(key);
  if (!obj) return c.text('Not found', 404);
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('ETag', obj.etag);
  return new Response(obj.body, { headers });
});

// Mount route groups
app.route('/api/auth', authRoutes);
app.route('/api/users', usersRoutes);
app.route('/api/screens', screensRoutes);
app.route('/api/images', imagesRoutes);
app.route('/api/groups', groupsRoutes);

// Display routes (both HTML page and API config)
app.route('/', displayRoutes);

// Everything else → static assets (admin SPA)
app.all('*', async (c) => {
  return c.env.ASSETS.fetch(c.req.raw);
});

export default app;
