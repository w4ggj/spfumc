export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  KV: KVNamespace;
  IMAGES?: ImagesBinding;
  ASSETS: Fetcher;
  SESSION_SECRET: string;
}

// Cloudflare Images binding — typed loosely since it's optional
interface ImagesBinding {
  info(data: ArrayBuffer | ReadableStream): Promise<{
    width: number;
    height: number;
    fileSize: number;
    format: string;
  }>;
  input(data: ArrayBuffer | ReadableStream): ImageTransformer;
}
interface ImageTransformer {
  transform(opts: { width?: number; height?: number; fit?: string }): ImageOutputStep;
  output(opts: { format?: string; quality?: number }): ImageOutputStep;
}
interface ImageOutputStep {
  response(): Promise<Response>;
  output(opts: { format?: string; quality?: number }): ImageOutputStep;
}

export interface SessionData {
  userId: string;
  username: string;
  role: 'admin' | 'user';
}

export interface User {
  id: string;
  username: string;
  pin_hash: string;
  pin_salt: string;
  role: 'admin' | 'user';
  created_at: number;
}

export interface Screen {
  id: string;
  name: string;
  location: string | null;
  orientation: 'landscape' | 'portrait';
  url_token: string;
  active_group_id: string | null;
  created_at: number;
  updated_at: number;
}

export interface Image {
  id: string;
  display_name: string;
  r2_key: string;
  width: number | null;
  height: number | null;
  content_type: string | null;
  size_bytes: number | null;
  created_at: number;
}

export interface Group {
  id: string;
  name: string;
  description: string | null;
  rotation_speed: number;
  shuffle: number;
  created_at: number;
  updated_at: number;
}

export interface GroupImage {
  group_id: string;
  image_id: string;
  position: number;
}
