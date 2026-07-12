import { Context, Next } from 'hono';
import type { Env, SessionData } from './types';
import { getSession, getSessionToken } from './auth';

export type AppContext = Context<{ Bindings: Env; Variables: { session: SessionData } }>;

export async function requireAuth(c: AppContext, next: Next) {
  const token = getSessionToken(c.req.header('Cookie') ?? null);
  if (!token) return c.json({ error: 'Unauthorized' }, 401);
  const session = await getSession(c.env, token);
  if (!session) return c.json({ error: 'Unauthorized' }, 401);
  c.set('session', session);
  return next();
}

export async function requireAdmin(c: AppContext, next: Next) {
  const session = c.get('session');
  if (!session) return c.json({ error: 'Unauthorized' }, 401);
  if (session.role !== 'admin') return c.json({ error: 'Forbidden' }, 403);
  return next();
}

export function json(data: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function err(message: string, status: number = 400): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
