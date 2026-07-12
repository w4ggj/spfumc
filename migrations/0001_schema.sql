CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  username    TEXT NOT NULL UNIQUE,
  pin_hash    TEXT NOT NULL,
  pin_salt    TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('admin','user')),
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS groups (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  description    TEXT,
  rotation_speed INTEGER NOT NULL DEFAULT 8,
  shuffle        INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS screens (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  location        TEXT,
  orientation     TEXT NOT NULL DEFAULT 'landscape'
                    CHECK (orientation IN ('landscape','portrait')),
  url_token       TEXT NOT NULL UNIQUE,
  active_group_id TEXT REFERENCES groups(id) ON DELETE SET NULL,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS images (
  id           TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  r2_key       TEXT NOT NULL UNIQUE,
  width        INTEGER,
  height       INTEGER,
  content_type TEXT,
  size_bytes   INTEGER,
  created_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS group_images (
  group_id  TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  image_id  TEXT NOT NULL REFERENCES images(id) ON DELETE CASCADE,
  position  INTEGER NOT NULL,
  PRIMARY KEY (group_id, image_id)
);

CREATE INDEX IF NOT EXISTS idx_group_images_order ON group_images (group_id, position);
CREATE INDEX IF NOT EXISTS idx_screens_token      ON screens (url_token);
CREATE INDEX IF NOT EXISTS idx_screens_group      ON screens (active_group_id);
