import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { CodexApiError } from "../codex/validation.mjs";

const DB_PATH =
  process.env.MINT_DB_PATH ||
  path.join(os.homedir(), ".mint-atelier", "mint.sqlite");

let dbInstance = null;

export function getDbPath() {
  return DB_PATH;
}

export function getDb() {
  if (dbInstance) return dbInstance;

  try {
    mkdirSync(path.dirname(DB_PATH), { recursive: true });
    const db = new DatabaseSync(DB_PATH);
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec(`
      CREATE TABLE IF NOT EXISTS kv (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS snapshots (
        id         TEXT PRIMARY KEY,
        title      TEXT,
        meta       TEXT,
        workspace  TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    dbInstance = db;
    return db;
  } catch (error) {
    throw new CodexApiError(
      "STORE_UNAVAILABLE",
      `无法打开本地数据库：${error?.message || error}`,
      500,
    );
  }
}

export function getKv(key, fallback = null) {
  const db = getDb();
  const row = db.prepare("SELECT value FROM kv WHERE key = ?").get(key);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value);
  } catch {
    return fallback;
  }
}

export function setKv(key, value) {
  const db = getDb();
  const encoded = JSON.stringify(value ?? null);
  db.prepare(
    `INSERT INTO kv (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(key, encoded, new Date().toISOString());
  return value;
}

export function listSnapshots(limit = 50) {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT id, title, meta, workspace, created_at FROM snapshots ORDER BY created_at DESC LIMIT ?",
    )
    .all(limit);
  return rows.map((row) => {
    let workspace = {};
    try {
      workspace = JSON.parse(row.workspace);
    } catch {
      workspace = {};
    }
    return {
      id: row.id,
      title: row.title || "未命名草稿",
      meta: row.meta || "手动保存",
      savedAt: row.created_at,
      workspace,
    };
  });
}

export function addSnapshot(snapshot) {
  const db = getDb();
  db.prepare(
    "INSERT INTO snapshots (id, title, meta, workspace, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(
    snapshot.id,
    snapshot.title,
    snapshot.meta || "手动保存",
    JSON.stringify(snapshot.workspace ?? {}),
    snapshot.savedAt,
  );
  return snapshot;
}

export function deleteSnapshot(id) {
  const db = getDb();
  const result = db.prepare("DELETE FROM snapshots WHERE id = ?").run(id);
  return result.changes > 0;
}
