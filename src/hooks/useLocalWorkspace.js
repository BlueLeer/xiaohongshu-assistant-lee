import { useCallback, useEffect, useRef, useState } from "react";
import {
  createSnapshot,
  deleteSnapshot as apiDeleteSnapshot,
  fetchHistory,
  fetchModelConfig,
  fetchWorkspace,
  saveModelConfig,
  saveWorkspace,
} from "../storeClient.js";

const WORKSPACE_KEY = "mint-atelier-v3:workspace";
const MODEL_KEY = "mint-atelier-v3:model-config";
const HISTORY_KEY = "mint-atelier-v3:history";
const MAX_HISTORY_ITEMS = 50;

function readJson(storage, key, fallback) {
  try {
    const value = storage.getItem(key);
    return value ? { ...fallback, ...JSON.parse(value) } : fallback;
  } catch {
    return fallback;
  }
}

// Synchronous read kept for useState initializers (instant first paint).
// The server-side copy is the source of truth and hydrates shortly after mount.
export function readWorkspaceDraft() {
  if (typeof window === "undefined") return {};
  return readJson(window.localStorage, WORKSPACE_KEY, {});
}

function readLocalHistory() {
  if (typeof window === "undefined") return [];
  try {
    const items = JSON.parse(window.localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

function writeLocalHistory(items) {
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(items));
  } catch {
    // Storage failures are non-fatal; the database is the source of truth.
  }
}

function writeLocalWorkspace(workspace) {
  try {
    window.localStorage.setItem(
      WORKSPACE_KEY,
      JSON.stringify({ ...workspace, savedAt: new Date().toISOString() }),
    );
  } catch {
    // Ignore quota / availability errors.
  }
}

// Debounced auto-save of the active workspace to SQLite, with localStorage as a
// best-effort cache. Returns the last confirmed server save timestamp.
export function useWorkspaceDraft(workspace, { onRestored } = {}) {
  const [savedAt, setSavedAt] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const onRestoredRef = useRef(onRestored);
  onRestoredRef.current = onRestored;

  // One-time hydration: load the server workspace and hand it to the parent.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { workspace: saved, savedAt: serverSavedAt } = await fetchWorkspace();
        if (cancelled) return;
        const hasServerData = saved && Object.keys(saved).length > 0;
        if (hasServerData) {
          setSavedAt(serverSavedAt);
          onRestoredRef.current?.(saved, serverSavedAt);
        } else {
          // First run with an empty database: seed from the legacy localStorage
          // copy so existing users do not lose their in-progress work.
          const local = readWorkspaceDraft();
          if (local && Object.keys(local).length > 0) {
            writeLocalWorkspace(local);
            try {
              const migratedAt = await saveWorkspace(local);
              setSavedAt(migratedAt);
            } catch {
              /* offline: keep using localStorage */
            }
          }
        }
      } catch {
        // Backend unavailable: fall back silently to localStorage.
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Debounced persistence whenever the workspace changes (after first hydration).
  useEffect(() => {
    if (!hydrated) return undefined;
    writeLocalWorkspace(workspace);
    const timer = window.setTimeout(() => {
      saveWorkspace(workspace)
        .then((iso) => setSavedAt(iso))
        .catch(() => {
          /* keep local cache; retry on next change */
        });
    }, 600);
    return () => window.clearTimeout(timer);
  }, [workspace, hydrated]);

  return savedAt;
}

export function useWorkspaceHistory() {
  const [history, setHistory] = useState(() => readLocalHistory().slice(0, MAX_HISTORY_ITEMS));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const items = await fetchHistory();
        if (cancelled) return;
        if (items.length > 0) {
          setHistory(items);
          writeLocalHistory(items);
        } else {
          // Empty database: migrate legacy localStorage snapshots once.
          const local = readLocalHistory();
          if (local.length) {
            const migrated = await Promise.all(
              local.slice(0, MAX_HISTORY_ITEMS).map((item) =>
                createSnapshot({
                  id: item.id,
                  title: item.title,
                  meta: item.meta,
                  workspace: item.workspace,
                }).catch(() => null),
              ),
            );
            const ok = migrated.filter(Boolean);
            if (ok.length && !cancelled) setHistory(ok);
          }
        }
      } catch {
        // Offline: keep the localStorage copy already in state.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    writeLocalHistory(history);
  }, [history]);

  const saveSnapshot = useCallback((workspace, label = "手动保存") => {
    const title = String(
      workspace.selectedDraft?.title ||
        workspace.selectedTopic?.title ||
        workspace.keyword ||
        "未命名草稿",
    ).trim();
    const snapshot = {
      id: `history-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title: title.slice(0, 60),
      meta: label,
      savedAt: new Date().toISOString(),
      workspace,
    };
    setHistory((current) => [snapshot, ...current].slice(0, MAX_HISTORY_ITEMS));
    createSnapshot(snapshot).catch(() => {
      /* persisted locally; server sync best-effort */
    });
    return snapshot;
  }, []);

  const removeSnapshot = useCallback((id) => {
    setHistory((current) => current.filter((item) => item.id !== id));
    apiDeleteSnapshot(id).catch(() => {});
  }, []);

  return { history, saveSnapshot, removeSnapshot };
}

// Provider choices and API keys are persisted to SQLite and localStorage.
// The database is a local file on this machine and is the source of truth.
export function useModelConfig(defaultConfig) {
  const [config, setConfig] = useState(() => {
    if (typeof window === "undefined") return defaultConfig;
    const saved = readJson(window.localStorage, MODEL_KEY, defaultConfig);
    return {
      text: { ...defaultConfig.text, ...saved.text },
      image: { ...defaultConfig.image, ...saved.image },
    };
  });
  const [hydrated, setHydrated] = useState(false);

  // Hydrate the full config (including apiKey) from the database once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const saved = await fetchModelConfig();
        if (!cancelled && saved && typeof saved === "object") {
          setConfig((current) => ({
            text: { ...current.text, ...(saved.text || {}) },
            image: { ...current.image, ...(saved.image || {}) },
          }));
        }
      } catch {
        /* unavailable: keep localStorage defaults */
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Do not persist until hydration has finished, otherwise the initial state
  // (often an empty apiKey) would clobber the value saved in the database.
  useEffect(() => {
    if (!hydrated) return undefined;
    try {
      window.localStorage.setItem(MODEL_KEY, JSON.stringify(config));
    } catch {
      // Settings are an enhancement; generation remains available without storage.
    }
    saveModelConfig(config).catch(() => {});
    return undefined;
  }, [config, hydrated]);

  return [config, setConfig];
}
