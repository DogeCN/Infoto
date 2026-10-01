-- Infoto data model.
-- users.id is a plain INTEGER PRIMARY KEY (no AUTOINCREMENT): first insert gets id 0.
-- IF NOT EXISTS keeps re-application idempotent for the deploy workflow.
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  uuid TEXT UNIQUE NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sha256 TEXT UNIQUE NOT NULL,
  url TEXT NOT NULL,
  uploader INTEGER NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  type INTEGER NOT NULL,
  likes TEXT NOT NULL DEFAULT '[]',
  dislikes TEXT NOT NULL DEFAULT '[]',
  reports TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  locale TEXT NOT NULL CHECK (locale IN ('en-US', 'zh-CN')),
  title TEXT NOT NULL,
  content_md TEXT NOT NULL,
  sort INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS reactions (
  ann_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  emoji TEXT NOT NULL,
  PRIMARY KEY (ann_id, user_id)
);
CREATE TABLE IF NOT EXISTS polls (
  id INTEGER PRIMARY KEY CHECK (id >= 0),
  locale TEXT NOT NULL CHECK (locale IN ('en-US', 'zh-CN')),
  title TEXT NOT NULL,
  options TEXT NOT NULL,
  allow_multiple INTEGER NOT NULL CHECK (allow_multiple IN (0, 1)),
  sort INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS votes (
  poll_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  option INTEGER NOT NULL,
  PRIMARY KEY (poll_id, user_id, option)
);
-- sort: manual (root-only) display order, lowest first within each locale. Reorders
-- renumber each locale's list 0…n-1, so snapshots order by sort alone.
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  locale TEXT NOT NULL CHECK (locale IN ('en-US', 'zh-CN')),
  content_md TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  sort INTEGER NOT NULL
);
