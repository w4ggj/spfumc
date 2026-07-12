import { Hono } from 'hono';
import type { Env, SessionData } from '../types';
import {
  verifyPin,
  createSession,
  deleteSession,
  getSession,
  getSessionToken,
  checkRateLimit,
  recordFailedLogin,
  clearRateLimit,
  sessionCookie,
  clearSessionCookie,
} from '../auth';
import { requireAuth } from '../middleware';

const app = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

app.post('/login', async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body?.username || !body?.pin) {
    return c.json({ error: 'username and pin required' }, 400);
  }
  const { username, pin } = body;

  const allowed = await checkRateLimit(c.env, username);
  if (!allowed) {
    return c.json({ error: 'Too many failed attempts. Try again in 15 minutes.' }, 429);
  }

  const user = await c.env.DB.prepare('SELECT * FROM users WHERE username = ?')
    .bind(username)
    .first<{ id: string; username: string; pin_hash: string; pin_salt: string; role: string }>();

  if (!user) {
    await recordFailedLogin(c.env, username);
    return c.json({ error: 'Invalid username or PIN' }, 401);
  }

  const valid = await verifyPin(pin, user.pin_salt, user.pin_hash);
  if (!valid) {
    await recordFailedLogin(c.env, username);
    return c.json({ error: 'Invalid username or PIN' }, 401);
  }

  await clearRateLimit(c.env, username);
  const token = await createSession(c.env, {
    userId: user.id,
    username: user.username,
    role: user.role as 'admin' | 'user',
  });

  return new Response(
    JSON.stringify({ id: user.id, username: user.username, role: user.role }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': sessionCookie(token),
      },
    }
  );
});

app.post('/logout', async (c) => {
  const token = getSessionToken(c.req.header('Cookie') ?? null);
  if (token) await deleteSession(c.env, token);
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': clearSessionCookie(),
    },
  });
});

app.get('/me', requireAuth, (c) => {
  const s = c.get('session');
  return c.json({ id: s.userId, username: s.username, role: s.role });
});

export default app;
