import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  requestCloudCoverImage,
  requestCloudDecision,
  requestCloudGeneration,
  requestLocalCliCoverImage,
  requestLocalCliDecision,
  requestLocalCliDetection,
  requestLocalCliGeneration,
  requestXhsNote,
  requestXhsSearch,
} from "./codexClient.js";
import { readWorkspaceDraft, useModelConfig, useWorkspaceDraft, useWorkspaceHistory } from "./hooks/useLocalWorkspace.js";

const STORAGE_PREFIX = "mint-atelier-v2";

const defaultPersona = "26 岁轻熟风穿搭博主，分享通勤、周末出行和约会搭配。表达温柔具体，重点放在真实穿着体验、单品组合和可复用公式。";
const defaultKeyword = "夏日通勤穿搭";
const defaultBrief = "创作上班族可收藏实用穿搭内容，核心突出清爽利落、提气色不闷汗，口吻贴近闺蜜走心分享。";

const defaultModelConfig = {
  text: {
    provider: "local",
    cliId: "codex",
    cliCommand: "",
    modelName: "Codex CLI / gpt-5-codex",
    apiKey: "",
    baseUrl: "",
  },
  image: {
    provider: "local",
    cliId: "codex",
    cliCommand: "",
    modelName: "Codex CLI / imagegen skill",
    apiKey: "",
    baseUrl: "",
  },
};

const defaultLocalClis = [
  {
    id: "codex",
    label: "Codex CLI",
    description: "Codex 原生非交互模式",
    capabilities: { text: true, image: true },
    available: null,
    commandPreview: "codex exec ...",
  },
  {
    id: "kimi",
    label: "Kimi CLI",
    description: "Kimi Code CLI stream-json 模式",
    capabilities: { text: true, image: false },
    available: null,
    commandPreview: "kimi --prompt ... --output-format stream-json",
  },
  {
    id: "claude",
    label: "Claude Code",
    description: "Claude Code 非交互 JSON 模式",
    capabilities: { text: true, image: false },
    available: null,
    commandPreview: "claude --print ... --output-format json",
  },
  {
    id: "custom",
    label: "自定义规范 CLI",
    description: "支持 --prompt、--model 与 stream-json 输出",
    capabilities: { text: true, image: false },
    available: null,
    commandPreview: "[cli] --prompt ... --output-format stream-json",
  },
];

const flowSteps = [
  { id: "input", label: "账号人设与创作关键词", meta: "设定账号定位" },
  { id: "research", label: "热门内容搜索", meta: "手动触发" },
  { id: "rag", label: "本地 RAG 知识库", meta: "勾选确认" },
  { id: "topics", label: "生成选题", meta: "10 个候选" },
  { id: "drafts", label: "撰写思路与文案", meta: "5 篇草稿" },
  { id: "cover", label: "封面 Prompt 与封面图", meta: "Prompt 到图" },
];

const generationLabels = {
  topics: "选题",
  drafts: "文案",
  coverPrompts: "封面 Prompt",
};

const decisionLabels = {
  rag: "RAG 参考",
  topic: "选题",
  draft: "文案",
  coverPrompt: "封面 Prompt",
};

const errorMessages = {
  search: "搜索失败：请确认关键词不为空，并检查 xhs CLI 登录状态或网络状态后重试。",
  rag: "RAG 加入失败：请先勾选至少一条搜索结果，再点击加入本地知识库。",
  topics: "选题生成失败：请补充人设、关键词，并至少加入一条参考内容。",
  drafts: "文案生成失败：请先选择一个选题，并补充必要的撰写思路。",
  prompts: "封面 Prompt 生成失败：请先选择一篇文案。",
  image: "封面图生成失败：已保留原始 Prompt，可以检查图片模型配置后重新生成。",
  config: "模型配置缺失：云端 API 需要填写 API Key、API Base URL 和模型名称。",
  key: "API Key 无效：请检查密钥是否完整，或切换到本地 CLI 运行方式。",
  cli: "本地 CLI 不可用：请先检测并选择已安装、已登录且支持当前能力的 CLI。",
  network: "网络请求失败：请检查代理、API Base URL 或稍后重试。",
};

function useStoredState(key, initialValue) {
  const storageKey = `${STORAGE_PREFIX}:${key}`;
  const [value, setValue] = useState(() => {
    try {
      const storedValue = window.localStorage.getItem(storageKey);
      return storedValue ? JSON.parse(storedValue) : initialValue;
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      // Local storage can be unavailable in private or embedded contexts.
    }
  }, [storageKey, value]);

  return [value, setValue];
}

function nowText() {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());
}

function isCloudPlaceholderModel(value) {
  return /codex\s*cli|imagegen\s*skill|本地\s*cli/i.test(String(value ?? ""));
}

function SoftIcon({ children, tone = "mint" }) {
  return <span className={`soft-icon ${tone}`}>{children}</span>;
}

function SectionHeader({ icon, tone = "mint", title, meta, action }) {
  return (
    <header className="section-header">
      <div>
        <SoftIcon tone={tone}>{icon}</SoftIcon>
        <span>
          <h2>{title}</h2>
          {meta ? <p>{meta}</p> : null}
        </span>
      </div>
      {action}
    </header>
  );
}

