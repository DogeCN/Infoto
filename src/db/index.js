/**
 * D1 数据访问层 - 等价原 KV 语义
 * 所有原 env.Infoto.get/put/delete 调用经此层翻译为 D1 SQL
 */

/* ---------------- 通用 KV 兼容层（admin_pw / sess / up:*）---------------- */

export async function kvGet(db, key) {
    try {
        const r = await db
            .prepare('SELECT v, expires_at FROM kv_store WHERE k = ?')
            .bind(key)
            .first();
        if (!r) return null;
        if (r.expires_at && r.expires_at < Date.now()) {
            await db.prepare('DELETE FROM kv_store WHERE k = ?').bind(key).run();
            return null;
        }
        return r.v;
    } catch (e) {
        console.warn('[db] kvGet fail', key, e);
        return null;
    }
}

export async function kvPut(db, key, value, { expirationTtl } = {}) {
    const expiresAt = expirationTtl ? Date.now() + expirationTtl * 1000 : null;
    try {
        await db
            .prepare('INSERT INTO kv_store (k, v, expires_at) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v, expires_at=excluded.expires_at')
            .bind(key, String(value), expiresAt)
            .run();
    } catch (e) {
        console.warn('[db] kvPut fail', key, e);
    }
}

export async function kvDelete(db, key) {
    try {
        await db.prepare('DELETE FROM kv_store WHERE k = ?').bind(key).run();
    } catch (e) {
        console.warn('[db] kvDelete fail', key, e);
    }
}

/* ---------------- 照片元数据 ---------------- */

export async function getPhoto(db, id) {
    try {
        const p = await db
            .prepare('SELECT * FROM photos WHERE id = ?')
            .bind(id)
            .first();
        return p ? rowToPhoto(p) : null;
    } catch (e) {
        console.warn('[db] getPhoto fail', id, e);
        return null;
    }
}

export async function getAllPhotos(db, { limit = Infinity, offset = 0 } = {}) {
    try {
        const end = isFinite(limit) ? offset + limit : -1;
        const rows = await db
            .prepare(`
        SELECT ph.* FROM photo_order o
        JOIN photos ph ON o.photo_id = ph.id
        ORDER BY o.rowid DESC
        LIMIT ? OFFSET ?
      `)
            .bind(end < 0 ? 1_000_000 : (end - offset), offset)
            .all();
        return (rows.results || []).map(rowToPhoto);
    } catch (e) {
        console.warn('[db] getAllPhotos fail', e);
        return [];
    }
}

export async function upsertPhoto(db, photo, isNew) {
    try {
        const stmt = db.prepare(`
      INSERT INTO photos (id, parts_json, sha256, width, height, created_at, ext, has_audio, likes, dislikes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        parts_json=excluded.parts_json,
        sha256=COALESCE(excluded.sha256, photos.sha256),
        width=COALESCE(excluded.width, photos.width),
        height=COALESCE(excluded.height, photos.height),
        created_at=COALESCE(excluded.created_at, photos.created_at),
        ext=COALESCE(excluded.ext, photos.ext),
        has_audio=COALESCE(excluded.has_audio, photos.has_audio)
    `);
        await stmt
            .bind(
                photo.id,
                JSON.stringify(photo.parts || []),
                photo.sha256 || null,
                photo.width ?? null,
                photo.height ?? null,
                photo.createdAt ?? null,
                photo.ext || null,
                photo.hasAudio ? 1 : 0,
                photo.likes ?? 0,
                photo.dislikes ?? 0,
            )
            .run();

        if (isNew) {
            await db.prepare('INSERT OR IGNORE INTO photo_order (photo_id) VALUES (?)').bind(photo.id).run();
        }

        if (photo.sha256 && /^[0-9a-f]{64}$/.test(photo.sha256)) {
            await db
                .prepare('INSERT OR IGNORE INTO sha_index (sha, photo_id) VALUES (?, ?)')
                .bind(photo.sha256, photo.id)
                .run();
        }
        return true;
    } catch (e) {
        console.warn('[db] upsertPhoto fail', photo.id, e);
        return false;
    }
}

export async function updatePhotoDims(db, id, width, height) {
    try {
        const r = await db
            .prepare('UPDATE photos SET width=?, height=? WHERE id=? AND (width IS NULL OR height IS NULL OR width!=? OR height!=?)')
            .bind(width, height, id, width, height)
            .run();
        return r.meta.changes > 0;
    } catch (e) {
        console.warn('[db] updatePhotoDims fail', id, e);
        return false;
    }
}

