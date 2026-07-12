import { Hono } from 'hono';
import type { Env, SessionData } from '../types';
import { requireAuth } from '../middleware';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_DIMENSION = 1920;

interface ProcessedImage {
  data: Uint8Array;
  contentType: string;
  width: number;
  height: number;
}

// Parse image dimensions from raw bytes (no resize, just metadata)
function parseImageDimensions(bytes: Uint8Array, contentType: string): { width: number; height: number } {
  try {
    if (contentType === 'image/png') {
      if (bytes.length >= 24) {
        const w = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
        const h = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
        return { width: w >>> 0, height: h >>> 0 };
      }
    } else if (contentType === 'image/jpeg') {
      let i = 2;
      while (i < bytes.length - 8) {
        if (bytes[i] !== 0xff) break;
        const marker = bytes[i + 1];
        const segLen = (bytes[i + 2] << 8) | bytes[i + 3];
        // SOF0 = 0xC0, SOF2 = 0xC2 — progressive
        if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
          const h = (bytes[i + 5] << 8) | bytes[i + 6];
          const w = (bytes[i + 7] << 8) | bytes[i + 8];
          return { width: w, height: h };
        }
        i += 2 + segLen;
      }
    } else if (contentType === 'image/webp') {
      // RIFF header: 12 bytes, then 'VP8 ', 'VP8L', or 'VP8X'
      if (bytes.length >= 30 && bytes[0] === 0x52 && bytes[1] === 0x49) {
        const chunk = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
        if (chunk === 'VP8 ') {
          const w = ((bytes[26] | (bytes[27] << 8)) & 0x3fff) + 1;
          const h = ((bytes[28] | (bytes[29] << 8)) & 0x3fff) + 1;
          return { width: w, height: h };
        } else if (chunk === 'VP8X') {
          const w = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
          const h = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
          return { width: w, height: h };
        }
      }
    }
  } catch {
    // fall through
  }
  return { width: 0, height: 0 };
}

async function processImage(
  buffer: ArrayBuffer,
  contentType: string,
  env: Env
): Promise<ProcessedImage> {
  const bytes = new Uint8Array(buffer);

  // Try Cloudflare Images binding first
  if (env.IMAGES) {
    try {
      const info = await env.IMAGES.info(buffer);
      const needsResize = info.width > MAX_DIMENSION || info.height > MAX_DIMENSION;
      let step: any = env.IMAGES.input(buffer);
      if (needsResize) {
        step = step.transform({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: 'scale-down' });
      }
      const outputStep = step.output({ format: 'jpeg', quality: 85 });
      const response = await outputStep.response();
      const outBuf = await response.arrayBuffer();
      const outBytes = new Uint8Array(outBuf);
      // Re-read dimensions after resize
      const dims = needsResize
        ? { width: Math.min(info.width, MAX_DIMENSION), height: Math.min(info.height, MAX_DIMENSION) }
        : { width: info.width, height: info.height };
      return { data: outBytes, contentType: 'image/jpeg', ...dims };
    } catch {
      // fall through to passthrough
    }
  }

  // Passthrough fallback: parse dimensions, store original
  const dims = parseImageDimensions(bytes, contentType);
  return { data: bytes, contentType, ...dims };
}

function imageUrl(request: Request, r2Key: string): string {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}/img/${r2Key}`;
}

const app = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

app.use('*', requireAuth);

app.get('/', async (c) => {
  const rows = await c.env.DB.prepare(
    'SELECT * FROM images ORDER BY created_at DESC'
  ).all();
  const images = (rows.results as any[]).map(img => ({
    ...img,
    url: imageUrl(c.req.raw, img.r2_key),
  }));
  return c.json(images);
});

app.post('/', async (c) => {
  const formData = await c.req.formData().catch(() => null);
  if (!formData) return c.json({ error: 'Multipart form required' }, 400);

  const file = formData.get('file') as File | null;
  if (!file) return c.json({ error: 'file field required' }, 400);

  if (!ALLOWED_TYPES.includes(file.type)) {
    return c.json({ error: 'Only JPEG, PNG, and WebP images are accepted' }, 400);
  }
  if (file.size > MAX_BYTES) {
    return c.json({ error: 'File exceeds 10 MB limit' }, 400);
  }

  const displayName = (formData.get('display_name') as string | null) ?? file.name;
  const buffer = await file.arrayBuffer();
  const processed = await processImage(buffer, file.type, c.env);

  const id = crypto.randomUUID();
  const ext = processed.contentType === 'image/jpeg' ? 'jpg'
    : processed.contentType === 'image/webp' ? 'webp' : 'png';
  const r2Key = `${id}.${ext}`;
  const now = Date.now();

  await c.env.BUCKET.put(r2Key, processed.data, {
    httpMetadata: { contentType: processed.contentType },
  });

  await c.env.DB.prepare(
    'INSERT INTO images (id, display_name, r2_key, width, height, content_type, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, displayName, r2Key, processed.width || null, processed.height || null,
    processed.contentType, processed.data.byteLength, now).run();

  return c.json({
    id,
    display_name: displayName,
    r2_key: r2Key,
    width: processed.width || null,
    height: processed.height || null,
    content_type: processed.contentType,
    size_bytes: processed.data.byteLength,
    created_at: now,
    url: imageUrl(c.req.raw, r2Key),
  }, 201);
});

app.patch('/:id', async (c) => {
  const { id } = c.req.param();
  const body = await c.req.json().catch(() => null);
  if (!body?.display_name) return c.json({ error: 'display_name required' }, 400);

  const img = await c.env.DB.prepare('SELECT id FROM images WHERE id = ?').bind(id).first();
  if (!img) return c.json({ error: 'Image not found' }, 404);

  await c.env.DB.prepare('UPDATE images SET display_name = ? WHERE id = ?')
    .bind(body.display_name, id).run();

  const updated = await c.env.DB.prepare('SELECT * FROM images WHERE id = ?').bind(id).first();
  return c.json({ ...(updated as any), url: imageUrl(c.req.raw, (updated as any).r2_key) });
});

app.delete('/:id', async (c) => {
  const { id } = c.req.param();
  const img = await c.env.DB.prepare('SELECT * FROM images WHERE id = ?').bind(id).first<{ r2_key: string }>();
  if (!img) return c.json({ error: 'Image not found' }, 404);

  await c.env.BUCKET.delete(img.r2_key);
  // group_images cascade deletes handled by FK
  await c.env.DB.prepare('DELETE FROM images WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

export default app;
