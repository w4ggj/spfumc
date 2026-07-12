import type { Env, SessionData } from './types';

const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 32;
const KEY_BYTES = 32;
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW = 15 * 60; // 15 min

function toHex(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

export async function hashPin(pin: string): Promise<{ hash: string; salt: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pin),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const hashBuf = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS },
    key,
    KEY_BYTES * 8
  );
  return { hash: toHex(hashBuf), salt: toHex(salt) };
}

export async function verifyPin(pin: string, saltHex: string, hashHex: string): Promise<boolean> {
  const salt = fromHex(saltHex);
  const expected = fromHex(hashHex);
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pin),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const actualBuf = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS },
    key,
    KEY_BYTES * 8
  );
  const actual = new Uint8Array(actualBuf);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

export async function createSession(env: Env, data: SessionData): Promise<string> {
  const token = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  await env.KV.put(`session:${token}`, JSON.stringify({ ...data, expiresAt }), {
    expirationTtl: SESSION_TTL_SECONDS,
  });
  return token;
}

export async function getSession(env: Env, token: string): Promise<SessionData | null> {
  const raw = await env.KV.get(`session:${token}`);
  if (!raw) return null;
  const data = JSON.parse(raw);
  if (data.expiresAt < Math.floor(Date.now() / 1000)) {
    await env.KV.delete(`session:${token}`);
    return null;
  }
  return { userId: data.userId, username: data.username, role: data.role };
}

export async function deleteSession(env: Env, token: string): Promise<void> {
  await env.KV.delete(`session:${token}`);
}

export async function checkRateLimit(env: Env, username: string): Promise<boolean> {
  const key = `ratelimit:${username.toLowerCase()}`;
  const raw = await env.KV.get(key);
  if (!raw) return true;
  const { count, resetAt } = JSON.parse(raw);
  if (resetAt < Math.floor(Date.now() / 1000)) {
    await env.KV.delete(key);
    return true;
  }
  return count < RATE_LIMIT_MAX;
}

export async function recordFailedLogin(env: Env, username: string): Promise<void> {
  const key = `ratelimit:${username.toLowerCase()}`;
  const raw = await env.KV.get(key);
  const now = Math.floor(Date.now() / 1000);
  let count = 1;
  let resetAt = now + RATE_LIMIT_WINDOW;
  if (raw) {
    const existing = JSON.parse(raw);
    if (existing.resetAt > now) {
      count = existing.count + 1;
      resetAt = existing.resetAt;
    }
  }
  await env.KV.put(key, JSON.stringify({ count, resetAt }), {
    expirationTtl: RATE_LIMIT_WINDOW,
  });
}

export async function clearRateLimit(env: Env, username: string): Promise<void> {
  await env.KV.delete(`ratelimit:${username.toLowerCase()}`);
}

export function getSessionToken(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === 'session') return rest.join('=');
  }
  return null;
}

export function sessionCookie(token: string): string {
  const maxAge = SESSION_TTL_SECONDS;
  return `session=${token}; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}; Path=/`;
}

export function clearSessionCookie(): string {
  return 'session=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/';
}
