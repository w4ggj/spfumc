import { Hono } from 'hono';
import type { Env, SessionData } from '../types';
import { requireAuth, requireAdmin } from '../middleware';
import { hashPin } from '../auth';

const app = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

app.use('*', requireAuth, requireAdmin);

app.get('/', async (c) => {
  const users = await c.env.DB.prepare(
    'SELECT id, username, role, created_at FROM users ORDER BY created_at ASC'
  ).all();
  return c.json(users.results);
});

app.post('/', async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body?.username || !body?.pin || !body?.role) {
    return c.json({ error: 'username, pin, and role required' }, 400);
  }
  if (!['admin', 'user'].includes(body.role)) {
    return c.json({ error: 'role must be admin or user' }, 400);
  }
  if (typeof body.pin !== 'string' || body.pin.length < 4) {
    return c.json({ error: 'PIN must be at least 4 characters' }, 400);
  }

  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE username = ?')
    .bind(body.username)
    .first();
  if (existing) return c.json({ error: 'Username already taken' }, 409);

  const { hash, salt } = await hashPin(body.pin);
  const id = crypto.randomUUID();
  const now = Date.now();

  await c.env.DB.prepare(
    'INSERT INTO users (id, username, pin_hash, pin_salt, role, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(id, body.username, hash, salt, body.role, now).run();

  return c.json({ id, username: body.username, role: body.role, created_at: now }, 201);
});

app.patch('/:id', async (c) => {
  const { id } = c.req.param();
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: 'Invalid body' }, 400);

  const user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
  if (!user) return c.json({ error: 'User not found' }, 404);

  const sets: string[] = [];
  const values: unknown[] = [];

  if (body.username !== undefined) {
    const dup = await c.env.DB.prepare('SELECT id FROM users WHERE username = ? AND id != ?')
      .bind(body.username, id)
      .first();
    if (dup) return c.json({ error: 'Username already taken' }, 409);
    sets.push('username = ?');
    values.push(body.username);
  }
  if (body.pin !== undefined) {
    if (typeof body.pin !== 'string' || body.pin.length < 4) {
      return c.json({ error: 'PIN must be at least 4 characters' }, 400);
    }
    const { hash, salt } = await hashPin(body.pin);
    sets.push('pin_hash = ?', 'pin_salt = ?');
    values.push(hash, salt);
  }
  if (body.role !== undefined) {
    if (!['admin', 'user'].includes(body.role)) {
      return c.json({ error: 'role must be admin or user' }, 400);
    }
    // Prevent demoting the last admin
    if (body.role !== 'admin' && (user as any).role === 'admin') {
      const adminCount = await c.env.DB.prepare(
        "SELECT COUNT(*) as cnt FROM users WHERE role = 'admin'"
      ).first<{ cnt: number }>();
      if ((adminCount?.cnt ?? 0) <= 1) {
        return c.json({ error: 'Cannot remove the last admin' }, 409);
      }
    }
    sets.push('role = ?');
    values.push(body.role);
  }

  if (sets.length === 0) return c.json({ error: 'Nothing to update' }, 400);
  values.push(id);
  await c.env.DB.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  const updated = await c.env.DB.prepare(
    'SELECT id, username, role, created_at FROM users WHERE id = ?'
  ).bind(id).first();
  return c.json(updated);
});

app.delete('/:id', async (c) => {
  const { id } = c.req.param();
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<{ role: string }>();
  if (!user) return c.json({ error: 'User not found' }, 404);

  if (user.role === 'admin') {
    const adminCount = await c.env.DB.prepare(
      "SELECT COUNT(*) as cnt FROM users WHERE role = 'admin'"
    ).first<{ cnt: number }>();
    if ((adminCount?.cnt ?? 0) <= 1) {
      return c.json({ error: 'Cannot delete the last admin' }, 409);
    }
  }

  await c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

export default app;
