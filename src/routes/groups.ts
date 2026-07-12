import { Hono } from 'hono';
import type { Env, SessionData } from '../types';
import { requireAuth } from '../middleware';

function imageUrl(request: Request, r2Key: string): string {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}/img/${r2Key}`;
}

function displayUrl(request: Request, token: string): string {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}/display/${token}`;
}

const app = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

app.use('*', requireAuth);

app.get('/', async (c) => {
  const rows = await c.env.DB.prepare(`
    SELECT g.*, COUNT(gi.image_id) as image_count
    FROM groups g
    LEFT JOIN group_images gi ON g.id = gi.group_id
    GROUP BY g.id
    ORDER BY g.created_at ASC
  `).all();
  return c.json(rows.results);
});

app.get('/:id', async (c) => {
  const { id } = c.req.param();
  const group = await c.env.DB.prepare('SELECT * FROM groups WHERE id = ?').bind(id).first();
  if (!group) return c.json({ error: 'Group not found' }, 404);

  const images = await c.env.DB.prepare(`
    SELECT i.*, gi.position
    FROM group_images gi
    JOIN images i ON gi.image_id = i.id
    WHERE gi.group_id = ?
    ORDER BY gi.position ASC
  `).bind(id).all();

  return c.json({
    ...(group as any),
    images: (images.results as any[]).map(img => ({
      ...img,
      url: imageUrl(c.req.raw, img.r2_key),
    })),
  });
});

app.post('/', async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body?.name) return c.json({ error: 'name required' }, 400);

  const id = crypto.randomUUID();
  const now = Date.now();
  const rotationSpeed = Number(body.rotation_speed) || 8;
  const shuffle = body.shuffle ? 1 : 0;

  await c.env.DB.prepare(
    'INSERT INTO groups (id, name, description, rotation_speed, shuffle, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, body.name, body.description ?? null, rotationSpeed, shuffle, now, now).run();

  return c.json({
    id, name: body.name, description: body.description ?? null,
    rotation_speed: rotationSpeed, shuffle, created_at: now, updated_at: now,
  }, 201);
});

app.patch('/:id', async (c) => {
  const { id } = c.req.param();
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: 'Invalid body' }, 400);

  const group = await c.env.DB.prepare('SELECT id FROM groups WHERE id = ?').bind(id).first();
  if (!group) return c.json({ error: 'Group not found' }, 404);

  const sets: string[] = ['updated_at = ?'];
  const values: unknown[] = [Date.now()];

  if (body.name !== undefined) { sets.push('name = ?'); values.push(body.name); }
  if (body.description !== undefined) { sets.push('description = ?'); values.push(body.description); }
  if (body.rotation_speed !== undefined) { sets.push('rotation_speed = ?'); values.push(Number(body.rotation_speed)); }
  if (body.shuffle !== undefined) { sets.push('shuffle = ?'); values.push(body.shuffle ? 1 : 0); }

  values.push(id);
  await c.env.DB.prepare(`UPDATE groups SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...values).run();

  const updated = await c.env.DB.prepare('SELECT * FROM groups WHERE id = ?').bind(id).first();
  return c.json(updated);
});

app.delete('/:id', async (c) => {
  const { id } = c.req.param();
  const group = await c.env.DB.prepare('SELECT id FROM groups WHERE id = ?').bind(id).first();
  if (!group) return c.json({ error: 'Group not found' }, 404);
  // group_images cascade, screens ON DELETE SET NULL handled by FK
  await c.env.DB.prepare('DELETE FROM groups WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

// Set full image membership + order in one call
app.put('/:id/images', async (c) => {
  const { id } = c.req.param();
  const body = await c.req.json().catch(() => null);
  if (!body || !Array.isArray(body.image_ids)) {
    return c.json({ error: 'image_ids array required' }, 400);
  }

  const group = await c.env.DB.prepare('SELECT id FROM groups WHERE id = ?').bind(id).first();
  if (!group) return c.json({ error: 'Group not found' }, 404);

  // Validate all image IDs exist
  for (const imageId of body.image_ids) {
    const img = await c.env.DB.prepare('SELECT id FROM images WHERE id = ?').bind(imageId).first();
    if (!img) return c.json({ error: `Image ${imageId} not found` }, 404);
  }

  // Replace membership atomically
  const stmts = [
    c.env.DB.prepare('DELETE FROM group_images WHERE group_id = ?').bind(id),
    ...body.image_ids.map((imageId: string, pos: number) =>
      c.env.DB.prepare('INSERT INTO group_images (group_id, image_id, position) VALUES (?, ?, ?)')
        .bind(id, imageId, pos)
    ),
    c.env.DB.prepare('UPDATE groups SET updated_at = ? WHERE id = ?').bind(Date.now(), id),
  ];
  await c.env.DB.batch(stmts);

  return c.json({ ok: true });
});

// Screens currently showing this group
app.get('/:id/screens', async (c) => {
  const { id } = c.req.param();
  const group = await c.env.DB.prepare('SELECT id FROM groups WHERE id = ?').bind(id).first();
  if (!group) return c.json({ error: 'Group not found' }, 404);

  const rows = await c.env.DB.prepare(
    'SELECT * FROM screens WHERE active_group_id = ? ORDER BY created_at ASC'
  ).bind(id).all();

  const screens = (rows.results as any[]).map(s => ({
    ...s,
    display_url: displayUrl(c.req.raw, s.url_token),
  }));
  return c.json(screens);
});

// Assign this group to a set of screens (both directions)
app.put('/:id/screens', async (c) => {
  const { id } = c.req.param();
  const body = await c.req.json().catch(() => null);
  if (!body || !Array.isArray(body.screen_ids)) {
    return c.json({ error: 'screen_ids array required' }, 400);
  }

  const group = await c.env.DB.prepare('SELECT id FROM groups WHERE id = ?').bind(id).first();
  if (!group) return c.json({ error: 'Group not found' }, 404);

  const now = Date.now();
  const stmts: D1PreparedStatement[] = [
    // Clear this group from all screens
    c.env.DB.prepare(
      'UPDATE screens SET active_group_id = NULL, updated_at = ? WHERE active_group_id = ?'
    ).bind(now, id),
  ];
  // Assign group to the listed screens
  for (const screenId of body.screen_ids) {
    stmts.push(
      c.env.DB.prepare(
        'UPDATE screens SET active_group_id = ?, updated_at = ? WHERE id = ?'
      ).bind(id, now, screenId)
    );
  }
  await c.env.DB.batch(stmts);

  return c.json({ ok: true });
});

export default app;
