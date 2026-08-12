# 薄荷工坊 / Mint Atelier

`薄荷工坊 / Mint Atelier` 是一个 React + Vite 桌面端 Web App，用于辅助生成小红书内容草稿。当前设计稿以阶段式工作台表达完整流程：人设和关键词输入、热门内容搜索、加入本地 RAG、生成选题、生成文案、生成封面 Prompt、生成封面图。

项目保持 3 列内容创作工作台形态，并保留 Pastel 3D Claymorphism 视觉方向。当前链路支持本机 `xhs` CLI 热门搜索、本地 Codex/Kimi/Claude/自定义规范 CLI 文本生成、Codex 本地图片生成，以及云端 OpenAI-compatible API 生成；RAG 入库支持用户手动勾选确认，也支持用户点击“自动化生成”后由文案模型选择参考内容并入库。

## 预览

![薄荷工坊桌面工作台预览](public/assets/mint-atelier-preview.jpg)

## 本地运行

最省心的启动方式：

- macOS：双击 `启动薄荷工坊.command`
- Windows：双击 `启动薄荷工坊.bat`

脚本会使用固定地址 `http://127.0.0.1:52880`，缺少 `node_modules` 时会先执行 `npm install`，然后等待本地服务启动并自动打开浏览器。模型配置写入浏览器 `localStorage`，固定地址可以避免端口变化导致缓存读不到。

命令行启动同一个固定地址：

```bash
npm run launch:fixed
```

开发时如果不想每次启动前构建，可以使用：

```bash
npm run launch:dev
```

本地构建后预览：

```bash
npm run deploy:local
```

临时启动开发服务器：

```bash
npm run dev
```

构建检查：

```bash
npm run build
```

本地 Codex CLI 默认通过系统 PATH 查找 `codex`，可通过环境变量覆盖：

```bash
CODEX_CLI_PATH=/path/to/codex npm run launch:fixed
```

Kimi CLI 默认通过系统 PATH 查找 `kimi`，可通过环境变量覆盖。首次使用前请在终端完成 `kimi login`；页面点击“检测本机 CLI”后会显示版本和可用状态：

```bash
KIMI_CLI_PATH=/path/to/kimi npm run launch:fixed
```

Claude Code 默认通过系统 PATH 查找 `claude`，可通过环境变量覆盖。首次使用前请在终端完成 `claude auth login`；适配器使用官方非交互 JSON 模式，并关闭工具调用和会话持久化：

```bash
CLAUDE_CLI_PATH=/path/to/claude npm run launch:fixed
```

右侧“文案生成”可以选择 Codex、Kimi、Claude，或填写符合 Mint Atelier print protocol 的自定义命令。自定义 CLI 需要支持 `--version`、`--prompt`、可选 `--model` 和 `--output-format stream-json`，最终 stdout 需包含 `{"role":"assistant","content":"<valid JSON>"}`。本地图片生成当前只显示具备 native imagegen 能力的 Codex CLI。

小红书热门搜索通过本机 `xhs` CLI 触发，默认通过系统 PATH 查找 `xhs`，默认只使用 CLI 已保存登录态：

```bash
XHS_CLI_COMMAND=/path/to/xhs XHS_COOKIE_SOURCE=none npm run launch:fixed
```

如果搜索提示未登录，请先在终端手动运行 `xhs login`，再回到页面点击搜索。前端不会读取、展示或保存 Cookie。

云端 API 路线在右侧模型配置中填写：模型名称、API Key、API Base URL。文案生成走 `POST /chat/completions`，图片生成走 `POST /images/generations`，服务端会把图片结果统一校验并发布为 `/generated/covers/*.png`。

## 文档入口

- `docs/SPEC.md`：详细产品规格和完整核心流程。
- `AGENTS.md`：项目契约、边界、实现地图和修改规则。
- `docs/DESIGN.md`：视觉系统、布局规则和资产风格。
- `docs/VERIFICATION.md`：构建、截图和交互验证清单。
- `docs/QA_LOG.md`：最近视觉 QA 记录和当前状态。

## 当前项目状态

- 左侧：品牌、创作者资料、创作流程、草稿项目、保存入口。
- 中间：概览、人设关键词、热门搜索、RAG 入库、选题候选、撰写思路、文案候选、小红书预览、封面 Prompt 和 PNG 封面图结果。
- 右侧：文案模型配置、本机 CLI 选择与主动检测、图片模型配置、生成通道状态、错误提示、错误覆盖检查。
- 本地 React state 驱动流程推进、结果选择、错误提示和封面图展示；人设、关键词、撰写思路和模型配置会写入 `localStorage`。

核心边界：搜索、RAG 入库、文本生成和封面图生成都必须由用户主动点击触发；“自动化生成”只代表本次点击授权串行完成搜索、模型决策入库、生成与封面图生成，不做后台轮询。当前不做自动发布、自动点赞、自动评论、自动收藏、自动关注、自动私信或自动批量采集。