export async function updatePhotoVoteCounts(db, id, likes, dislikes) {
    try {
        await db
            .prepare('UPDATE photos SET likes=?, dislikes=? WHERE id=?')
            .bind(likes, dislikes, id)
            .run();
    } catch (e) {
        console.warn('[db] updatePhotoVoteCounts fail', id, e);
    }
}

export async function getPhotoCount(db) {
    try {
        const r = await db.prepare('SELECT COUNT(*) AS c FROM photo_order').first();
        return r?.c ?? 0;
    } catch {
        return 0;
    }
}

export async function deletePhoto(db, id) {
    try {
        await db.batch([
            db.prepare('DELETE FROM votes WHERE photo_id = ?').bind(id),
            db.prepare('DELETE FROM sha_index WHERE photo_id = ?').bind(id),
            db.prepare('DELETE FROM photo_order WHERE photo_id = ?').bind(id),
            db.prepare('DELETE FROM photos WHERE id = ?').bind(id),
        ]);
        return true;
    } catch (e) {
        console.warn('[db] deletePhoto fail', id, e);
        return false;
    }
}

/* ---------------- SHA 查重 ---------------- */

export async function findBySha(db, sha) {
    try {
        const r = await db.prepare('SELECT photo_id FROM sha_index WHERE sha = ?').bind(sha).first();
        if (!r) return null;
        return await getPhoto(db, r.photo_id);
    } catch (e) {
        console.warn('[db] findBySha fail', sha, e);
        return null;
    }
}

/* ---------------- 投票 ---------------- */

export async function getVoteState(db, photoId, voter) {
    try {
        const r = await db.prepare('SELECT vote_type FROM votes WHERE photo_id=? AND voter=?').bind(photoId, voter).first();
        const likes = await db.prepare('SELECT COUNT(*) AS c FROM votes WHERE photo_id=? AND vote_type=1').bind(photoId).first();
        const dislikes = await db.prepare('SELECT COUNT(*) AS c FROM votes WHERE photo_id=? AND vote_type=-1').bind(photoId).first();
        return {
            myVote: r?.vote_type || 0,
            likes: likes?.c ?? 0,
            dislikes: dislikes?.c ?? 0,
        };
    } catch (e) {
        console.warn('[db] getVoteState fail', photoId, e);
        return { myVote: 0, likes: 0, dislikes: 0 };
    }
}

export async function setVote(db, photoId, voter, delta) {
    try {
        if (delta === 0) {
            await db.prepare('DELETE FROM votes WHERE photo_id=? AND voter=?').bind(photoId, voter).run();
        } else if (delta === 1 || delta === -1) {
            await db
                .prepare('INSERT INTO votes (photo_id, voter, vote_type) VALUES (?, ?, ?) ON CONFLICT(photo_id, voter) DO UPDATE SET vote_type=excluded.vote_type')
                .bind(photoId, voter, delta)
                .run();
        }
        const likes = await db.prepare('SELECT COUNT(*) AS c FROM votes WHERE photo_id=? AND vote_type=1').bind(photoId).first();
        const dislikes = await db.prepare('SELECT COUNT(*) AS c FROM votes WHERE photo_id=? AND vote_type=-1').bind(photoId).first();
        const l = likes?.c ?? 0;
        const d = dislikes?.c ?? 0;
        await updatePhotoVoteCounts(db, photoId, l, d);
        return { likes: l, dislikes: d };
    } catch (e) {
        console.warn('[db] setVote fail', photoId, voter, delta, e);
        return { likes: 0, dislikes: 0 };
    }
}

/* ---------------- Row → Photo JSON（前端契约）---------------- */

function rowToPhoto(r) {
    let parts = [];
    try { parts = JSON.parse(r.parts_json || '[]'); } catch { parts = []; }
    return {
        id: r.id,
        parts,
        sha256: r.sha256 || undefined,
        width: r.width ?? undefined,
        height: r.height ?? undefined,
        createdAt: r.created_at ?? undefined,
        ext: r.ext || undefined,
        hasAudio: !!r.has_audio,
        likes: r.likes || 0,
        dislikes: r.dislikes || 0,
    };
}