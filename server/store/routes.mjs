import {
  addSnapshot,
  deleteSnapshot,
  getDbPath,
  getKv,
  listSnapshots,
  setKv,
} from "./db.mjs";
import { CodexApiError } from "../codex/validation.mjs";

const MAX_BODY_BYTES = 8 * 1024 * 1024; // 8 MB per write (cover base64 included)

const WORKSPACE_KEY = "workspace";
const MODEL_KEY = "model-config";

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk.toString("utf8");
    if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) {
      throw new CodexApiError("BAD_REQUEST", "保存内容过大。");
    }
  }
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    throw new CodexApiError("BAD_REQUEST", "请求体不是合法 JSON。");
  }
}

function assertObject(value, message = "请求体必须是 JSON 对象。") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CodexApiError("BAD_REQUEST", message);
  }
}

export function storeMiddleware() {
  return async (req, res, next) => {
    const requestUrl = new URL(req.url ?? "/", "http://localhost");
    if (!requestUrl.pathname.startsWith("/api/store/")) {
      next();
      return;
    }

    try {
      const method = req.method;
      const parts = requestUrl.pathname.split("/").filter(Boolean); // ["api","store",...]
      const resource = parts[2];
      const subId = parts[3];

      // GET /api/store/health
      if (resource === "health" && method === "GET") {
        sendJson(res, 200, { ok: true, dbPath: getDbPath() });
        return;
      }

      // GET/PUT /api/store/workspace
      if (resource === "workspace" && !subId) {
        if (method === "GET") {
          const workspace = getKv(WORKSPACE_KEY, {});
          sendJson(res, 200, { ok: true, workspace, savedAt: workspace?.savedAt || "" });
          return;
        }
        if (method === "PUT") {
          const payload = await readJsonBody(req);
          assertObject(payload.workspace, "缺少 workspace 对象。");
          const savedAt = new Date().toISOString();
          const workspace = { ...payload.workspace, savedAt };
          setKv(WORKSPACE_KEY, workspace);
          sendJson(res, 200, { ok: true, savedAt });
          return;
        }
      }

      // GET /api/store/history, POST /api/store/history, DELETE /api/store/history/:id
      if (resource === "history") {
        if (method === "GET" && !subId) {
          sendJson(res, 200, { ok: true, items: listSnapshots(50) });
          return;
        }
        if (method === "POST" && !subId) {
          const payload = await readJsonBody(req);
          assertObject(payload, "请求体必须是 JSON 对象。");
          const snapshot = {
            id: payload.id || `snap-${Date.now()}`,
            title: String(payload.title || "未命名草稿").slice(0, 120),
            meta: String(payload.meta || "手动保存").slice(0, 60),
            workspace: payload.workspace && typeof payload.workspace === "object" ? payload.workspace : {},
            savedAt: new Date().toISOString(),
          };
          addSnapshot(snapshot);
          sendJson(res, 201, { ok: true, snapshot });
          return;
        }
        if (method === "DELETE" && subId) {
          const removed = deleteSnapshot(decodeURIComponent(subId));
          sendJson(res, removed ? 200 : 404, { ok: removed });
          return;
        }
      }

      // GET/PUT /api/store/model
      if (resource === "model" && !subId) {
        if (method === "GET") {
          sendJson(res, 200, { ok: true, config: getKv(MODEL_KEY, null) });
          return;
        }
        if (method === "PUT") {
          const payload = await readJsonBody(req);
          assertObject(payload.config, "缺少 config 对象。");
          setKv(MODEL_KEY, payload.config);
          sendJson(res, 200, { ok: true });
          return;
        }
      }

      sendJson(res, 404, { ok: false, code: "NOT_FOUND", error: "未知的存储接口。" });
    } catch (error) {
      if (error instanceof CodexApiError) {
        sendJson(res, error.status || 400, {
          ok: false,
          code: error.code,
          error: error.message,
          details: error.details,
        });
        return;
      }
      sendJson(res, 500, {
        ok: false,
        code: "STORE_ERROR",
        error: error?.message || "本地存储读写失败。",
      });
    }
  };
}
