-- Infoto data model (see docs/Construct.md "Data Model")
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
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  content_md TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