function ProviderSwitch({ value, onChange }) {
  return (
    <div className="provider-switch">
      {[
        ["local", "本地 CLI"],
        ["cloud", "云端 API"],
      ].map(([provider, label]) => (
        <button
          key={provider}
          className={value === provider ? "selected" : ""}
          onClick={() => onChange(provider)}
          type="button"
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function ModelConfig({
  channel,
  title,
  tone,
  icon,
  value,
  onChange,
  localClis,
  detectionState,
  onDetect,
}) {
  const update = (field, nextValue) => onChange({ ...value, [field]: nextValue });
  const selectedCliId = value.cliId || "codex";
  const selectedCli = localClis.find((item) => item.id === selectedCliId) || localClis[0];
  const availableClis = localClis.filter((item) => item.capabilities?.[channel]);
  const localDescription = selectedCli
    ? `${selectedCli.label} · ${selectedCli.description}`
    : "本地 CLI 路线";
  const cloudDescription = title === "图片生成"
    ? "云端 Images API 路线"
    : "云端 Chat Completions 路线";

  const changeCli = (cliId) => {
    const defaults = {
      codex: channel === "image" ? "Codex CLI / imagegen skill" : "Codex CLI / gpt-5-codex",
      kimi: "",
      claude: "",
      custom: "",
    };
    onChange({
      ...value,
      cliId,
      cliCommand: value.cliCommand || "",
      modelName: defaults[cliId] ?? "",
    });
  };

  return (
    <article className="model-config-block">
      <header>
        <SoftIcon tone={tone}>{icon}</SoftIcon>
        <div>
          <h3>{title}</h3>
          <p>{value.provider === "local" ? localDescription : cloudDescription}</p>
        </div>
      </header>
      <ProviderSwitch value={value.provider} onChange={(provider) => update("provider", provider)} />
      {value.provider === "local" ? (
        <>
          <label className="mini-field">
            <span>本机 CLI</span>
            <select value={selectedCliId} onChange={(event) => changeCli(event.target.value)}>
              {availableClis.map((cli) => (
                <option key={cli.id} value={cli.id} disabled={cli.available === false}>
                  {cli.label}{cli.available === true ? " · 可用" : cli.available === false ? " · 不可用" : ""}
                </option>
              ))}
            </select>
          </label>
          {selectedCliId === "custom" ? (
            <label className="mini-field">
              <span>CLI 命令或绝对路径</span>
              <input
                value={value.cliCommand || ""}
                onChange={(event) => update("cliCommand", event.target.value)}
                placeholder="例如 my-agent-cli 或 /opt/bin/my-agent-cli"
              />
            </label>
          ) : null}
          <label className="mini-field">
            <span>模型别名（可留空使用 CLI 默认值）</span>
            <input
              value={value.modelName || ""}
              onChange={(event) => update("modelName", event.target.value)}
              placeholder={
                selectedCliId === "kimi"
                  ? "例如 kimi-code/k3"
                  : selectedCliId === "claude"
                    ? "例如 sonnet 或 opus"
                    : "留空使用 CLI 当前默认模型"
              }
            />
          </label>
          <div className="cli-detection-row">
            <button type="button" onClick={onDetect} disabled={detectionState === "running"}>
              {detectionState === "running" ? "检测中..." : "检测本机 CLI"}
            </button>
            <span className={selectedCli?.available === true ? "ready" : selectedCli?.available === false ? "missing" : ""}>
              {selectedCli?.available === true
                ? `${selectedCli.version || "已安装"}`
                : selectedCli?.available === false
                  ? "当前不可用"
                  : "点击检测安装状态"}
            </span>
          </div>
        </>
      ) : (
        <>
          <label className="mini-field">
            <span>模型名称</span>
            <input value={value.modelName} onChange={(event) => update("modelName", event.target.value)} />
          </label>
          <label className="mini-field">
            <span>API Key</span>
            <input
              value={value.apiKey}
              onChange={(event) => update("apiKey", event.target.value)}
              placeholder="必填"
              type="password"
            />
          </label>
          <label className="mini-field">
            <span>API Base URL</span>
            <input
              value={value.baseUrl}
              onChange={(event) => update("baseUrl", event.target.value)}
              placeholder="https://api.openai.com/v1"
            />
          </label>
        </>
      )}
    </article>
  );
}

function StagePanel({ stepNumber, id, title, meta, actions, expanded, onToggle, children }) {
  const handleKeyDown = (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onToggle();
    }
  };

  return (
    <article
      className={`stage-panel ${expanded ? "expanded" : ""}`}
      data-region="stage-panel"
      data-stage={stepNumber}
    >
      <div
        className="stage-panel-header"
        onClick={onToggle}
        onKeyDown={handleKeyDown}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-controls={`stage-body-${id}`}
      >
        <div className="stage-panel-title">
          <span className="stage-number">{stepNumber}</span>
          <div>
            <h2>{title}</h2>
            {meta ? <p>{meta}</p> : null}
          </div>
        </div>
        <div className="stage-panel-actions" onClick={(event) => event.stopPropagation()}>
          {actions}
          <button
            type="button"
            className="stage-toggle"
            aria-label={expanded ? "折叠面板" : "展开面板"}
            title={expanded ? "折叠" : "展开"}
            onClick={onToggle}
          >
            <span className={expanded ? "chevron-up" : "chevron-down"} />
          </button>
        </div>
      </div>
      {expanded ? (
        <div className="stage-panel-body" id={`stage-body-${id}`}>
          {children}
        </div>
      ) : null}
    </article>
  );
}

export function App() {
  const personaRef = useRef(null);
  const keywordRef = useRef(null);
  const writingBriefRef = useRef(null);
  const coverUploadRef = useRef(null);
  const topMenuRef = useRef(null);
  const topMenuTriggerRef = useRef(null);
  const hoverCloseTimer = useRef(null);
  const carouselTouchRef = useRef(null);
  const [persona, setPersona] = useStoredState("persona", defaultPersona);
  const [keyword, setKeyword] = useStoredState("keyword", defaultKeyword);
  const [writingBrief, setWritingBrief] = useStoredState("writingBrief", defaultBrief);
  const [modelConfig, setModelConfig] = useModelConfig(defaultModelConfig);
  const [localClis, setLocalClis] = useState(defaultLocalClis);
  const [cliDetectionState, setCliDetectionState] = useState("idle");
  const [activeStep, setActiveStep] = useState("research");
  const [topMenuOpen, setTopMenuOpen] = useState(false);
  const [popupPosition, setPopupPosition] = useState(null);
  const [automationEnabled, setAutomationEnabled] = useStoredState("automationEnabled", true);
  const [autoSaveEnabled, setAutoSaveEnabled] = useStoredState("autoSaveEnabled", true);
  const [searchResults, setSearchResults] = useState(() => readWorkspaceDraft().searchResults || []);
  const [selectedSearchIds, setSelectedSearchIds] = useState(() => readWorkspaceDraft().selectedSearchIds || []);
  const [ragItems, setRagItems] = useState(() => readWorkspaceDraft().ragItems || []);
  const [topics, setTopics] = useState(() => readWorkspaceDraft().topics || []);
  const [selectedTopicId, setSelectedTopicId] = useState(() => readWorkspaceDraft().selectedTopicId || null);
  const [drafts, setDrafts] = useState(() => readWorkspaceDraft().drafts || []);
  const [selectedDraftId, setSelectedDraftId] = useState(() => readWorkspaceDraft().selectedDraftId || null);
  const [prompts, setPrompts] = useState(() => readWorkspaceDraft().prompts || []);
  const [selectedPromptId, setSelectedPromptId] = useState(() => readWorkspaceDraft().selectedPromptId || null);
  const [coverImage, setCoverImage] = useState(() => readWorkspaceDraft().coverImage || null);
  const [lastSavedAt, setLastSavedAt] = useState(() => readWorkspaceDraft().savedAt ? nowText() : "");
  const [currentHistoryId, setCurrentHistoryId] = useState(null);
  const [previewDraftId, setPreviewDraftId] = useState(null);
  const [noteDetail, setNoteDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [carouselIndex, setCarouselIndex] = useState(0);
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugLoading, setDebugLoading] = useState(false);
  const [debugData, setDebugData] = useState(null);
  const [debugTab, setDebugTab] = useState("workspace");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [generatingKind, setGeneratingKind] = useState("");
  const [automationRunning, setAutomationRunning] = useState(false);
  const [cliStatus, setCliStatus] = useState({
    state: "idle",
    label: "生成通道",
    text: "尚未调用生成服务。",
    commandPreview: "",
    durationMs: null,
    generatedAt: "",
    code: "",
  });
  const [logs, setLogs] = useState([]);
  const { history, saveSnapshot, removeSnapshot } = useWorkspaceHistory();
  const logSeqRef = useRef(0);
  const lastLoggedStatusRef = useRef(null);

  const pushLog = (type, label, text, extra = {}) => {
    const time = new Date().toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    setLogs((current) => [
      { id: `log-${logSeqRef.current++}`, type, label, text, time, ...extra },
      ...current,
    ].slice(0, 50));
  };

  const selectedTopic = useMemo(
    () => topics.find((topic) => topic.id === selectedTopicId),
    [selectedTopicId, topics],
  );
  const selectedDraft = useMemo(
    () => drafts.find((draft) => draft.id === selectedDraftId),
    [drafts, selectedDraftId],
  );
  // 预览卡片可独立切换文案；未单独指定时跟随主流程的当前选择。
  // 若指向的草稿已不存在（重新生成后），自动回退到当前选择。
  const previewDraft = useMemo(
    () => (previewDraftId ? drafts.find((draft) => draft.id === previewDraftId) ?? selectedDraft : selectedDraft),
    [previewDraftId, drafts, selectedDraft],
  );
  const selectedPrompt = useMemo(
    () => prompts.find((prompt) => prompt.id === selectedPromptId),
    [prompts, selectedPromptId],
  );

  const progress = useMemo(() => {
    const checks = [
      persona.trim().length > 0,
      keyword.trim().length > 0,
      searchResults.length > 0,
      ragItems.length > 0,
      topics.length > 0 && selectedTopic,
      drafts.length > 0 && selectedDraft,
      prompts.length > 0 && selectedPrompt,
      Boolean(coverImage),
    ];

    return Math.round((checks.filter(Boolean).length / checks.length) * 100);
  }, [
    coverImage,
    drafts.length,
    keyword,
    persona,
    prompts.length,
    ragItems.length,
    searchResults.length,
    selectedDraft,
    selectedPrompt,
    selectedTopic,
    topics.length,
  ]);

  const nextStepHint = useMemo(() => {
    if (!persona.trim() || !keyword.trim()) return "完成账号人设与关键词设置，即可进入热门内容搜索。";
    if (searchResults.length === 0) return "点击「搜索热门内容」，获取可参考的热门笔记。";
    if (ragItems.length === 0) return "勾选搜索结果并加入本地 RAG，作为生成参考。";
    if (topics.length === 0) return "生成 10 个选题，挑选最合适的方向。";
    if (drafts.length === 0) return "确认选题后生成 5 篇文案。";
    if (prompts.length === 0) return "选择一篇文案后生成封面 Prompt。";
    if (!coverImage) return "点击封面 Prompt，生成最终封面图。";
    return "创作流程已完成，可以保存草稿或开始新的创作。";
  }, [persona, keyword, searchResults.length, ragItems.length, topics.length, drafts.length, prompts.length, coverImage]);

  const setError = (key) => {
    pushLog("error", "校验失败", errorMessages[key]);
  };

  const setCustomError = (text) => {
    pushLog("error", "错误", text);
  };

  const isBusy = Boolean(generatingKind) || automationRunning;

  const positionPopup = () => {
    const trigger = topMenuTriggerRef.current;
    if (!trigger) return;
    // On phones the sidebar is an off-canvas drawer; the popup is rendered
    // inline (static CSS) so it does not need fixed coordinates.
    if (typeof window !== "undefined" && window.innerWidth <= 768) {
      setPopupPosition({ top: 0, left: 0 });
      return;
    }
    const rect = trigger.getBoundingClientRect();
    setPopupPosition({
      top: rect.top - 4,
      left: rect.right + 12,
    });
  };

  useEffect(() => {
    if (!topMenuOpen) return undefined;
    positionPopup();
    const handlePointerDown = (event) => {
      if (topMenuRef.current && !topMenuRef.current.contains(event.target)) {
        setTopMenuOpen(false);
      }
    };
    const handleReposition = () => positionPopup();
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    window.addEventListener("resize", handleReposition);
    window.addEventListener("scroll", handleReposition, true);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleReposition, true);
    };
  }, [topMenuOpen]);

  useEffect(() => {
    if (!noteDetail) return undefined;
    const total = new Set(
      [noteDetail.coverUrl, ...(noteDetail.images || [])].filter(Boolean),
    ).size;
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        closeNoteDetail();
      } else if (event.key === "ArrowLeft" && total > 1) {
        setCarouselIndex((current) => (current - 1 + total) % total);
      } else if (event.key === "ArrowRight" && total > 1) {
        setCarouselIndex((current) => (current + 1) % total);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [noteDetail]);

  const closeMobileNav = useCallback(() => setMobileNavOpen(false), []);

  // Close the drawer on Escape and when the viewport grows past the mobile
  // breakpoint; lock background scroll while it is open.
  useEffect(() => {
    if (!mobileNavOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") setMobileNavOpen(false);
    };
    const onResize = () => {
      if (window.innerWidth > 768) setMobileNavOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onResize);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onResize);
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileNavOpen]);

  const clearHoverTimer = () => {
    if (hoverCloseTimer.current) {
      clearTimeout(hoverCloseTimer.current);
      hoverCloseTimer.current = null;
    }
  };

  const handleMenuEnter = () => {
    clearHoverTimer();
    if (!topMenuOpen) {
      positionPopup();
      setTopMenuOpen(true);
    }
  };

  const handleMenuLeave = () => {
    clearHoverTimer();
    hoverCloseTimer.current = setTimeout(() => setTopMenuOpen(false), 140);
  };

  const updateModelConfig = (channel, value) => {
    setModelConfig((current) => ({ ...current, [channel]: value }));
  };

  const channelConfig = (channel) => ({
    ...defaultModelConfig[channel],
    ...(modelConfig[channel] || {}),
    cliId: modelConfig[channel]?.cliId || "codex",
    cliCommand: modelConfig[channel]?.cliCommand || "",
  });

  const toggleStep = (id) => {
    setActiveStep((current) => (current === id ? null : id));
  };

  const detectConfiguredClis = async () => {
    const textConfig = channelConfig("text");
    setCliDetectionState("running");
    setCliStatus({
      state: "running",
      label: "本机 CLI 检测",
      text: "正在检测 Codex、Kimi、Claude 与当前自定义规范 CLI...",
      commandPreview: "[cli] --version",
      durationMs: null,
      generatedAt: "",
      code: "",
    });
    try {
      const result = await requestLocalCliDetection({
        customCommand: textConfig.cliId === "custom" ? textConfig.cliCommand : "",
      });
      const nextClis = defaultLocalClis.map((fallback) => (
        result.clis.find((item) => item.id === fallback.id) || fallback
      ));
      setLocalClis(nextClis);
      setCliDetectionState("success");
      const availableLabels = nextClis
        .filter((item) => item.available)
        .map((item) => `${item.label}${item.version ? ` ${item.version}` : ""}`);
      const text = availableLabels.length
        ? `检测完成：${availableLabels.join("、")} 可用。`
        : "未检测到可用的本机生成 CLI。";
      setCliStatus({
        state: availableLabels.length ? "success" : "error",
        label: "本机 CLI 检测",
        text,
        commandPreview: "[cli] --version",
        durationMs: null,
        generatedAt: result.generatedAt,
        code: availableLabels.length ? "" : "LOCAL_CLI_UNAVAILABLE",
      });
    } catch (error) {
      const message = error?.message || "本机 CLI 检测失败。";
      setCliDetectionState("error");
      setCliStatus({
        state: "error",
        label: "本机 CLI 检测",
        text: message,
        commandPreview: "",
        durationMs: null,
        generatedAt: "",
        code: error?.code || "LOCAL_CLI_UNAVAILABLE",
      });
      setCustomError(message);
    }
  };

  const requireModelConfig = (channel) => {
    const config = channelConfig(channel);
    if (config.provider === "cloud") {
      if (!config.modelName.trim() || !config.apiKey.trim() || !config.baseUrl.trim() || isCloudPlaceholderModel(config.modelName)) {
        setError("config");
        return false;
      }
      try {
        const baseUrl = new URL(config.baseUrl.trim());
        if (!["http:", "https:"].includes(baseUrl.protocol)) {
          setCustomError("API Base URL 只支持 http 或 https。");
          return false;
        }
      } catch {
        setCustomError("API Base URL 不是合法 URL。");
        return false;
      }
    } else {
      if (config.cliId === "custom" && !config.cliCommand.trim()) {
        setCustomError("请填写自定义规范 CLI 的命令名或绝对路径。");
        return false;
      }
      const selectedCli = localClis.find((item) => item.id === config.cliId);
      if (selectedCli?.available === false) {
        setCustomError(`${selectedCli.label} 当前不可用，请重新检测或选择其他 CLI。`);
        return false;
      }
      if (selectedCli && !selectedCli.capabilities?.[channel]) {
        setCustomError(`${selectedCli.label} 不支持${channel === "image" ? "图片" : "文本"}生成。`);
        return false;
      }
    }
    return true;
  };

  const requireTextModel = () => requireModelConfig("text");

  const requireImageModel = () => requireModelConfig("image");

  const providerLabel = (channel) => {
    const config = channelConfig(channel);
    if (config.provider === "cloud") {
      return channel === "image" ? "云端图片 API" : "云端文本 API";
    }
    const cli = localClis.find((item) => item.id === config.cliId);
    return `本地 ${cli?.label || "CLI"}`;
  };

  const providerPreview = (channel) => {
    const config = channelConfig(channel);
    if (config.provider === "local") {
      const cli = localClis.find((item) => item.id === config.cliId);
      return cli?.commandPreview || "[cli] --prompt ...";
    }
    const endpoint = channel === "image" ? "/images/generations" : "/chat/completions";
    try {
      const url = new URL(config.baseUrl.trim());
      const currentPath = url.pathname.replace(/\/+$/, "");
      if (!currentPath.toLowerCase().endsWith(endpoint.toLowerCase())) {
        url.pathname = `${currentPath}/${endpoint.replace(/^\/+/, "")}`.replace(/\/{2,}/g, "/");
      }
      url.search = "";
      url.hash = "";
      return `POST ${url.toString()}`;
    } catch {
      return `POST ${endpoint}`;
    }
  };

  const requestPayloadConfig = (channel) => {
    const config = channelConfig(channel);
    if (config.provider !== "cloud") {
      return {
        cliId: config.cliId,
        cliCommand: config.cliCommand,
        modelName: config.modelName,
      };
    }

    return {
      modelName: config.modelName,
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
    };
  };

  const workflowContext = (overrides = {}) => ({
    persona: overrides.persona ?? persona,
    keyword: overrides.keyword ?? keyword,
    ragItems: overrides.ragItems ?? ragItems,
    writingBrief: overrides.writingBrief ?? writingBrief,
  });

  const requestTextItems = async (kind, payload = {}, contextOverrides = {}) => {
    const requestGeneration =
      channelConfig("text").provider === "cloud" ? requestCloudGeneration : requestLocalCliGeneration;
    const context = workflowContext(contextOverrides);
    const result = await requestGeneration({
      kind,
      persona: context.persona,
      keyword: context.keyword,
      ragItems: context.ragItems,
      writingBrief: context.writingBrief,
      ...requestPayloadConfig("text"),
      ...payload,
    });

    return {
      items: result.items,
      routeLabel: providerLabel("text"),
      commandPreview: result.commandPreview,
      durationMs: result.durationMs,
      generatedAt: result.generatedAt,
    };
  };

  const requestDecision = async (decisionKind, options, contextOverrides = {}, payload = {}) => {
    const routeLabel = providerLabel("text");
    const decisionLabel = decisionLabels[decisionKind] ?? "候选项";
    const requestModelDecision =
      channelConfig("text").provider === "cloud" ? requestCloudDecision : requestLocalCliDecision;
    const context = workflowContext(contextOverrides);

    setGeneratingKind(`decision-${decisionKind}`);
    setCliStatus({
      state: "running",
      label: routeLabel,
      text: `正在通过 ${routeLabel} 选择${decisionLabel}...`,
      commandPreview: providerPreview("text"),
      durationMs: null,
      generatedAt: "",
      code: "",
    });

    const result = await requestModelDecision({
      decisionKind,
      persona: context.persona,
      keyword: context.keyword,
      ragItems: context.ragItems,
      writingBrief: context.writingBrief,
      options,
      ...requestPayloadConfig("text"),
      ...payload,
    });

    setCliStatus({
      state: "success",
      label: routeLabel,
      text: `${routeLabel} 已选择${decisionLabel}：${result.reason}`,
      commandPreview: result.commandPreview,
      durationMs: result.durationMs,
      generatedAt: result.generatedAt,
      code: "",
    });

    return { ...result, routeLabel };
  };

  const requestCoverImageResult = async (prompt, selectedDraftValue, contextOverrides = {}) => {
    const requestCoverImage =
      channelConfig("image").provider === "cloud" ? requestCloudCoverImage : requestLocalCliCoverImage;
    const context = workflowContext(contextOverrides);

    return requestCoverImage({
      persona: context.persona,
      keyword: context.keyword,
      selectedDraft: selectedDraftValue,
      selectedPrompt: prompt,
      prompt: prompt.prompt,
      ...requestPayloadConfig("image"),
    });
  };

  const runTextGeneration = async (kind, payload) => {
    const label = generationLabels[kind];
    const routeLabel = providerLabel("text");
    setGeneratingKind(kind);
    setCliStatus({
      state: "running",
      label: routeLabel,
      text: `正在通过 ${routeLabel} 生成${label}...`,
      commandPreview: providerPreview("text"),
      durationMs: null,
      generatedAt: "",
      code: "",
    });

    try {
      const result = await requestTextItems(kind, payload);

      setCliStatus({
        state: "success",
        label: routeLabel,
        text: `${routeLabel} 已生成 ${result.items.length} 条${label}。`,
        commandPreview: result.commandPreview,
        durationMs: result.durationMs,
        generatedAt: result.generatedAt,
        code: "",
      });
      return { items: result.items, routeLabel };
    } catch (error) {
      const message = error?.message || `${routeLabel}生成失败。`;
      setCliStatus({
        state: "error",
        label: routeLabel,
        text: message,
        commandPreview: "",
        durationMs: null,
        generatedAt: "",
        code: error?.code || "GENERATION_FAILED",
      });
      setCustomError(message);
      return false;
    } finally {
      setGeneratingKind("");
    }
  };

  const runSearch = async () => {
    if (!keyword.trim()) {
      setError("search");
      return;
    }

    const trimmedKeyword = keyword.trim();
    setGeneratingKind("search");
    setCliStatus({
      state: "running",
      label: "小红书 CLI 搜索",
      text: `正在通过本机 xhs 搜索「${trimmedKeyword}」...`,
      commandPreview: `xhs --cookie-source none search "${trimmedKeyword}" --sort popular --type all --page 1 --json`,
      durationMs: null,
      generatedAt: "",
      code: "",
    });

    try {
      const result = await requestXhsSearch({
        keyword: trimmedKeyword,
        sort: "popular",
        type: "all",
        page: 1,
      });

      setSearchResults(result.items);
      setSelectedSearchIds([]);
      setActiveStep("research");
      setCliStatus({
        state: "success",
        label: "小红书 CLI 搜索",
        text: `xhs 已返回 ${result.items.length} 条热门内容，结果尚未自动入库。`,
        commandPreview: result.commandPreview,
        durationMs: result.durationMs,
        generatedAt: result.generatedAt,
        code: "",
      });
    } catch (error) {
      const message = error?.message || "小红书热门内容搜索失败。";
      setSearchResults([]);
      setSelectedSearchIds([]);
      setActiveStep("research");
      setCliStatus({
        state: "error",
        label: "小红书 CLI 搜索",
        text: message,
        commandPreview: "",
        durationMs: null,
        generatedAt: "",
        code: error?.code || "XHS_FAILED",
      });
      setCustomError(message);
    } finally {
      setGeneratingKind("");
    }
  };

  const [confirmDialog, setConfirmDialog] = useState(null);

  const openConfirm = ({ title, description, confirmText = "确认", danger = false, onConfirm }) => {
    setConfirmDialog({ title, description, confirmText, danger, onConfirm });
  };

  const closeConfirm = () => setConfirmDialog(null);

  useEffect(() => {
    if (!confirmDialog) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") setConfirmDialog(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [confirmDialog]);

  const resolveConfirm = () => {
    const { onConfirm } = confirmDialog || {};
    setConfirmDialog(null);
    if (typeof onConfirm === "function") onConfirm();
  };

  const confirmResetGeneratedState = () => {
    openConfirm({
      title: "清空生成结果？",
      description: "将清空搜索结果、参考内容、选题、文案、封面提示词与封面图。此操作不可撤销。",
      confirmText: "清空",
      danger: true,
      onConfirm: () => {
        resetGeneratedState();
        pushLog("info", "已清空生成结果", "搜索结果、参考内容、选题、文案与封面已重置。");
      },
    });
  };

  const resetGeneratedState = () => {
    setSearchResults([]);
    setSelectedSearchIds([]);
    setRagItems([]);
    setTopics([]);
    setSelectedTopicId(null);
    setDrafts([]);
    setSelectedDraftId(null);
    setPrompts([]);
    setSelectedPromptId(null);
    setCoverImage(null);
    setPreviewDraftId(null);
  };

  const clearDownstreamFromRag = () => {
    setTopics([]);
    setSelectedTopicId(null);
    setDrafts([]);
    setSelectedDraftId(null);
    setPrompts([]);
    setSelectedPromptId(null);
    setCoverImage(null);
  };

  const removeRagItem = (id) => {
    setRagItems((current) => current.filter((item) => item.id !== id));
    clearDownstreamFromRag();
    pushLog("info", "RAG 已更新", "参考内容已移除，后续选题与文案已清空，避免继续使用过期上下文。");
  };

  const openNoteDetail = async (result) => {
    if (!result?.noteId) {
      setDetailError("该结果缺少笔记 ID，无法加载详情。");
      setNoteDetail({ fallback: result });
      return;
    }
    setDetailLoading(true);
    setDetailError("");
    setCarouselIndex(0);
    setNoteDetail(null);
    try {
      const detail = await requestXhsNote({
        noteId: result.noteId,
        xsecToken: result.xsecToken || "",
      });
      setNoteDetail(detail);
      pushLog("info", "笔记详情", `已加载「${detail.title}」。`);
    } catch (error) {
      const message = error?.message || "笔记详情加载失败。";
      setDetailError(message);
      setNoteDetail({ fallback: result });
      setCustomError(message);
    } finally {
      setDetailLoading(false);
    }
  };

  const closeNoteDetail = () => {
    setNoteDetail(null);
    setDetailError("");
    setDetailLoading(false);
  };

  const openDebugStore = useCallback(async () => {
    setDebugOpen(true);
    setDebugLoading(true);
    setDebugData(null);
    try {
      const [ws, hist, model, health] = await Promise.all([
        fetch("/api/store/workspace").then((r) => r.json()),
        fetch("/api/store/history").then((r) => r.json()),
        fetch("/api/store/model").then((r) => r.json()),
        fetch("/api/store/health").then((r) => r.json()),
      ]);
      setDebugData({
        dbPath: health.dbPath || "",
        workspace: ws.workspace || {},
        workspaceSavedAt: ws.savedAt || "",
        history: Array.isArray(hist.items) ? hist.items : [],
        model: model.config || {},
      });
    } catch (error) {
      setDebugData({ error: error?.message || "加载数据库内容失败。" });
    } finally {
      setDebugLoading(false);
    }
  }, []);

  const closeDebugStore = useCallback(() => {
    setDebugOpen(false);
  }, []);

  useEffect(() => {
    if (!debugOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") closeDebugStore();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [debugOpen, closeDebugStore]);

  const exportDebugJson = () => {
    if (!debugData) return;
    const blob = new Blob([JSON.stringify(debugData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `mint-atelier-store-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const importCoverImage = (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setCustomError("请选择 PNG、JPG、WebP 等图片文件。");
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      setCustomError("导入图片请控制在 3MB 以内，以便安全保存到本地草稿。");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setCoverImage({
        promptId: "imported-cover",
        src: String(reader.result),
        alt: `导入封面：${file.name}`,
        title: file.name,
        createdAt: nowText(),
        generatedAt: new Date().toISOString(),
        source: "imported",
      });
      setActiveStep("cover");
      pushLog("success", "已导入封面", `已将「${file.name}」设为当前封面。`);
    };
    reader.onerror = () => setCustomError("图片读取失败，请换一张图片重试。");
    reader.readAsDataURL(file);
  };

  const openPostPreview = () => {
    setDetailError("");
    setDetailLoading(false);
    setCarouselIndex(0);
    setNoteDetail({
      mode: "preview",
      previewDraftId: previewDraft?.id ?? null,
      title: previewDraft?.title || "小红书草稿预览",
      desc: previewDraft?.body || "选择一篇文案后，这里将展示完整的小红书发布预览。",
      author: "薄荷小丸子",
      type: "image",
      coverUrl: coverImage?.src || "/assets/spring-outfit.png",
      images: [],
      tags: [keyword || "小红书创作"],
      metrics: { liked: "—", collected: "—", comments: "—", shares: "—" },
    });
  };

  const switchPreviewDraft = (dir) => {
    if (drafts.length === 0) return;
    const currentId = noteDetail?.previewDraftId ?? previewDraft?.id ?? selectedDraftId;
    const currentIndex = Math.max(0, drafts.findIndex((draft) => draft.id === currentId));
    const nextDraft = drafts[(currentIndex + dir + drafts.length) % drafts.length];
    setPreviewDraftId(nextDraft.id);
    setNoteDetail((prev) =>
      prev && prev.mode === "preview"
        ? { ...prev, previewDraftId: nextDraft.id, title: nextDraft.title, desc: nextDraft.body }
        : prev,
    );
  };

  const toggleSearchResult = (id) => {
    setSelectedSearchIds((current) =>
      current.includes(id) ? current.filter((itemId) => itemId !== id) : [...current, id],
    );
  };

  const addToRag = () => {
    if (selectedSearchIds.length === 0) {
      setError("rag");
      return;
    }

    const selectedItems = searchResults.filter((result) => selectedSearchIds.includes(result.id));
    setRagItems((current) => {
      const existingIds = new Set(current.map((item) => item.id));
      return [...current, ...selectedItems.filter((item) => !existingIds.has(item.id))];
    });
    clearDownstreamFromRag();
    setActiveStep("rag");
    pushLog("success", "RAG 入库", `已加入 ${selectedItems.length} 条参考内容到本地 RAG。`);
  };

  const generateTopics = async () => {
    if (!persona.trim() || !keyword.trim() || ragItems.length === 0) {
      setError("topics");
      return;
    }
    if (!requireTextModel()) return;

    const result = await runTextGeneration("topics", {});
    if (!result) return;
    const nextTopics = result.items;

    setTopics(nextTopics);
    setSelectedTopicId(nextTopics[0].id);
    setDrafts([]);
    setSelectedDraftId(null);
    setPrompts([]);
    setSelectedPromptId(null);
    setCoverImage(null);
    setActiveStep("topics");
  };

  const generateDrafts = async () => {
    if (!selectedTopic) {
      setError("drafts");
      return;
    }
    if (!requireTextModel()) return;

    const result = await runTextGeneration("drafts", { selectedTopic });
    if (!result) return;
    const nextDrafts = result.items;

    setDrafts(nextDrafts);
    setSelectedDraftId(nextDrafts[0].id);
    setPreviewDraftId(null);
    setPrompts([]);
    setSelectedPromptId(null);
    setCoverImage(null);
    setActiveStep("drafts");
  };

  const generatePrompts = async () => {
    if (!selectedDraft) {
      setError("prompts");
      return;
    }
    if (!requireTextModel()) return;

    const result = await runTextGeneration("coverPrompts", {
      selectedTopic,
      selectedDraft,
    });
    if (!result) return;
    const nextPrompts = result.items;

    setPrompts(nextPrompts);
    setSelectedPromptId(nextPrompts[0].id);
    setCoverImage(null);
    setActiveStep("cover");
  };

  const generateCoverImage = async (promptId = selectedPromptId) => {
    const prompt = prompts.find((item) => item.id === promptId);
    if (!prompt) {
      setError("image");
      return;
    }
    if (!requireImageModel()) return;

    const routeLabel = providerLabel("image");
    setSelectedPromptId(promptId);
    setGeneratingKind("coverImage");
    setCliStatus({
      state: "running",
      label: routeLabel,
      text: `正在通过 ${routeLabel} 生成封面图...`,
      commandPreview: providerPreview("image"),
      durationMs: null,
      generatedAt: "",
      code: "",
    });

    try {
      const result = await requestCoverImageResult(prompt, selectedDraft);

      setCoverImage({
        promptId,
        src: result.image.src,
        alt: result.image.alt,
        title: result.image.title,
        createdAt: nowText(),
        generatedAt: result.generatedAt,
      });
      setCliStatus({
        state: "success",
        label: routeLabel,
        text: `${routeLabel} 已生成封面图。`,
        commandPreview: result.commandPreview,
        durationMs: result.durationMs,
        generatedAt: result.generatedAt,
        code: "",
      });
      setActiveStep("cover");
    } catch (error) {
      const message = error?.message || `${routeLabel}封面图生成失败。`;
      setCliStatus({
        state: "error",
        label: routeLabel,
        text: message,
        commandPreview: "",
        durationMs: null,
        generatedAt: "",
        code: error?.code || "CODEX_FAILED",
      });
      setCustomError(message);
    } finally {
      setGeneratingKind("");
    }
  };

  const runAutomation = async () => {
    if (!automationEnabled) {
      setCustomError("自动化生成总开关已关闭，请先在菜单中开启后再执行。");
      return;
    }
    let currentAutomationStage = "";
    const moveAutomationStage = (stage) => {
      currentAutomationStage = stage;
    };
    const context = {
      persona: (personaRef.current?.value ?? persona).trim(),
      keyword: (keywordRef.current?.value ?? keyword).trim(),
      writingBrief: (writingBriefRef.current?.value ?? writingBrief).trim(),
      ragItems: [],
    };

    if (!context.persona || !context.keyword || !context.writingBrief) {
      setCustomError("自动化生成需要先填写账号人设、创作关键词和补充撰写思路。");
      return;
    }
    if (!requireTextModel() || !requireImageModel()) return;

    setAutomationRunning(true);
    resetGeneratedState();
    pushLog("info", "自动化生成", "已开始：本次授权串行执行搜索、入库、生成与封面图生成。");

    try {
      moveAutomationStage("搜索热门内容");
      setGeneratingKind("search");
      setActiveStep("research");
      setCliStatus({
        state: "running",
        label: "小红书 CLI 搜索",
        text: `自动化正在通过本机 xhs 搜索「${context.keyword}」...`,
        commandPreview: `xhs --cookie-source none search "${context.keyword}" --sort popular --type all --page 1 --json`,
        durationMs: null,
        generatedAt: "",
        code: "",
      });
      const searchResult = await requestXhsSearch({
        keyword: context.keyword,
        sort: "popular",
        type: "all",
        page: 1,
      });
      const nextSearchResults = searchResult.items;
      if (nextSearchResults.length === 0) {
        throw Object.assign(new Error("xhs 没有返回可用于自动化生成的热门内容。"), {
          code: "XHS_EMPTY",
        });
      }
      setSearchResults(nextSearchResults);
      setCliStatus({
        state: "success",
        label: "小红书 CLI 搜索",
        text: `xhs 已返回 ${nextSearchResults.length} 条热门内容，自动化将交给文案模型筛选参考。`,
        commandPreview: searchResult.commandPreview,
        durationMs: searchResult.durationMs,
        generatedAt: searchResult.generatedAt,
        code: "",
      });

      moveAutomationStage("选择并加入 RAG");
      const ragDecision = await requestDecision("rag", nextSearchResults, context);
      const nextSelectedSearchIds = ragDecision.selectedIds;
      const nextRagItems = nextSearchResults.filter((item) => nextSelectedSearchIds.includes(item.id));
      setSelectedSearchIds(nextSelectedSearchIds);
      setRagItems(nextRagItems);
      setActiveStep("rag");
      context.ragItems = nextRagItems;

      moveAutomationStage("生成 10 个选题");
      setGeneratingKind("topics");
      setCliStatus({
        state: "running",
        label: providerLabel("text"),
        text: `自动化正在通过 ${providerLabel("text")} 生成选题...`,
        commandPreview: providerPreview("text"),
        durationMs: null,
        generatedAt: "",
        code: "",
      });
      const topicResult = await requestTextItems("topics", {}, context);
      const nextTopics = topicResult.items;
      setTopics(nextTopics);
      setActiveStep("topics");
      setCliStatus({
        state: "success",
        label: topicResult.routeLabel,
        text: `${topicResult.routeLabel} 已生成 ${nextTopics.length} 条选题，自动化将选择 1 条继续。`,
        commandPreview: topicResult.commandPreview,
        durationMs: topicResult.durationMs,
        generatedAt: topicResult.generatedAt,
        code: "",
      });

      moveAutomationStage("选择选题");
      const topicDecision = await requestDecision("topic", nextTopics, context);
      const nextSelectedTopic = nextTopics.find((topic) => topic.id === topicDecision.selectedIds[0]);
      setSelectedTopicId(nextSelectedTopic.id);

      moveAutomationStage("生成 5 篇文案");
      setGeneratingKind("drafts");
      setCliStatus({
        state: "running",
        label: providerLabel("text"),
        text: `自动化正在通过 ${providerLabel("text")} 生成文案...`,
        commandPreview: providerPreview("text"),
        durationMs: null,
        generatedAt: "",
        code: "",
      });
      const draftResult = await requestTextItems("drafts", { selectedTopic: nextSelectedTopic }, context);
      const nextDrafts = draftResult.items;
      setDrafts(nextDrafts);
      setActiveStep("drafts");
      setCliStatus({
        state: "success",
        label: draftResult.routeLabel,
        text: `${draftResult.routeLabel} 已生成 ${nextDrafts.length} 篇文案，自动化将选择 1 篇继续。`,
        commandPreview: draftResult.commandPreview,
        durationMs: draftResult.durationMs,
        generatedAt: draftResult.generatedAt,
        code: "",
      });

      moveAutomationStage("选择文案");
      const draftDecision = await requestDecision("draft", nextDrafts, context, {
        selectedTopic: nextSelectedTopic,
      });
      const nextSelectedDraft = nextDrafts.find((draft) => draft.id === draftDecision.selectedIds[0]);
      setSelectedDraftId(nextSelectedDraft.id);

      moveAutomationStage("生成 5 份封面 Prompt");
      setGeneratingKind("coverPrompts");
      setCliStatus({
        state: "running",
        label: providerLabel("text"),
        text: `自动化正在通过 ${providerLabel("text")} 生成封面 Prompt...`,
        commandPreview: providerPreview("text"),
        durationMs: null,
        generatedAt: "",
        code: "",
      });
      const promptResult = await requestTextItems(
        "coverPrompts",
        { selectedTopic: nextSelectedTopic, selectedDraft: nextSelectedDraft },
        context,
      );
      const nextPrompts = promptResult.items;
      setPrompts(nextPrompts);
      setActiveStep("cover");
      setCliStatus({
        state: "success",
        label: promptResult.routeLabel,
        text: `${promptResult.routeLabel} 已生成 ${nextPrompts.length} 份封面 Prompt，自动化将选择 1 份生成封面图。`,
        commandPreview: promptResult.commandPreview,
        durationMs: promptResult.durationMs,
        generatedAt: promptResult.generatedAt,
        code: "",
      });

      moveAutomationStage("选择封面 Prompt");
      const promptDecision = await requestDecision("coverPrompt", nextPrompts, context, {
        selectedTopic: nextSelectedTopic,
        selectedDraft: nextSelectedDraft,
      });
      const nextSelectedPrompt = nextPrompts.find((prompt) => prompt.id === promptDecision.selectedIds[0]);
      setSelectedPromptId(nextSelectedPrompt.id);

      moveAutomationStage("生成封面图");
      setGeneratingKind("coverImage");
      const imageRouteLabel = providerLabel("image");
      setCliStatus({
        state: "running",
        label: imageRouteLabel,
        text: `自动化正在通过${imageRouteLabel}生成封面图...`,
        commandPreview: providerPreview("image"),
        durationMs: null,
        generatedAt: "",
        code: "",
      });
      const coverResult = await requestCoverImageResult(nextSelectedPrompt, nextSelectedDraft, context);
      setCoverImage({
        promptId: nextSelectedPrompt.id,
        src: coverResult.image.src,
        alt: coverResult.image.alt,
        title: coverResult.image.title,
        createdAt: nowText(),
        generatedAt: coverResult.generatedAt,
      });
      setCliStatus({
        state: "success",
        label: imageRouteLabel,
        text: `${imageRouteLabel}已生成封面图。`,
        commandPreview: coverResult.commandPreview,
        durationMs: coverResult.durationMs,
        generatedAt: coverResult.generatedAt,
        code: "",
      });
      saveSnapshot({
        persona: context.persona,
        keyword: context.keyword,
        writingBrief: context.writingBrief,
        searchResults: nextSearchResults,
        selectedSearchIds: nextSelectedSearchIds,
        ragItems: nextRagItems,
        topics: nextTopics,
        selectedTopicId: nextSelectedTopic.id,
        selectedTopic: nextSelectedTopic,
        drafts: nextDrafts,
        selectedDraftId: nextSelectedDraft.id,
        selectedDraft: nextSelectedDraft,
        prompts: nextPrompts,
        selectedPromptId: nextSelectedPrompt.id,
        selectedPrompt: nextSelectedPrompt,
        coverImage: {
          promptId: nextSelectedPrompt.id,
          src: coverResult.image.src,
          alt: coverResult.image.alt,
          title: coverResult.image.title,
          createdAt: nowText(),
          generatedAt: coverResult.generatedAt,
        },
      }, "自动化完成");
      pushLog("success", "自动化完成", "热门参考、RAG、选题、文案、封面 Prompt 与封面图均已生成。");
    } catch (error) {
      const message = error?.message || "自动化生成失败。";
      setCliStatus({
        state: "error",
        label: currentAutomationStage ? `自动化：${currentAutomationStage}` : "自动化生成",
        text: message,
        commandPreview: "",
        durationMs: null,
        generatedAt: "",
        code: error?.code || "AUTOMATION_FAILED",
      });
      setCustomError(`自动化生成中断：${message}`);
    } finally {
      setAutomationRunning(false);
      setGeneratingKind("");
    }
  };

  const stampSaved = () => {
    const savedAt = nowText();
    setLastSavedAt(savedAt);
    return savedAt;
  };

  const currentWorkspace = () => ({
    persona, keyword, writingBrief, searchResults, selectedSearchIds, ragItems,
    topics, selectedTopicId, selectedTopic, drafts, selectedDraftId, selectedDraft,
    prompts, selectedPromptId, selectedPrompt, coverImage,
  });

  const loadHistory = (snapshot) => {
    const draft = snapshot.workspace;
    setPersona(draft.persona || "");
    setKeyword(draft.keyword || "");
    setWritingBrief(draft.writingBrief || "");
    setSearchResults(draft.searchResults || []);
    setSelectedSearchIds(draft.selectedSearchIds || []);
    setRagItems(draft.ragItems || []);
    setTopics(draft.topics || []);
    setSelectedTopicId(draft.selectedTopicId || null);
    setDrafts(draft.drafts || []);
    setSelectedDraftId(draft.selectedDraftId || null);
    setPrompts(draft.prompts || []);
    setSelectedPromptId(draft.selectedPromptId || null);
    setCoverImage(draft.coverImage || null);
    setActiveStep(draft.coverImage ? "cover" : draft.drafts?.length ? "drafts" : draft.topics?.length ? "topics" : "research");
    setLastSavedAt(nowText());
    setCurrentHistoryId(snapshot.id);
    pushLog("success", "已载入历史草稿", `已恢复「${snapshot.title}」的创作内容。`);
  };

  const startNewCreation = () => {
    openConfirm({
      title: "开始全新创作？",
      description: "将清空当前所有人设、关键词、搜索结果、参考内容、选题、文案与封面，开始一个全新的创作。此操作不可撤销。",
      confirmText: "新建",
      danger: true,
      onConfirm: () => {
        setPersona("");
        setKeyword("");
        setWritingBrief("");
        resetGeneratedState();
        setActiveStep("input");
        setLastSavedAt("");
        setCurrentHistoryId(null);
        pushLog("info", "新建创作", "已清空当前内容，开始全新创作。");
      },
    });
  };

  const saveDraft = () => {
    const savedAt = stampSaved();
    const snapshot = saveSnapshot(currentWorkspace());
    setCurrentHistoryId(snapshot.id);
    pushLog("success", "保存草稿", `已保存「${snapshot.title}」到历史草稿库（${savedAt}）。`);
  };

  // 自动保存：开启后，核心字段变更后静默保存（不弹成功提示）
  useEffect(() => {
    if (!autoSaveEnabled) return undefined;
    const timer = setTimeout(() => {
      stampSaved();
    }, 1200);
    return () => clearTimeout(timer);
  }, [autoSaveEnabled, persona, keyword, writingBrief]);

  // 每次操作终态（成功/失败）写入日志，倒序展示
  useEffect(() => {
    if (cliStatus.state !== "success" && cliStatus.state !== "error") return;
    if (lastLoggedStatusRef.current === cliStatus) return;
    lastLoggedStatusRef.current = cliStatus;
    pushLog(cliStatus.state, cliStatus.label, cliStatus.text, {
      durationMs: cliStatus.durationMs,
      code: cliStatus.code,
    });
  }, [cliStatus]);

  const workspace = useMemo(
    () => ({
      persona,
      keyword,
      writingBrief,
      searchResults,
      selectedSearchIds,
      ragItems,
      topics,
      selectedTopicId,
      drafts,
      selectedDraftId,
      prompts,
      selectedPromptId,
      // Generated files live in a temporary server directory. Keep their metadata,
      // but allow the UI to fall back gracefully if a previous server has stopped.
      coverImage,
    }),
    [
      persona,
      keyword,
      writingBrief,
      searchResults,
      selectedSearchIds,
      ragItems,
      topics,
      selectedTopicId,
      drafts,
      selectedDraftId,
      prompts,
      selectedPromptId,
      coverImage,
    ],
  );

  // Hydrate the workspace from the SQLite database once on mount.
  const restoredRef = useRef(false);
  const handleWorkspaceRestored = useCallback((draft) => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    setPersona(draft.persona ?? defaultPersona);
    setKeyword(draft.keyword ?? defaultKeyword);
    setWritingBrief(draft.writingBrief ?? defaultBrief);
    setSearchResults(draft.searchResults || []);
    setSelectedSearchIds(draft.selectedSearchIds || []);
    setRagItems(draft.ragItems || []);
    setTopics(draft.topics || []);
    setSelectedTopicId(draft.selectedTopicId ?? null);
    setDrafts(draft.drafts || []);
    setSelectedDraftId(draft.selectedDraftId ?? null);
    setPrompts(draft.prompts || []);
    setSelectedPromptId(draft.selectedPromptId ?? null);
    setCoverImage(draft.coverImage || null);
    setLastSavedAt(draft.savedAt ? nowText() : "");
  }, []);

  const workspaceSavedAt = useWorkspaceDraft(workspace, {
    onRestored: handleWorkspaceRestored,
  });

  return (
    <div className="app-root" aria-label="薄荷工坊新版小红书 AI 助理">
      <header className="app-mobile-topbar">
        <button
          className="mobile-menu-btn"
          type="button"
          onClick={() => setMobileNavOpen(true)}
          aria-label="打开菜单"
        >
          ☰
        </button>
        <span className="mobile-title">薄荷工坊</span>
        <span className="mobile-save-hint">{lastSavedAt ? `已保存 ${lastSavedAt}` : ""}</span>
      </header>
      <aside
        className={`app-sidebar${mobileNavOpen ? " open" : ""}`}
        data-region="workflow-sidebar"
      >
        <div
          ref={topMenuRef}
          className={`sidebar-brand-menu ${topMenuOpen ? "open" : ""}`}
          onMouseEnter={handleMenuEnter}
          onMouseLeave={handleMenuLeave}
        >
          <div className="sidebar-brand">
            <button
              ref={topMenuTriggerRef}
              className="brand-trigger"
              type="button"
              onClick={() => setTopMenuOpen((v) => !v)}
              aria-expanded={topMenuOpen}
              aria-haspopup="menu"
              aria-label="操作菜单"
            >
              <SoftIcon tone="mint">叶</SoftIcon>
            </button>
            <div>
              <div className="sidebar-brand-title">薄荷工坊</div>
              <div className="sidebar-brand-subtitle">Mint Atelier</div>
            </div>
          </div>
          {topMenuOpen && popupPosition ? (
            <div
              className="sidebar-popup"
              style={{
                top: popupPosition.top,
                left: popupPosition.left,
              }}
              role="menu"
              aria-label="草稿操作"
            >
              <div className={`popup-automation ${autoSaveEnabled ? "on" : "off"}`}>
                <button
                  className="automation-main"
                  disabled={isBusy}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    if (!autoSaveEnabled) {
                      setAutoSaveEnabled(true);
                      return;
                    }
                    saveDraft();
                    setTopMenuOpen(false);
                    closeMobileNav();
                  }}
                >
                  <SoftIcon tone={autoSaveEnabled ? "mint" : "muted"}>存</SoftIcon>
                  <span className="automation-text">
                    <strong>保存草稿</strong>
                    <small>
                      {isBusy
                        ? "正在生成内容…"
                        : autoSaveEnabled
                          ? lastSavedAt
                            ? `已自动保存 ${lastSavedAt}`
                            : "编辑后自动保存"
                          : "自动保存已关闭，点击开启"}
                    </small>
                  </span>
                </button>
                <label
                  className="automation-switch"
                  title={autoSaveEnabled ? "关闭自动保存" : "开启自动保存"}
                >
                  <span className={`switch ${autoSaveEnabled ? "on" : ""}`}>
                    <input
                      type="checkbox"
                      checked={autoSaveEnabled}
                      onChange={(event) => setAutoSaveEnabled(event.target.checked)}
                      onClick={(event) => event.stopPropagation()}
                      aria-label="自动保存开关"
                    />
                    <i />
                  </span>
                </label>
              </div>
              <div className={`popup-automation ${automationEnabled ? "on" : "off"}`}>
                <button
                  className="automation-main"
                  disabled={isBusy}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    if (!automationEnabled) {
                      setAutomationEnabled(true);
                      return;
                    }
                    setTopMenuOpen(false);
                    closeMobileNav();
                    runAutomation();
                  }}
                >
                  <SoftIcon tone={automationEnabled ? "mint" : "muted"}>动</SoftIcon>
                  <span className="automation-text">
                    <strong>{automationRunning ? "自动化中..." : "自动化生成"}</strong>
                    <small>
                      {automationRunning
                        ? "正在串行执行创作流程"
                        : automationEnabled
                          ? "点击开始一键串行执行"
                          : "已关闭，点击此处开启"}
                    </small>
                  </span>
                </button>
                <label
                  className="automation-switch"
                  title={automationEnabled ? "关闭自动化生成" : "开启自动化生成"}
                >
                  <span className={`switch ${automationEnabled ? "on" : ""}`}>
                    <input
                      type="checkbox"
                      checked={automationEnabled}
                      onChange={(event) => setAutomationEnabled(event.target.checked)}
                      onClick={(event) => event.stopPropagation()}
                      aria-label="自动化生成总开关"
                    />
                    <i />
                  </span>
                </label>
              </div>
              <button
                className="popup-menu-item"
                type="button"
                role="menuitem"
                onClick={() => {
                  setTopMenuOpen(false);
                  closeMobileNav();
                  openDebugStore();
                }}
              >
                <SoftIcon tone="muted">据</SoftIcon>
                <span className="automation-text">
                  <strong>数据调试</strong>
                  <small>查看与导出本地数据库</small>
                </span>
              </button>
            </div>
          ) : null}
        </div>

        <section className="flow-nav" aria-label="创作流程">
          <header>
            <h3>创作流程</h3>
            <strong>{progress}%</strong>
          </header>
          <div className="progress-track">
            <i style={{ "--progress": `${progress}%` }} />
          </div>
          {flowSteps.map((step, index) => (
            <button
              key={step.id}
              className={activeStep === step.id ? "active" : ""}
              onClick={() => { toggleStep(step.id); closeMobileNav(); }}
              type="button"
            >
              <SoftIcon tone={activeStep === step.id ? "mint" : "muted"}>{index + 1}</SoftIcon>
              <span>
                <strong>{step.label}</strong>
                <small>{step.meta}</small>
              </span>
            </button>
          ))}
        </section>

        <section className="project-list">
          <header>
            <h3>历史草稿</h3>
            <span>{history.length}/20</span>
          </header>
          {history.length === 0 ? <p className="history-empty">手动保存后，可在这里回看完整创作内容。</p> : history.map((project) => (
            <div key={project.id} className={`history-item${currentHistoryId === project.id ? " active" : ""}`}>
              <button className="project" type="button" title={`${project.title}\n${project.meta} · ${new Date(project.savedAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}`} onClick={() => { loadHistory(project); closeMobileNav(); }}>
                <SoftIcon tone={currentHistoryId === project.id ? "mint" : "muted"}>稿</SoftIcon>
                <span>
                  <strong>{project.title}</strong>
                  <small>{project.meta} · {new Date(project.savedAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</small>
                </span>
              </button>
              <button className="history-remove" type="button" aria-label={`删除历史草稿 ${project.title}`} onClick={() => openConfirm({
                title: "删除这条历史草稿？",
                description: `「${project.title}」删除后不可恢复。`,
                confirmText: "删除",
                danger: true,
                onConfirm: () => {
                  removeSnapshot(project.id);
                  pushLog("info", "已删除历史草稿", project.title);
                },
              })}>×</button>
            </div>
          ))}
        </section>

        <button className="save-status-button" type="button" onClick={() => { saveDraft(); closeMobileNav(); }}>
          <SoftIcon tone="mint">存</SoftIcon>
          <span>{lastSavedAt ? `已保存 ${lastSavedAt}` : "保存与继续编辑"}</span>
        </button>
      </aside>
      {mobileNavOpen ? (
        <div
          className="app-drawer-backdrop"
          onClick={() => setMobileNavOpen(false)}
          aria-hidden="true"
        />
      ) : null}

      <main className="app-main" data-scroll-region="primary">
        <section className="hero-status">
          <div className="hero-progress">
            <div className="hero-title-row">
              <div>
                <span className="eyebrow">创作工作区</span>
                <h1>创作流程</h1>
              </div>
              <div className="workspace-actions">
                <span className="save-hint">{lastSavedAt ? `已保存 ${lastSavedAt}` : workspaceSavedAt ? "已恢复本地草稿" : "本地草稿会自动保存"}</span>
                <button className="ghost-button small" type="button" onClick={confirmResetGeneratedState} disabled={isBusy}>
                  清空生成结果
                </button>
              </div>
            </div>
            <div className="progress-bar">
              <i style={{ "--progress": `${progress}%` }} />
            </div>
            <p><strong className="progress-value font-tabular">{progress}%</strong>{nextStepHint}</p>
          </div>
          <div className="metric-grid">
            <div className="metric">
              <strong className="font-tabular">{searchResults.length}</strong>
              <span>搜索结果</span>
            </div>
            <div className="metric">
              <strong className="font-tabular">{ragItems.length}</strong>
              <span>RAG 参考</span>
            </div>
            <div className="metric">
              <strong className="font-tabular">{topics.length}</strong>
              <span>选题候选</span>
            </div>
            <div className="metric">
              <strong className="font-tabular">{drafts.length}</strong>
              <span>文案草稿</span>
            </div>
          </div>
        </section>

        <section className="stage-panels">
          <button
            className="new-creation-banner"
            type="button"
            onClick={startNewCreation}
            disabled={isBusy}
          >
            <span className="new-creation-icon" aria-hidden="true">＋</span>
            <span className="new-creation-text">
              <strong>新建创作</strong>
              <small>清空当前内容，开启一个全新的创作流程</small>
            </span>
            <span className="new-creation-go" aria-hidden="true">开始 ›</span>
          </button>

          <StagePanel
            stepNumber={1}
            id="input"
            title="账号人设与创作关键词"
            meta="设定账号定位与核心关键词"
            expanded={activeStep === "input"}
            onToggle={() => toggleStep("input")}
          >
            <div className="input-grid">
              <label className="field persona-field">
                <span>账号人设</span>
                <textarea
                  ref={personaRef}
                  maxLength={1000}
                  value={persona}
                  onChange={(event) => setPersona(event.target.value)}
                />
                <small>{persona.length} / 1000</small>
              </label>
              <label className="field keyword-field">
                <span>创作关键词</span>
                <input ref={keywordRef} value={keyword} onChange={(event) => setKeyword(event.target.value)} />
                <small>自动缓存</small>
              </label>
            </div>
          </StagePanel>

          <StagePanel
            stepNumber={2}
            id="research"
            title="热门内容搜索"
            meta="搜索只在点击后执行，结果不会自动入库"
            expanded={activeStep === "research"}
            onToggle={() => toggleStep("research")}
            actions={
              <button
                className="primary-button small"
                disabled={isBusy}
                type="button"
                onClick={runSearch}
              >
                {generatingKind === "search" ? "搜索中..." : "搜索热门内容"}
              </button>
            }
          >
            <div className="result-list">
              {searchResults.length === 0 ? (
                <div className="empty-state">
                  <SoftIcon tone="mint">搜</SoftIcon>
                  <p>输入关键词后点击搜索，热门内容会显示在这里。</p>
                </div>
              ) : (
                searchResults.map((result) => (
                  <div
                    key={result.id}
                    role="button"
                    tabIndex={0}
                    className={selectedSearchIds.includes(result.id) ? "search-result selected" : "search-result"}
                    onClick={() => openNoteDetail(result)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openNoteDetail(result);
                      }
                    }}
                  >
                    <input
                      checked={selectedSearchIds.includes(result.id)}
                      onChange={() => toggleSearchResult(result.id)}
                      onClick={(event) => event.stopPropagation()}
                      type="checkbox"
                      aria-label={`选择 ${result.title}`}
                    />
                    <span>
                      <strong>{result.title}</strong>
                      <p>{result.excerpt}</p>
                      <em>{result.metrics}</em>
                      <small>{result.source} | {result.keyword} | {result.lookupTime}</small>
                      <b>
                        {result.tags.map((tag) => (
                          <i key={tag}>#{tag}</i>
                        ))}
                      </b>
                    </span>
                  </div>
                ))
              )}
            </div>
          </StagePanel>

          <StagePanel
            stepNumber={3}
            id="rag"
            title="本地 RAG 知识库"
            meta="只保存用户勾选并确认的参考内容"
            expanded={activeStep === "rag"}
            onToggle={() => toggleStep("rag")}
            actions={
              <button className="primary-button small" disabled={isBusy} type="button" onClick={addToRag}>
                加入 RAG
              </button>
            }
          >
            <div className="rag-stack">
              {ragItems.length === 0 ? (
                <div className="empty-state">
                  <SoftIcon tone="mint">库</SoftIcon>
                  <p>勾选搜索结果后，点击加入本地 RAG。</p>
                </div>
              ) : (
                ragItems.map((item) => (
                  <article key={item.id} className="rag-item">
                    <div>
                      <strong>{item.title}</strong>
                      <p>{item.excerpt}</p>
                      <small>{item.tags.join(" / ")}</small>
                    </div>
                    <button type="button" onClick={() => removeRagItem(item.id)} aria-label={`移除 ${item.title}`}>
                      移除
                    </button>
                  </article>
                ))
              )}
            </div>
          </StagePanel>

          <StagePanel
            stepNumber={4}
            id="topics"
            title="生成选题"
            meta="参考人设、关键词与本地 RAG"
            expanded={activeStep === "topics"}
            onToggle={() => toggleStep("topics")}
            actions={
              <button
                className="primary-button small"
                disabled={isBusy}
                type="button"
                onClick={generateTopics}
              >
                {generatingKind === "topics" ? "生成中..." : "生成选题"}
              </button>
            }
          >
            <div className="topic-grid">
              {topics.length === 0 ? (
                <div className="empty-state inline">
                  <SoftIcon tone="mint">题</SoftIcon>
                  <p>完成搜索和 RAG 入库后，生成选题会出现在这里。</p>
                </div>
              ) : (
                topics.map((topic, index) => (
                  <button
                    key={topic.id}
                    className={selectedTopicId === topic.id ? "topic-card selected" : "topic-card"}
                    onClick={() => {
                      if (topic.id === selectedTopicId) return;
                      setSelectedTopicId(topic.id);
                      setDrafts([]);
                      setSelectedDraftId(null);
                      setPrompts([]);
                      setSelectedPromptId(null);
                      setCoverImage(null);
                    }}
                    type="button"
                  >
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <strong>{topic.title}</strong>
                    <p>{topic.angle}</p>
                    <small>{topic.audience}</small>
                    <em>{topic.hook}</em>
                  </button>
                ))
              )}
            </div>
          </StagePanel>

          <StagePanel
            stepNumber={5}
            id="drafts"
            title="撰写思路与文案"
            meta={selectedTopic ? selectedTopic.title : "先选择一个选题"}
            expanded={activeStep === "drafts"}
            onToggle={() => toggleStep("drafts")}
            actions={
              <button
                className="primary-button small"
                disabled={isBusy}
                type="button"
                onClick={generateDrafts}
              >
                {generatingKind === "drafts" ? "生成中..." : "生成文案"}
              </button>
            }
          >
            <label className="field brief-field">
              <span>补充撰写思路</span>
              <textarea
                ref={writingBriefRef}
                value={writingBrief}
                onChange={(event) => setWritingBrief(event.target.value)}
              />
            </label>
            <div className="draft-list">
              {drafts.length === 0 ? (
                <div className="empty-state">
                  <SoftIcon tone="mint">写</SoftIcon>
                  <p>选题确认后生成 5 篇文案。</p>
                </div>
              ) : (
                drafts.map((draft, index) => (
                  <button
                    key={draft.id}
                    className={selectedDraftId === draft.id ? "draft-card selected" : "draft-card"}
                    onClick={() => {
                      if (draft.id === selectedDraftId) return;
                      setSelectedDraftId(draft.id);
                      setPrompts([]);
                      setSelectedPromptId(null);
                      setCoverImage(null);
                    }}
                    type="button"
                  >
                    <span>文案 {index + 1}</span>
                    <strong>{draft.title}</strong>
                    <p>{draft.body}</p>
                  </button>
                ))
              )}
            </div>
          </StagePanel>

          <StagePanel
            stepNumber={6}
            id="cover"
            title="封面 Prompt 与封面图"
            meta="Prompt 默认禁真人、脸、手和动物，允许植物花材"
            expanded={activeStep === "cover"}
            onToggle={() => toggleStep("cover")}
            actions={
              <button
                className="primary-button small"
                disabled={isBusy}
                type="button"
                onClick={generatePrompts}
              >
                {generatingKind === "coverPrompts" ? "生成中..." : "生成 Prompt"}
              </button>
            }
          >
            <div className="cover-workspace">
              <div className="prompt-list">
                {prompts.length === 0 ? (
                  <div className="empty-state inline">
                    <SoftIcon tone="mint">图</SoftIcon>
                    <p>选择文案后生成 5 份封面 Prompt。</p>
                  </div>
                ) : (
                  prompts.map((prompt) => (
                    <button
                      key={prompt.id}
                      className={selectedPromptId === prompt.id ? "prompt-card selected" : "prompt-card"}
                      disabled={isBusy}
                      onClick={() => generateCoverImage(prompt.id)}
                      type="button"
                    >
                      <strong>{prompt.title}</strong>
                      <p>{prompt.prompt}</p>
                    </button>
                  ))
                )}
              </div>
              <div className="cover-result">
                <SectionHeader
                  icon="成"
                  tone="mint"
                  title="封面结果"
                  meta={generatingKind === "coverImage" ? "正在生成封面图" : coverImage ? `生成于 ${coverImage.createdAt}` : "点击 Prompt 后生成"}
                />
                <div className="cover-frame">
                  {generatingKind === "coverImage" ? (
                    <div className="cover-placeholder">
                      <SoftIcon tone="mint">成</SoftIcon>
                      <p>正在生成封面图...</p>
                    </div>
                  ) : coverImage ? (
                    <img
                      src={coverImage.src}
                      alt={coverImage.alt}
                      onError={() => setCoverImage(null)}
                    />
                  ) : (
                    <div className="cover-placeholder">
                      <SoftIcon tone="mint">图</SoftIcon>
                      <p>封面图会展示在这里。</p>
                    </div>
                  )}
                </div>
                <div className="prompt-keeper">
                  <span>原始 Prompt</span>
                  <p>{selectedPrompt?.prompt ?? "尚未选择封面 Prompt。"}</p>
                  <button
                    className="ghost-button"
                    disabled={isBusy}
                    type="button"
                    onClick={() => generateCoverImage()}
                  >
                    {generatingKind === "coverImage" ? "生成中..." : "重新生成"}
                  </button>
                  <button className="ghost-button" disabled={isBusy} type="button" onClick={() => coverUploadRef.current?.click()}>
                    导入本地图片
                  </button>
                  <input ref={coverUploadRef} className="cover-upload-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={importCoverImage} />
                </div>
              </div>
            </div>
          </StagePanel>
        </section>

        <section className="bottom-grid">
          <article className="card preview-card">
            <SectionHeader
              icon="预"
              tone="mint"
              title="小红书预览"
              meta={drafts.length ? "支持在下方切换不同文案预览" : "选择文案后实时查看草稿"}
              action={
                <div className="preview-actions">
                  {drafts.length > 0 ? (
                    <select
                      className="preview-draft-select"
                      value={previewDraftId ?? ""}
                      onChange={(event) => setPreviewDraftId(event.target.value || null)}
                      aria-label="切换预览文案"
                    >
                      <option value="">跟随当前选择</option>
                      {drafts.map((draft) => (
                        <option key={draft.id} value={draft.id} title={draft.title}>
                          {draft.title}
                        </option>
                      ))}
                    </select>
                  ) : null}
                  <button className="ghost-button small" type="button" onClick={openPostPreview}>
                    预览
                  </button>
                </div>
              }
            />
            <div className="post-card">
              <div className="post-author">
                <img src="/assets/avatar-creator.png" alt="" />
                <strong>薄荷小丸子</strong>
                <button type="button">关注</button>
              </div>
              <div className="post-cover-wrap">
                <img
                  className="post-cover"
                  src={coverImage?.src ?? "/assets/spring-outfit.png"}
                  alt={coverImage?.alt ?? "夏日穿搭系列封面预览"}
                />
                  <span className="cover-count">{coverImage?.source === "imported" ? "已导入" : coverImage ? "已生成" : "预览"}</span>
              </div>
              <h3>{previewDraft?.title ?? "选择一篇文案后，这里显示小红书标题"}</h3>
              <p>{previewDraft?.body ?? "正文预览会保留话题标签格式，例如 #夏日通勤[话题]#。"}</p>
              <footer>
                <span><b className="post-icon like">心</b>赞</span>
                <span><b className="post-icon star">星</b>藏</span>
                <span><b className="post-icon chat">话</b>评</span>
              </footer>
            </div>
          </article>

          <article className="card model-config-card">
            <SectionHeader icon="设" tone="mint" title="模型配置" meta="文案生成与图片生成分开配置，字段会自动缓存" />
            <div className="model-route-list">
              <ModelConfig
                channel="text"
                title="文案生成"
                icon="文"
                tone="mint"
                value={channelConfig("text")}
                onChange={(value) => updateModelConfig("text", value)}
                localClis={localClis}
                detectionState={cliDetectionState}
                onDetect={detectConfiguredClis}
              />
              <ModelConfig
                channel="image"
                title="图片生成"
                icon="图"
                tone="mint"
                value={channelConfig("image")}
                onChange={(value) => updateModelConfig("image", value)}
                localClis={localClis}
                detectionState={cliDetectionState}
                onDetect={detectConfiguredClis}
              />
            </div>
          </article>
        </section>

        <section className="card log-card">
          <header className="log-card-header">
            <div className="log-card-title">
              <SoftIcon tone="mint">志</SoftIcon>
              <div>
                <h2>操作日志</h2>
                <p>{logs.length ? `最近 ${logs.length} 条，最新在上` : "操作记录会显示在这里"}</p>
              </div>
            </div>
            {logs.length > 0 ? (
              <button
                className="ghost-button small"
                type="button"
                onClick={() => setLogs([])}
              >
                清空
              </button>
            ) : null}
          </header>

          <ul className="log-list">
            {cliStatus.state === "running" ? (
              <li className="log-item running">
                <span className="log-dot" />
                <div className="log-body">
                  <strong>{cliStatus.label}</strong>
                  <p>{cliStatus.text}</p>
                </div>
                <span className="log-time">进行中</span>
              </li>
            ) : null}

            {logs.length === 0 && cliStatus.state !== "running" ? (
              <li className="log-empty">
                <SoftIcon tone="muted">i</SoftIcon>
                <span>还没有操作记录，点击搜索、生成或自动化后会显示在这里。</span>
              </li>
            ) : (
              logs.map((log) => (
                <li key={log.id} className={`log-item ${log.type}`}>
                  <span className="log-dot" />
                  <div className="log-body">
                    <strong>{log.label}</strong>
                    <p>{log.text}</p>
                    {log.code ? <code>{log.code}</code> : null}
                  </div>
                  <div className="log-meta">
                    <span className="log-time">{log.time}</span>
                    {log.durationMs ? (
                      <span className="log-duration">{(log.durationMs / 1000).toFixed(1)}s</span>
                    ) : null}
                  </div>
                </li>
              ))
            )}
          </ul>
        </section>

        <footer className="app-footer">
          <span>薄荷工坊 · 小红书 AI 创作助理</span>
          <span>{cliStatus.state === "running" ? cliStatus.text : logs[0]?.text ?? "等待操作。"}</span>
        </footer>
      </main>

      {confirmDialog ? (
        <div
          className="confirm-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={confirmDialog.title}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeConfirm();
          }}
        >
          <div className="confirm-dialog" onMouseDown={(event) => event.stopPropagation()}>
            <div className={`confirm-icon ${confirmDialog.danger ? "danger" : ""}`} aria-hidden="true">
              {confirmDialog.danger ? "!" : "?"}
            </div>
            <h3>{confirmDialog.title}</h3>
            <p>{confirmDialog.description}</p>
            <div className="confirm-actions">
              <button className="ghost-button" type="button" onClick={closeConfirm}>取消</button>
              <button className={confirmDialog.danger ? "danger-button" : "primary-button"} type="button" onClick={resolveConfirm} autoFocus>
                {confirmDialog.confirmText}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {noteDetail ? (
        <div
          className="note-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="笔记详情"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeNoteDetail();
          }}
        >
          {noteDetail.mode === "preview" && drafts.length > 1 ? (
            <>
              <button
                type="button"
                className="note-preview-arrow is-prev"
                onClick={() => switchPreviewDraft(-1)}
                aria-label="上一篇"
              >{`<`}</button>
              <button
                type="button"
                className="note-preview-arrow is-next"
                onClick={() => switchPreviewDraft(1)}
                aria-label="下一篇"
              >{`>`}</button>
            </>
          ) : null}
          <div className="note-modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="phone-speaker" aria-hidden="true" />
            <div className="phone-statusbar" aria-hidden="true">
              <span>9:41</span><span>▮▮▮ ᴡɪꜰɪ ▰</span>
            </div>
            <button
              className="note-modal-close"
              type="button"
              onClick={closeNoteDetail}
              aria-label="关闭详情"
            >
              ×
            </button>

            {detailLoading ? (
              <div className="note-modal-loading">
                <span className="note-spinner" />
                <p>正在加载笔记详情…</p>
              </div>
            ) : (
              <div className="note-modal-scroll">
                {(() => {
                  const merged = [];
                  const seen = new Set();
                  [noteDetail.coverUrl, ...(noteDetail.images || [])].forEach((url) => {
                    if (url && !seen.has(url)) {
                      seen.add(url);
                      merged.push(url);
                    }
                  });
                  if (!merged.length) return null;
                  const total = merged.length;
                  const current = Math.min(carouselIndex, total - 1);
                  const go = (next) => setCarouselIndex((next + total) % total);
                  return (
                    <div
                      className="note-carousel"
                      aria-label="笔记媒体预览"
                      onTouchStart={(event) => {
                        const touch = event.changedTouches[0];
                        carouselTouchRef.current = { x: touch.clientX, y: touch.clientY };
                      }}
                      onTouchEnd={(event) => {
                        const start = carouselTouchRef.current;
                        carouselTouchRef.current = null;
                        if (!start || total <= 1) return;
                        const touch = event.changedTouches[0];
                        const dx = touch.clientX - start.x;
                        const dy = touch.clientY - start.y;
                        if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
                          go(dx < 0 ? current + 1 : current - 1);
                        }
                      }}
                    >
                      <div className="note-carousel-track">
                        {merged.map((url, index) => (
                          <figure
                            key={index}
                            className={index === current ? "note-carousel-slide is-active" : "note-carousel-slide"}
                            aria-hidden={index !== current}
                          >
                            <img
                              src={url}
                              alt={`${noteDetail.title || "笔记"} 图 ${index + 1}`}
                            />
                            {noteDetail.type === "video" && index === 0 ? (
                              <span className="note-type-badge">视频</span>
                            ) : null}
                          </figure>
                        ))}
                      </div>
                      {total > 1 ? (
                        <>
                          <button
                            type="button"
                            className="note-carousel-arrow is-prev"
                            aria-label="上一张"
                            onClick={() => go(current - 1)}
                          >
                            ‹
                          </button>
                          <button
                            type="button"
                            className="note-carousel-arrow is-next"
                            aria-label="下一张"
                            onClick={() => go(current + 1)}
                          >
                            ›
                          </button>
                          <div className="note-carousel-dots">
                            {merged.map((_, index) => (
                              <button
                                key={index}
                                type="button"
                                className={index === current ? "is-active" : ""}
                                aria-label={`第 ${index + 1} 张`}
                                onClick={() => setCarouselIndex(index)}
                              />
                            ))}
                          </div>
                          <span className="note-carousel-counter">{current + 1} / {total}</span>
                        </>
                      ) : null}
                    </div>
                  );
                })()}

                <div className="note-modal-body">
                  <p className="note-reading-label">{noteDetail.mode === "preview" ? "小红书发布预览" : "热门笔记详情"}</p>
                  <h2>{noteDetail.title || noteDetail.fallback?.title || "笔记详情"}</h2>

                  <div className="note-author-row">
                    <strong>{noteDetail.author || noteDetail.fallback?.author || "未知作者"}</strong>
                    {noteDetail.ipLocation ? <span>IP {noteDetail.ipLocation}</span> : null}
                    {noteDetail.publishedAt ? <span>{noteDetail.publishedAt}</span> : null}
                    {noteDetail.type && !noteDetail.coverUrl ? (
                      <span>{noteDetail.type === "video" ? "视频笔记" : "图文笔记"}</span>
                    ) : null}
                  </div>

                  {detailError ? (
                    <p className="note-modal-error">详情加载失败：{detailError}</p>
                  ) : null}

                  {noteDetail.desc ? (
                    <p className="note-modal-desc">{noteDetail.desc}</p>
                  ) : noteDetail.fallback?.excerpt ? (
                    <p className="note-modal-desc">{noteDetail.fallback.excerpt}</p>
                  ) : null}

                  {noteDetail.tags?.length ? (
                    <div className="note-modal-tags">
                      {noteDetail.tags.map((tag) => (
                        <i key={tag}>#{tag}</i>
                      ))}
                    </div>
                  ) : noteDetail.fallback?.tags?.length ? (
                    <div className="note-modal-tags">
                      {noteDetail.fallback.tags.map((tag) => (
                        <i key={tag}>#{tag}</i>
                      ))}
                    </div>
                  ) : null}

                  {noteDetail.metrics ? (
                    <div className="note-modal-metrics">
                      <span><b>赞</b>{noteDetail.metrics.liked || "—"}</span>
                      <span><b>藏</b>{noteDetail.metrics.collected || "—"}</span>
                      <span><b>评</b>{noteDetail.metrics.comments || "—"}</span>
                      <span><b>转</b>{noteDetail.metrics.shares || "—"}</span>
                    </div>
                  ) : noteDetail.fallback?.metrics ? (
                    <div className="note-modal-metrics">
                      <span>{noteDetail.fallback.metrics}</span>
                    </div>
                  ) : null}

                  {noteDetail.noteId ? (
                    <p className="note-modal-id">笔记 ID：{noteDetail.noteId}</p>
                  ) : null}
                </div>
              </div>
            )}
            <div className="phone-home-indicator" aria-hidden="true" />
          </div>
        </div>
      ) : null}

      {debugOpen ? (
        <div
          className="note-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="数据调试"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeDebugStore();
          }}
        >
          <div className="debug-modal">
            <button
              className="note-modal-close"
              type="button"
              onClick={closeDebugStore}
              aria-label="关闭"
            >
              ×
            </button>
            <div className="debug-modal-header">
              <h2>本地数据库调试</h2>
              {debugData?.dbPath ? (
                <span className="debug-dbpath" title={debugData.dbPath}>
                  {debugData.dbPath}
                </span>
              ) : null}
            </div>

            {debugLoading ? (
              <div className="note-modal-loading">
                <span className="note-spinner" />
                <p>正在读取数据库…</p>
              </div>
            ) : debugData?.error ? (
              <p className="note-modal-error">{debugData.error}</p>
            ) : debugData ? (
              <>
                <div className="debug-tabs">
                  {[
                    { key: "workspace", label: `工作区草稿` },
                    { key: "history", label: `历史快照 (${debugData.history.length})` },
                    { key: "model", label: "模型配置" },
                  ].map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      className={debugTab === tab.key ? "is-active" : ""}
                      onClick={() => setDebugTab(tab.key)}
                    >
                      {tab.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="debug-export"
                    onClick={exportDebugJson}
                  >
                    导出 JSON
                  </button>
                </div>
                <div className="debug-modal-body">
                  {debugTab === "workspace" ? (
                    <DebugJson
                      data={debugData.workspace}
                      hint={`最后保存：${debugData.workspaceSavedAt || "—"}`}
                    />
                  ) : null}
                  {debugTab === "history" ? (
                    debugData.history.length === 0 ? (
                      <p className="debug-empty">暂无历史快照。</p>
                    ) : (
                      <DebugJson data={debugData.history} />
                    )
                  ) : null}
                  {debugTab === "model" ? (
                    <DebugJson data={debugData.model} hint="包含 API 密钥，以明文存储于本地数据库。" />
                  ) : null}
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DebugJson({ data, hint }) {
  const text = JSON.stringify(data, null, 2);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard can be unavailable; the text is already visible.
    }
  };
  return (
    <div className="debug-json">
      <div className="debug-json-bar">
        <span>{hint || `共 ${text.length.toLocaleString()} 个字符`}</span>
        <button type="button" onClick={copy}>复制</button>
      </div>
      <pre>{text}</pre>
    </div>
  );
}
