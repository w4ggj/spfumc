import { Hono } from 'hono';
import type { Env, SessionData } from '../types';
import { requireAuth, requireAdmin } from '../middleware';

function generateToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(24)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function displayUrl(request: Request, token: string): string {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}/display/${token}`;
}

const app = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

app.use('*', requireAuth);

app.get('/', async (c) => {
  const rows = await c.env.DB.prepare(`
    SELECT s.*, g.name as group_name
    FROM screens s
    LEFT JOIN groups g ON s.active_group_id = g.id
    ORDER BY s.created_at ASC
  `).all();
  const screens = rows.results.map((s: any) => ({
    ...s,
    display_url: displayUrl(c.req.raw, s.url_token),
  }));
  return c.json(screens);
});

app.post('/', async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body?.name) return c.json({ error: 'name required' }, 400);
  if (body.orientation && !['landscape', 'portrait'].includes(body.orientation)) {
    return c.json({ error: 'orientation must be landscape or portrait' }, 400);
  }

  const id = crypto.randomUUID();
  const token = generateToken();
  const now = Date.now();
  const orientation = body.orientation ?? 'landscape';

  await c.env.DB.prepare(
    'INSERT INTO screens (id, name, location, orientation, url_token, active_group_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)'
  ).bind(id, body.name, body.location ?? null, orientation, token, now, now).run();

  return c.json({
    id,
    name: body.name,
    location: body.location ?? null,
    orientation,
    url_token: token,
    active_group_id: null,
    display_url: displayUrl(c.req.raw, token),
    created_at: now,
    updated_at: now,
  }, 201);
});

app.patch('/:id', async (c) => {
  const { id } = c.req.param();
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: 'Invalid body' }, 400);

  const screen = await c.env.DB.prepare('SELECT * FROM screens WHERE id = ?').bind(id).first();
  if (!screen) return c.json({ error: 'Screen not found' }, 404);

  const sets: string[] = ['updated_at = ?'];
  const values: unknown[] = [Date.now()];

  if (body.name !== undefined) { sets.push('name = ?'); values.push(body.name); }
  if (body.location !== undefined) { sets.push('location = ?'); values.push(body.location); }
  if (body.orientation !== undefined) {
    if (!['landscape', 'portrait'].includes(body.orientation)) {
      return c.json({ error: 'orientation must be landscape or portrait' }, 400);
    }
    sets.push('orientation = ?');
    values.push(body.orientation);
  }
  if ('active_group_id' in body) {
    if (body.active_group_id !== null) {
      const grp = await c.env.DB.prepare('SELECT id FROM groups WHERE id = ?')
        .bind(body.active_group_id).first();
      if (!grp) return c.json({ error: 'Group not found' }, 404);
    }
    sets.push('active_group_id = ?');
    values.push(body.active_group_id);
  }

  values.push(id);
  await c.env.DB.prepare(`UPDATE screens SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...values).run();

  const updated = await c.env.DB.prepare(`
    SELECT s.*, g.name as group_name FROM screens s
    LEFT JOIN groups g ON s.active_group_id = g.id
    WHERE s.id = ?
  `).bind(id).first();
  return c.json({ ...(updated as any), display_url: displayUrl(c.req.raw, (updated as any).url_token) });
});

app.delete('/:id', requireAdmin, async (c) => {
  const { id } = c.req.param();
  const screen = await c.env.DB.prepare('SELECT id FROM screens WHERE id = ?').bind(id).first();
  if (!screen) return c.json({ error: 'Screen not found' }, 404);
  await c.env.DB.prepare('DELETE FROM screens WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

export default app;
