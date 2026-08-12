# Configuration & Externalized Settings Inventory

This React + Vite desktop web app is configured primarily through npm scripts, Vite config, and environment-variable overrides for local CLI tools. No external config server, Docker compose, Kubernetes, or .NET/Spring runtime profiles were detected in the workspace.

## Configuration Sources

| Source | Type | Path/Location | Notes |
|---|---|---|---|
| npm scripts | Build/runtime scripts | `package.json` | Defines local dev, fixed dev, build, preview, and launch workflows |
| Vite config | Build/runtime config | `vite.config.mjs` | Defines local dev server middleware and plugin registration |
| Fixed launch wrapper | Runtime startup script | `scripts/start-fixed.mjs` | Starts npm script, waits for server readiness, opens browser |
| Local generation API middleware | Runtime server plugin | `server/codex/api.mjs` | Routes browser `/api/*` requests to local generation and search handlers |
| Codex CLI wrapper | Runtime CLI override | `server/codex/runCodex.mjs` | Reads `CODEX_CLI_PATH`, launches `codex` commands |
| Image generation wrapper | Runtime CLI override | `server/codex/coverImage.mjs` | Reads `CODEX_CLI_PATH`, runs `codex exec ... --sandbox workspace-write` for imagegen |
| Local CLI registry | Runtime CLI config | `server/localCli/registry.mjs` | Reads `CODEX_CLI_PATH`, `KIMI_CLI_PATH`, `CLAUDE_CLI_PATH` and validates CLI commands |
| Xiaohongshu CLI wrapper | Runtime CLI config | `server/xhs/runXhs.mjs` | Reads `XHS_CLI_COMMAND`, `XHS_COOKIE_SOURCE`, and launches `xhs search ... --json` |
| Browser persisted settings | Client runtime storage | `src/App.jsx` / `window.localStorage` | Persists persona, keywords, model config, and workflow state |
| README / docs | Operational guidance | `README.md`, `docs/VERIFICATION.md`, `docs/SPEC.md` | Documents environment overrides and CLI expectations |

## Build Profiles

| Profile | Activation | Purpose | Key Dependencies/Plugins |
|---|---|---|---|
| `dev` | `npm run dev` | Start Vite development server on default host/port | `vite` |
| `dev:fixed` | `npm run dev:fixed` | Start Vite dev server on fixed address `127.0.0.1:52880` | `vite` |
| `build` | `npm run build` | Produce production bundle | `vite build` |
| `preview` | `npm run preview` | Preview production build on local server | `vite preview` |
| `preview:fixed` | `npm run preview:fixed` | Preview production build on fixed local address `127.0.0.1:52880` | `vite preview` |
| `launch:fixed` | `npm run launch:fixed` | Install deps if needed, launch fixed preview and open browser | `node scripts/start-fixed.mjs`, `npm run deploy:local` |
| `launch:dev` | `npm run launch:dev` | Install deps if needed, launch dev server and open browser | `node scripts/start-fixed.mjs`, `npm run dev:fixed` |
| `deploy:local` | `npm run deploy:local` | Build and preview production bundle locally | `npm run build`, `npm run preview:fixed` |

## Runtime Profiles

| Profile | Activation Method | Config Files | Key Overrides |
|---|---|---|---|
| Default local frontend | `npm run dev`, `npm run preview`, `npm run launch:*` | `vite.config.mjs` | `NODE_ENV` is implicitly controlled by Vite; no explicit profile-specific files found |
| Fixed local preview | `npm run launch:fixed` | `scripts/start-fixed.mjs` | fixed host/port `127.0.0.1:52880` via script and Vite CLI flags |
| Fixed dev server | `npm run dev:fixed` | `vite.config.mjs`, CLI args | `--host 127.0.0.1 --port 52880 --strictPort` |

> Note: No `application.*`, `.env.*`, `appsettings.*`, `bootstrap.*`, or profile-specific config files were detected.

## Properties Inventory

### Environment variables and CLI overrides

| Property Key | Default | Profiles | Source |
|---|---|---|---|
| `CODEX_CLI_PATH` | `codex` (fallback) | all | `server/codex/runCodex.mjs`, `server/codex/coverImage.mjs`, `server/localCli/registry.mjs` |
| `KIMI_CLI_PATH` | `kimi` (fallback) | all | `server/localCli/registry.mjs` |
| `CLAUDE_CLI_PATH` | `claude` (fallback) | all | `server/localCli/registry.mjs` |
| `XHS_CLI_COMMAND` | `xhs` (fallback) | all | `server/xhs/runXhs.mjs` |
| `XHS_COOKIE_SOURCE` | `none` (fallback) | all | `server/xhs/runXhs.mjs` |
| `OUTPUT` | `json` | all | `server/xhs/runXhs.mjs` (injected into CLI env) |
| `NO_COLOR` | `1` | all | `server/codex/coverImage.mjs`, `server/localCli/registry.mjs` (injected into CLI env) |

