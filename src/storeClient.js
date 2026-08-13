// Thin client for the local SQLite-backed persistence layer (server/store/routes.mjs).
// All calls fail soft: when the dev server / backend is unavailable the hooks fall
// back to in-memory + localStorage so creation is never blocked.

async function requestJson(url, options, fallbackMessage) {
  let response;
  try {
    response = await fetch(url, options);
  } catch {
    throw new Error(fallbackMessage);
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(fallbackMessage);
  }
  if (!response.ok || !data.ok) {
    throw new Error(data.error || fallbackMessage);
  }
  return data;
}

export async function fetchWorkspace() {
  const data = await requestJson(
    "/api/store/workspace",
    { method: "GET" },
    "无法从本地数据库读取工作区。",
  );
  return { workspace: data.workspace || {}, savedAt: data.savedAt || "" };
}

export async function saveWorkspace(workspace) {
  const data = await requestJson(
    "/api/store/workspace",
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspace }),
    },
    "无法写入本地数据库。",
  );
  return data.savedAt;
}

export async function fetchHistory() {
  const data = await requestJson(
    "/api/store/history",
    { method: "GET" },
    "无法读取历史草稿。",
  );
  return Array.isArray(data.items) ? data.items : [];
}

export async function createSnapshot(snapshot) {
  const data = await requestJson(
    "/api/store/history",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(snapshot),
    },
    "无法保存历史草稿。",
  );
  return data.snapshot;
}

export async function deleteSnapshot(id) {
  await requestJson(
    `/api/store/history/${encodeURIComponent(id)}`,
    { method: "DELETE" },
    "无法删除历史草稿。",
  );
}

export async function fetchModelConfig() {
  const data = await requestJson(
    "/api/store/model",
    { method: "GET" },
    "无法读取模型配置。",
  );
  return data.config;
}

export async function saveModelConfig(config) {
  await requestJson(
    "/api/store/model",
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config }),
    },
    "无法保存模型配置。",
  );
}
