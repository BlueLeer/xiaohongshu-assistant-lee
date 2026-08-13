import { useEffect, useState } from "react";

const WORKSPACE_KEY = "mint-atelier-v3:workspace";
const MODEL_KEY = "mint-atelier-v3:model-config";
const MODEL_SESSION_KEY = "mint-atelier-v3:model-secrets";
const HISTORY_KEY = "mint-atelier-v3:history";
const MAX_HISTORY_ITEMS = 20;

function readJson(storage, key, fallback) {
  try {
    const value = storage.getItem(key);
    return value ? { ...fallback, ...JSON.parse(value) } : fallback;
  } catch {
    return fallback;
  }
}

export function readWorkspaceDraft() {
  if (typeof window === "undefined") return {};
  return readJson(window.localStorage, WORKSPACE_KEY, {});
}

export function useWorkspaceDraft(workspace) {
  const [restoredAt] = useState(() => {
    const restored = readWorkspaceDraft();
    return restored.savedAt || "";
  });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(WORKSPACE_KEY, JSON.stringify({ ...workspace, savedAt: new Date().toISOString() }));
      } catch {
        // A full or unavailable localStorage should never interrupt creation.
      }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [workspace]);

  return restoredAt;
}

export function useWorkspaceHistory() {
  const [history, setHistory] = useState(() => {
    if (typeof window === "undefined") return [];
    try {
      const items = JSON.parse(window.localStorage.getItem(HISTORY_KEY) || "[]");
      return Array.isArray(items) ? items.slice(0, MAX_HISTORY_ITEMS) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch {
      // Keep the active workspace usable if the browser storage quota is exhausted.
    }
  }, [history]);

  const saveSnapshot = (workspace, label = "手动保存") => {
    const title = String(workspace.selectedDraft?.title || workspace.selectedTopic?.title || workspace.keyword || "未命名草稿").trim();
    const snapshot = {
      id: `history-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title: title.slice(0, 60),
      meta: label,
      savedAt: new Date().toISOString(),
      workspace,
    };
    setHistory((current) => [snapshot, ...current].slice(0, MAX_HISTORY_ITEMS));
    return snapshot;
  };

  return {
    history,
    saveSnapshot,
    removeSnapshot: (id) => setHistory((current) => current.filter((item) => item.id !== id)),
  };
}

// Provider choices are persistent, but API keys are deliberately session-only.
// This avoids leaving credentials on disk while keeping the current workflow smooth.
export function useModelConfig(defaultConfig) {
  const [config, setConfig] = useState(() => {
    if (typeof window === "undefined") return defaultConfig;
    const saved = readJson(window.localStorage, MODEL_KEY, defaultConfig);
    const secrets = readJson(window.sessionStorage, MODEL_SESSION_KEY, {});
    return {
      text: { ...defaultConfig.text, ...saved.text, apiKey: secrets.text?.apiKey || "" },
      image: { ...defaultConfig.image, ...saved.image, apiKey: secrets.image?.apiKey || "" },
    };
  });

  useEffect(() => {
    try {
      const publicConfig = {
        text: { ...config.text, apiKey: "" },
        image: { ...config.image, apiKey: "" },
      };
      window.localStorage.setItem(MODEL_KEY, JSON.stringify(publicConfig));
      window.sessionStorage.setItem(MODEL_SESSION_KEY, JSON.stringify({
        text: { apiKey: config.text.apiKey || "" },
        image: { apiKey: config.image.apiKey || "" },
      }));
    } catch {
      // Settings are an enhancement; generation remains available without storage.
    }
  }, [config]);

  return [config, setConfig];
}