### Browser persisted runtime settings

| Property Key | Default | Profiles | Source |
|---|---|---|---|
| `mint-atelier-v2:persona` | default persona string | all | `src/App.jsx` localStorage |
| `mint-atelier-v2:keyword` | default keyword string | all | `src/App.jsx` localStorage |
| `mint-atelier-v2:writingBrief` | default writing brief string | all | `src/App.jsx` localStorage |
| `mint-atelier-v2:modelConfig` | `text.provider=local`, `image.provider=local`, default CLI IDs and empty cloud API fields | all | `src/App.jsx` localStorage |

> Note: No `process.env`-backed configuration file values were found for cloud provider credentials or external config services beyond the runtime CLI overrides above.

## Startup Parameters & Resource Requirements

| Service | Runtime Options | Memory | Instance Count |
|---|---|---|---|
| Mint Atelier local app | `npm run dev`, `npm run dev:fixed`, `npm run build`, `npm run preview`, `npm run preview:fixed`, `npm run launch:fixed`, `npm run launch:dev` | not specified | single local instance |
| Fixed launch wrapper | `node scripts/start-fixed.mjs` | not specified | single launch process |

> Note: No JVM settings, Docker/Kubernetes resource limits, or explicit memory/CPU allocations were found.

## Startup Dependency Chain

1. `scripts/start-fixed.mjs` starts `npm run deploy:local` or `npm run dev:fixed`, and waits for `http://127.0.0.1:52880` ready state with a 30s timeout.
2. `vite.config.mjs` boots the Vite server and registers `server/codex/api.mjs` middleware for local generation/search API routes.
3. Browser UI loads and calls `/api/*` endpoints, which route through `server/codex/api.mjs` to local CLI wrappers and cloud provider code.
4. `server/xhs/runXhs.mjs` requires the external `xhs` CLI to be installed and logged in before search can succeed.
5. `server/codex/runCodex.mjs`, `server/codex/coverImage.mjs`, and `server/localCli/registry.mjs` require the external `codex`, `kimi`, `claude`, or custom CLI commands to be available via PATH or overriden env vars.

## Secrets & Sensitive Configuration

| Secret Reference | Type | Storage (masked) |
|---|---|---|
| `modelConfig.text.apiKey` | Cloud API key | browser localStorage / in-memory state |
| `modelConfig.image.apiKey` | Cloud API key | browser localStorage / in-memory state |
| `API Base URL` | Cloud endpoint | browser localStorage / in-memory state |
| `CODEX_CLI_PATH`, `KIMI_CLI_PATH`, `CLAUDE_CLI_PATH` | CLI executable path overrides | environment variables |
| `XHS_CLI_COMMAND`, `XHS_COOKIE_SOURCE` | Xiaohongshu CLI overrides | environment variables |

### Secrets Provisioning Workflow

Secrets and sensitive configuration are provided by the user at runtime rather than by a managed secret store. The application reads environment variables from the shell inherited by `scripts/start-fixed.mjs` and from the browser UI state persisted to `localStorage`.

- Secret source: user-provided environment variables and browser-entered cloud API credentials.
- Identity/access model: local process environment only; no managed identity, Key Vault, Vault, or cloud secret manager references were detected.
- Provisioning sequence: `scripts/start-fixed.mjs` inherits `process.env` and launches Vite or preview scripts; server-side modules read override values from `process.env` and pass them to external CLI commands.
- Service bindings:
  - local generation/image services require CLI paths and potentially custom commands
  - Xiaohongshu search service requires `XHS_CLI_COMMAND` and `XHS_COOKIE_SOURCE`
  - cloud generation services require user-provided API key and Base URL in the UI

> Note: The repository contains no encrypted property values, no Jasypt/DPAPI metadata, and no sealed secret references.

## Feature Flags

| Flag Name | Default | Controlled By |
|---|---|---|
| `text generation provider` | `local` | browser model config (`modelConfig.text.provider`) |
| `image generation provider` | `local` | browser model config (`modelConfig.image.provider`) |
| `local CLI selection` | `codex` | browser model config (`modelConfig.*.cliId`) |
| `use custom CLI command` | disabled | browser model config + `cliCommand` value |

> Note: No external feature flag service or feature-management framework was detected. Conditional behavior is implemented through UI-driven provider selection and CLI capability checks.

## Framework & Runtime Versions

| Component | Version | Source |
|---|---|---|
| React | `19.2.0` | `package.json` |
| React DOM | `19.2.0` | `package.json` |
| Vite | `6.4.2` | `package.json` |
| `@vitejs/plugin-react` | `5.0.4` | `package.json` |
| npm | not pinned | `package.json` `scripts` usage |
| Node.js | not pinned | ESM module usage in `package.json` and server scripts |
| `type: module` | enabled | `package.json` |

> Note: No Docker base image versions, Maven/Gradle/MSBuild versions, or explicit runtime engine constraints were found in the repository.
