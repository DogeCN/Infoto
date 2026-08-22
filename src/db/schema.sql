-- Infoto D1 Schema (KV 等价迁移)
-- 原则：用最少表结构等价映射原 KV 存储结构，API 契约不变

-- 照片元数据 (对应 KV: p:<id>)
CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY,
  parts_json TEXT NOT NULL,       -- JSON array: 分片直链列表
  sha256 TEXT,                    -- 用于查重
  width INTEGER,
  height INTEGER,
  created_at INTEGER,             -- 上传时间戳
  ext TEXT,                       -- webp / webm
  has_audio INTEGER DEFAULT 0,    -- 0/1
  likes INTEGER DEFAULT 0,        -- 服务端权威计数
  dislikes INTEGER DEFAULT 0      -- 服务端权威计数
);

-- 照片顺序列表 (对应 KV: photo_ids)
CREATE TABLE IF NOT EXISTS photo_order (
  rowid INTEGER PRIMARY KEY AUTOINCREMENT,
  photo_id TEXT NOT NULL UNIQUE REFERENCES photos(id) ON DELETE CASCADE
);

-- SHA-256 反向索引 (对应 KV: sha:<hash>)
CREATE TABLE IF NOT EXISTS sha_index (
  sha TEXT PRIMARY KEY,
  photo_id TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE
);

-- 投票详情 (对应 KV: votes:<id> → 展开为行，避免 JSON 大数组)
CREATE TABLE IF NOT EXISTS votes (
  photo_id TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  voter TEXT NOT NULL,           -- 匿名 ID 或 IP
  vote_type INTEGER NOT NULL,    -- 1=like, -1=dislike
  PRIMARY KEY (photo_id, voter)
);
CREATE INDEX IF NOT EXISTS idx_votes_photo ON votes(photo_id);

-- 通用 KV 兼容层 (admin_pw / sess:* / up:*)
CREATE TABLE IF NOT EXISTS kv_store (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL,
  expires_at INTEGER             -- unix ms，NULL=永不过期
);
CREATE INDEX IF NOT EXISTS idx_kv_expires ON kv_store(expires_at);