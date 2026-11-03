# AI 教材工作台 · 离职移交文档

> 文档版本：2026-11-03  
> 适用版本：0.1.0（P0 资料库 / 助手原页证据）  
> 代码版本：`85d0a56 feat: 本地资料库导入与助手 OCR 原页证据`（本文档在此基础上另有一次文档提交）  
> 远程状态：截至本文撰写，`main` 尚未包含该提交；移交前必须执行 `git push origin main`（2026-11-03 本次推送遇到网络重置）  
> 安装包：`release/AI教材工作台-Setup-0.1.0.exe`  
> SHA256：`804704444ACD7A4C0A0465F5028DDDBF9992A6B120585A122F9898EA3B00DC02`

本文分为两部分：

- **第一部分：开发说明**——给接手的开发同事。目标是让一个“会用 AI Agent、但不熟悉本项目”的人，在一天内能定位代码、跑起来、判断哪些功能真的能用、知道下一步该做什么。
- **第二部分：使用教学**——给老师。目标是不看终端、不读代码，也能完成资料识别、教材制作、审校、检索和导出。

如果两部分内容冲突，以 `profile.md` 和代码为准；本文是交接视角的汇总，不是新的产品权威文档。

## 文档目录

- [第一部分：开发说明](#第一部分开发说明)
  - 接手前先看这 6 句话 / 项目是什么 / 当前状态 / 第一天清单
  - 获取项目与 Agent 接管 / 技术架构 / 功能实现地图
  - 开发命令 / 构建发布 / 进度 / 已知缺陷
  - 常用提示词 / AI 基础 / 维护规则 / 交接清单
- [第二部分：使用教学](#第二部分使用教学)
  - 安装与界面 / 资料识别 / 本地资料库 / 教材制作
  - 教材审校 / 通用助手 / 规则库 / 备份与排障

---

# 第一部分：开发说明

## 1. 接手前先看这 6 句话

1. **这是本地个人工具，不是多人 Web 平台。** 没有账号、协作、远程数据库、外部业务 API。
2. **本地文件是唯一事实源。** 教材、OCR 结果、规则、版本、审校记录、导出物都在安装目录的 `document/` 里；数据库只是索引/缓存的替代品，本项目已经移除 Supabase。
3. **OCR 是确定性能力，生成/建议/审校是模型能力。** 不要把 OCR 任务和 LLM 调用混成一个“AI 黑盒”；排错时要先分清是哪一层。
4. **生成不是“整本 PDF 喂给模型”。** 走结构化来源、模块骨架、规则快照、Lesson Context、迁移计划和校验；不要用朴素 RAG 替代。
5. **最高原则是 Preserve → Adapt → Generate。** 能沿用旧版就沿用，不符合新版结构才改写，旧版没有的才生成；人工确认优先于规则，规则优先于模型知识。
6. **老师的数据不能因为代码更新或卸载而丢。** 卸载保留 `document/`；移除资料进回收区；修改原件前必须确认范围。

## 2. 项目是什么

面向教研老师的 Windows x64 本地工具：

```text
资料识别 → 教材制作 → 教材审校
                 ↘ 通用助手（只读检索）
```

目标是把旧版教材、规则和 Cambridge 参考资料加工为可追溯的本地资产，按新版 Lesson/Module 结构生成四书初稿，由老师编辑、确认、审校并导出 DOCX。

**目标用户**：独立制作教材的教研老师，使用自己的电脑、自己的本地工作区。

**不是**：团队协作平台、云端教材库、在线编辑器、自动发布系统、OCR 云服务、通用聊天机器人。

## 3. 当前状态速览（2026-11-03）

| 项目 | 状态 |
| --- | --- |
| 本地文件工作区 | 已完成 |
| Electron 桌面壳 / 一键安装包 | 已完成 |
| MinerU 便携 OCR / 页图 / 结构 JSON | 已完成 |
| 学生用书 / 知识清单 / 练习册生成 | 可用，质量仍需教研复核 |
| 单词小超市（第四书） | **未完成**：没有模块定义，无法生成 |
| 独立审校工作台 | 已完成单模块、单本书；**整课范围未完成** |
| 修改建议助手 | 已完成 Context Pack 与建议卡片 |
| 通用助手 | 已完成；已接入 OCR 教材、资料库 PDF/Markdown、原页证据 |
| 本地资料库 | 已完成 PDF/Markdown 导入、索引、移除回收 |
| 设置页 | **未完成**（左侧导航显示“准备中”） |
| 生成规则随包 | **未完成**：安装包只有审校规则；生成规则在开发工作区，未随包 |
| 代码签名 / 干净 VM / 自动更新 | **未完成**，见缺陷章节 |

**当前安装包**：

- 1.55 GB；安装后约 3.0 GB
- OCR 运行时与模型约 2.5 GB
- 范本集合页图约 66 MB
- 未签名；内网构建使用本地 Electron 分发，未写 exe 图标/版本资源（见 11.7）

**最近验证**：

- `npm test`、`npm run lint`、`npx tsc --noEmit` 通过
- `npm run verify:release` 通过
- 安装版：健康检查、OCR、扫描件自动 OCR、数字版 PDF 页图、资料库导入/移除、助手 OCR 页证据、范本集合补装均已实测

## 4. 先做这 6 件事（接手第一天）

1. **拿到完整项目，不只 clone GitHub。** 见 §5；生成规则、`.env.local`、OCR runtime 等被 gitignore，必须单独交接。
2. **读文档顺序**：`AGENTS.md` → `profile.md` → `PRODUCT.md` → `question.md` → `docs/HANDOVER.md` → `docs/OCR-ENGINE-DECISION.md` → `docs/REVIEW-SKILL-INTEGRATION.md` → `docs/AI-ASSISTANT-RETRIEVAL.md` → `workflow.md` → 本文。
3. **跑一次基线**：`npm ci` → `npm test` → `npm run lint` → `npx tsc --noEmit`。
4. **跑一次应用**：`npm run dev` 或 `npm run desktop:dev`，确认工作区在 `D:\APP\document`（开发时）。
5. **让 Agent 出一份接手报告**：不要让它直接改代码；见 §12 的提示词模板。
6. **确认生成规则和 AI Key 是否齐全**：这是当前最容易“看起来能跑、实际少一半能力”的两个坑。

## 5. 如何获取整个项目并让本地 Agent 接管

### 5.1 从 GitHub 获取代码

仓库：

```text
https://github.com/ForgetMe-not726/Tal.git
```

```powershell
git clone https://github.com/ForgetMe-not726/Tal.git D:\APP
cd D:\APP
git log -1 --oneline
npm ci
```

截至本文撰写，代码最新提交是 `85d0a56`；本次尝试推送时 GitHub 连接被重置，远程 `main` 仍落后。**交接前必须确认代码和本文档所在的提交都已推送**；先在原开发机执行：

```powershell
cd D:\APP
git push origin main
```

如果仓库权限不能转移，至少把 `D:\APP` 完整复制给接手人，并保留 `.git`，不要只给一个 zip 源码目录。

### 5.2 必须单独交接的、不在 git 的资产

以下路径被 `.gitignore` 排除，clone 后不会出现：

| 资产 | 原机路径 | 是否必须 | 说明 |
| --- | --- | --- | --- |
| AI Gateway 配置 | `D:\APP\.env.local` | **必须** | 含 `AI_API_KEY`；用公司允许的安全渠道传递，不要发群/邮件明文 |
| 生成规则（工作区） | `D:\APP\document\rules\R-SB-*`、`R-WB-*` | **必须** | 34 条生成规则；安装包目前没有 |
| 全部工作区规则 | `D:\APP\document\rules\` | 建议 | 62 条规则，含审校规则 |
| 范本/知识集合 | `D:\APP\document\knowledge\collections\` | 建议 | 开发版约 492 MB；安装包只带精简页图/模块 |
| OCR 运行时 | `D:\APP\build\ocr\` | 可选 | 2.5 GB；也可用脚本重建 |
| 便携 OCR 模型 | `D:\APP\build\ocr\models\` | 可选 | 与 runtime 一起交接最省事 |
| 安装包 | `D:\APP\release\AI教材工作台-Setup-0.1.0.exe` | 必须 | 发给老师的交付物；1.55 GB |
| 安装包校验 | `D:\APP\release\SHA256SUMS.txt` | 必须 | 校验值 |
| 生成的发布 AI 配置 | `D:\APP\resources\config\ai.json` | 可选 | 由 `.env.local` 生成，含 Key；不要提交 git |
| 开发测试数据 | `D:\APP\document\projects\`、`document\ocr\`、`document\library\` | 可选 | 可能含老师/教材数据，按公司数据规定处理，不要随意扩散 |

**建议的交接包**：

```text
项目代码（含 .git）
document/rules/                  （最重要）
document/knowledge/collections/  （如空间允许）
.env.local                       （安全渠道）
release/AI教材工作台-Setup-0.1.0.exe
release/SHA256SUMS.txt
build/ocr/                       （如空间允许；否则让接手人重建）
```

不要把 `.env.local`、`resources/config/ai.json`、`document/` 推送到 GitHub。

### 5.3 环境要求

- Windows 10/11 x64
- Node.js 20.9+；当前验证环境 Node 24.19.0、npm 11
- PowerShell（构建 OCR runtime 使用）
- 首次构建 Electron/NSIS 需要网络，或提前缓存 Electron、NSIS、7zip、icons
- 不需要系统 Python；OCR runtime 自带便携 Python
- 需要公司 AI Gateway 的 URL/Key/模型名，或使用现有 `.env.local`

### 5.4 安装依赖和重建 OCR runtime

```powershell
cd D:\APP
npm ci

# 仅当没有 build/ocr 时需要；脚本会准备便携 Python + MinerU + pipeline 模型
powershell -ExecutionPolicy Bypass -File scripts/build-ocr-runtime.ps1
```

`build/ocr` 约 2.5 GB，不提交 git。脚本和许可证说明见 `scripts/build-ocr-runtime.ps1`、`build/ocr/licenses/`。

### 5.5 配置 AI Gateway

`.env.local` 至少需要：

```dotenv
AI_PROVIDER=openai-compatible
AI_BASE_URL=http://ai-service.tal.com/openai-compatible/v1/chat/completions
AI_API_KEY=<公司内部 key，不要写进本文档或 git>
AI_MODEL_GENERATION=gpt-5.6-luna
AI_MODEL_REVIEW=gpt-5.6-luna
AI_MODEL_VISION=qwen3.8-27b-tal
# 可选：AI_AUTH_MODE / AI_TEMPERATURE
```

生成桌面发布配置：

```powershell
npm run configure:ai
```

它会：

- 从 `.env.local` 生成 `resources/config/ai.json`（含 Key，gitignore）
- 如果本机已安装桌面版，同时更新安装目录的配置，并用 Electron DPAPI 写 `%APPDATA%\AI教材工作台\ai-key.bin`

### 5.6 启动开发版

```powershell
npm run dev
# 浏览器打开 http://localhost:3000
```

或启动 Electron 壳：

```powershell
npm run desktop:dev
```

开发模式下工作区默认是：

```text
D:\APP\document\
```

可以用 `AI_TEACHING_WORKSPACE` 指定测试工作区，用 `AI_TEACHING_INSTALL_DIR` 指定安装根目录。

### 5.7 让本地 Agent 接管

直接用 Claude Code / Codex / 其他 Agent 打开 `D:\APP`，先发这一段：

```text
你是接手 D:\APP「AI 教材工作台」的开发 Agent。先不要改代码。

请按顺序阅读：
AGENTS.md、profile.md、PRODUCT.md、question.md、docs/HANDOVER.md、
docs/OCR-ENGINE-DECISION.md、docs/REVIEW-SKILL-INTEGRATION.md、
docs/AI-ASSISTANT-RETRIEVAL.md、docs/TRANSFER.md、workflow.md。

然后输出一份接手报告，必须包含：
1. 项目目标、当前架构、运行时数据流；
2. 已实现功能与对应代码入口；
3. 未完成功能和已知缺陷（特别是生成规则未随包、设置页、单词小超市、整课审校）；
4. 本地启动、测试、构建、安装包验证命令；
5. 你认为接手后前 3 个应该修的问题，以及理由；
6. 任何信息不足、需要我确认的事项。

不要运行删除/覆盖 document/ 的命令，不要打印 .env.local 或 API Key。
报告完成后等我确认，不要直接改代码。
```

Agent 工作守则：

- 大改动先让它进入 plan mode，先给方案再动手。
- 明确要求“先读相关文件，再改；改完运行最小充分测试”。
- 明确禁止：删除 `document/`、覆盖原件、把 Key 写进输出、未经确认批量重写教材。
- 让它每次结束报告：改了哪些文件、跑了什么命令、结果、未完成项。
- Agent 看不到 GUI 时，用 `npm run dev` + Playwright/浏览器验证页面；桌面选择框需要 Electron 实机验证。

## 6. 技术架构

### 6.1 栈

- Next.js 16.3.2 App Router，React 19.2.8，TypeScript
- Tailwind CSS 4，Radix UI，lucide-react
- Next standalone 作为本机服务
- Electron 45.1.0 桌面壳；electron-builder 26.18.0，NSIS per-user 安装
- `docx` 生成 DOCX；`react-markdown` / `remark-gfm` / `turndown` 编辑与 Markdown 处理
- 本地文件存储；没有数据库服务
- OCR：MinerU 3.4.5 pipeline + 便携 CPython 3.13 + `pypdfium2`
- AI：OpenAI-compatible Chat Completions，SSE 流式

### 6.2 运行时目录

```text
<安装目录>\
  AI教材工作台.exe
  resources\
    app\                    Next standalone：server.js + node_modules + .next
    config\ai.json          发布 AI 配置（含内部 Key，gitignore）
    rules\                  随包规则基线（当前只有审校规则）
    knowledge\
      grammar\              22 个语法参考
      review-standards\     审校判据
      collections\          随包范本集合（构建时从 build/knowledge-collections 带入）
    ocr\
      python\ venv\ models\ 便携 OCR runtime
  document\                 老师工作区（卸载保留）
    rules\                  规则库（工作区副本）
    knowledge\              资料库/集合/语法/审校判据
    library\                老师导入的 PDF/Markdown
    ocr\                    OCR 结果（<term>-<book>-ocr）
    projects\<project-id>\  项目/Lesson/书/模块/版本/来源
    exports\
    .app\
      jobs\                 任务记录
      logs\                 日志
      retrieval\            可重建索引/页图缓存
    .recycle\               移除资料/集合的回收区
```

### 6.3 启动流程

```text
Electron main
  → 选择空闲 127.0.0.1 端口
  → 设置 AI_TEACHING_INSTALL_DIR / MINERU_HOME / AI_* 环境变量
  → 用 ELECTRON_RUN_AS_NODE 启动 resources/app/server.js
  → 轮询 /api/health
  → BrowserWindow 打开 http://127.0.0.1:<port>
```

详见 `electron/main.cjs`。服务只监听 loopback，不监听局域网；外部导航被阻止。

### 6.4 页面

| 路径 | 作用 |
| --- | --- |
| `/` | 主页：资料识别/教材制作/教材审校入口、通用助手、规则库 |
| `/recognize` | 资料识别：导入、OCR、页图、结构化正文、切分核对、确认 |
| `/workbench` | 教材制作：大纲、Lesson、书种、模块、生成、编辑、版本、建议、导出 |
| `/review` | 教材审校：范围、任务、Finding、人工决定、HTML 报告 |
| `/library` | 本地资料库：本地 PDF/Markdown、OCR 来源、范本集合、语法/审校判据 |

`/settings` **没有实现**；侧栏显示“准备中”。

### 6.5 API 入口

核心：

```text
POST /api/ocr                         导入 PDF/图片或已处理 OCR 产物
GET  /api/ocr                         任务列表 + 引擎状态
GET  /api/ocr/:jobId                  单个任务/结构摘要
GET  /api/ocr/:jobId/raw/...          content.md / structure.json / pages
PATCH/DELETE/POST /api/ocr/:jobId     修订/取消/重试
POST /api/ocr/:jobId/confirm          确认来源
GET  /api/ocr/sources                 已确认来源（制作页）
GET  /api/ocr/library/:dir/...        稳定 OCR 原页/正文读取（不依赖任务记录）

GET/POST /api/library                 资料库概览/导入
GET/DELETE /api/library/items/:id     资料详情/移除
GET  /api/library/items/:id/page      按需 PDF 页图
POST /api/library/items/:id/retry     重新索引/OCR
POST /api/library/open               打开工作区/OCR/知识库/资料库/回收区

POST /api/outline/ingest              解析 .xlsx 大纲（不持久化）
GET  /api/module-definitions          模块目录（按书种/课型）
POST /api/generate                    生成 Module 并保存版本
GET  /api/modules/versions            版本历史
POST /api/modules/versions            人工保存新版本
POST /api/suggestions                 Module 修改建议
GET  /api/source-content              来源条目

POST /api/review                      启动审校
GET  /api/review/:jobId               结果（任务/manifest/findings/decisions）
PATCH /api/review/:jobId              老师处理 Finding
POST /api/review/:jobId/report        生成 HTML 报告
GET  /api/review/:jobId/report        读取报告
GET  /api/review/context              项目/Lesson/模块上下文

POST /api/assistant                   通用助手只读检索
POST /api/export/docx                 Markdown -> DOCX
GET  /api/ai/diagnostics              AI 状态/模型
GET  /api/health                      桌面壳健康检查
```

### 6.6 代码地图

```text
app/                         页面 + API 路由
components/                  UI（workbench/recognize/review/assistant/console/evidence）
electron/                    main / preload / set-ai-key
lib/
  ai/                        AI Gateway、模型选择、SSE
  assistant/                 通用助手：corpus / match / OCR 证据 / 文本工具
  db/                        文件存储（替代数据库）
  generation/                生成管线、目标、覆盖检查、迁移计划
  knowledge/                 来源、集合、旧版解析、检索、Context
  library/                   本地 PDF/Markdown 资料库、OCR 队列
  markdown/                  Markdown/表格/词卡/标题层级
  modules/                   模块目录与骨架
  ocr/                       MinerU adapter、任务、归一化、页图
  outline/                   XLSX 大纲解析
  review/                    审校 Pipeline、Findings、报告
  rules/                     规则解析、作用域、版本、确定性检查
  suggestions/               建议 Context Pack、解析、应用
  workspace/                 路径、JSON/文件、bootstrap、迁移
scripts/                     构建、测试、迁移、验收辅助
resources/                   随包规则/知识/配置基线
build/                       构建产物（OCR、staged collections、图标等）
document/                    开发工作区（gitignore）
```

### 6.7 数据模型

```text
Project → Grade → Term/Course → Lesson → 四书 → Module → Module Version
```

- **四书**：学生用书 `student`、练习册 `workbook`、知识清单 `knowledge`、单词小超市 `vocab`
- 最小生成单位是完整 Module
- 每个 Module Version 保存 markdown、metadata、迁移计划、规则快照、来源 refs、检索 trace、生成模型信息
- 来源分三层：Production Source（已确认旧教材）、Authoritative Standards（Cambridge/CEFR/词表）、Reference Materials（真题/教辅/参考）
- 规则分 `generation` / `review` 两类；支持 Global / Project / Grade / Book / Module / Lesson Override；Hard 不可被低层覆盖；版本化 + 快照
- Review 事实源是 `findings.json`；HTML 报告可重建；不带严重度

## 7. 功能实现地图

### 7.1 资料识别

- 入口：`app/recognize/page.tsx`、`components/recognize/*`
- 任务：`lib/ocr/jobs.ts`、`lib/ocr/service.ts`
- 引擎：`lib/ocr/mineru.ts`、`lib/ocr/pages.ts`
- 归一化：`lib/ocr/normalize.ts`、`lib/knowledge/ocr-pages.ts`
- 关键事实：
  - MinerU 默认 `pipeline`，不能默认 hybrid（CPU 会跑不动）
  - 页数只认 PDF 本身，不认 MinerU 日志里的区域数
  - 页图由 `pypdfium2` 渲染
  - 失败/中断清理任务与产物，最多留 10 条；已确认来源永不自动删
  - 确认前是“待核对”，确认后才是 Production Source

### 7.2 本地资料库

- 入口：`app/library/page.tsx`、`app/api/library/*`
- 存储：`lib/library/store.ts`
- PDF 文字/页图：`lib/library/pdf.ts`
- 扫描件 OCR：`lib/library/ocr.ts`
- 助手检索：`lib/library/search.ts`
- 特征：
  - 原件复制到 `document/library/<item>/files/`
  - 索引/OCR 页图在 `.app/retrieval/`
  - 数字版 PDF 直接抽逐页文字；文字不足 50% 自动 MinerU OCR
  - OCR 串行队列；应用重启后未完成任务标失败，可重试
  - 移除到 `.recycle/library/`，不永久删除
  - 资料库文档目前只进通用助手，不进入生成/建议 Context Pack

### 7.3 生成

- 入口：`app/workbench/page.tsx`、`app/api/generate`
- 服务：`lib/generation/service.ts`
- 骨架：`lib/modules/directory.ts`
- 目标：`lib/generation/objectives.ts`
- 迁移计划：`lib/generation/planner.ts`
- 覆盖/英文检查：`lib/generation/coverage.ts`
- 来源：`lib/knowledge/retriever.ts`、`source-selection.ts`、`legacy-*.ts`
- 上下文：`lib/knowledge/context-builder.ts`
- Prompt 在 `lib/generation/service.ts` 的 `buildPrompt()`；要求 Preserve/Adapt/Generate、结构完整、空字段留空、学生书/练习册英文、表格 Markdown、不要模型总结

### 7.4 审校

- 入口：`app/review/page.tsx`、`app/api/review/*`
- 服务：`lib/review/service.ts`
- 报告：`lib/review/report.ts`
- 规则/标准：`resources/rules/*`（24 条）、`resources/knowledge/review-standards/`
- 八段 Pipeline：Preprocessor → Rule Checks → Cross-book → Cambridge → Language → LLM → Aggregator → Teacher Review
- 范围目前 `module` / `book`；`lesson` 不支持
- Finding 不带 severity；支持 adopt / ignore / recheck；报告无脚本、无远程资源

### 7.5 修改建议

- 入口：`components/workbench/WorkbenchSuggestionPanel.tsx`、`app/api/suggestions`
- Context Pack：`lib/suggestions/context-pack.ts`
- 规则压缩保留 ID/Hard/Scope/约束/冲突
- 输出只进建议卡片；点“采用”只改草稿，保存才生成新版本
- 当前 Cambridge/参考资料层可能为空；`known_gaps` 要如实显示

### 7.6 通用助手

- 入口：`components/assistant/AssistantPanel.tsx`、`app/api/assistant`
- 检索 adapter：`lib/assistant/adapter.ts`、`local-search.ts`
- OCR 语料：`lib/assistant/ocr-corpus.ts`、`ocr-evidence.ts`
- 资料库语料：`lib/library/search.ts`
- 先由模型生成查询计划（关键词/过滤），再用本地字面检索；**结果即答案，不做模型总结**
- 只读；不提供“应用到教材”
- OCR/资料库 PDF 命中带 pageIndex/box/ocrJobId/pageImageUrl；Markdown 无页图

### 7.7 规则库

- 首页 `RuleLibrary` 组件；导入 Markdown 规则文件、删除规则文件
- 文件存储：`lib/db/file-store.ts`、`lib/rules/*`
- 规则作用域/版本/发布/绑定 API 在 `app/api/rules/*`
- 导入规则直接写工作区，不改随包基线

### 7.8 DOCX

- `app/api/export/docx`、`lib/export/docx.ts`
- 只读工作台当前 Markdown blocks，不读数据库
- 版式对齐秋下知识清单成稿；测试在 `scripts/test-export.mjs`

## 8. 开发命令

```powershell
npm run dev                 # Next 开发服务器
npm run build               # next build --webpack
npm run start               # 生产服务（standalone 时用 node 启动）
npm run lint                # ESLint
npx tsc --noEmit            # 类型检查
npm test                    # 全部离线测试
npm run desktop:dev         # Electron 开发壳
npm run desktop:standalone  # Electron + standalone（需先 build/prepare）
npm run desktop:prepare     # 补 .next/static/public/chunks
npm run stage:collections   # 整理 build/knowledge-collections
npm run dist:win            # 完整 Windows 打包 + 发布自检
npm run verify:release      # 校验 release/win-unpacked 与安装包
npm run configure:ai        # 生成/更新 AI 配置
```

单独测试：

```powershell
npm run test:assistant
npm run test:library
npm run test:ocr-corpus
npm run test:ocr-jobs
npm run test:review-skill
npm run test:collections
npm run test:export
```

## 9. 构建与发布

### 9.1 一键构建

```powershell
npm ci
powershell -ExecutionPolicy Bypass -File scripts/build-ocr-runtime.ps1
npm run configure:ai -- --build-only
npm run dist:win
```

`dist:win` 顺序：

```text
configure-ai --build-only
→ stage:collections
→ next build --webpack
→ desktop:prepare
→ electron-builder --win nsis
→ verify:release
```

### 9.2 打包要点

- `next.config.ts`: `output: "standalone"`；`outputFileTracingExcludes` 排除 `document/`、`build/`、`resources/ocr/`
- `electron-builder.yml`: `extraResources` 带 `resources/`、`build/knowledge-collections`、`build/ocr`
- `build/after-pack.cjs`: 删除 `win-unpacked/document` 残留；把 `.next/standalone/node_modules` 复制到 `resources/app/node_modules`
- `scripts/prepare-desktop.mjs`: 补 `.next/static`、`public`、`.next/server/chunks`
- `scripts/verify-release.mjs`: 校验安装包/资源/collection/OCR/AI 配置，写 `release/SHA256SUMS.txt`

### 9.3 当前离线构建的注意点

`electron-builder.yml` 设置了：

```yaml
electronDist: node_modules/electron/dist
win:
  signAndEditExecutable: false
```

原因：内网机器访问 GitHub 下载 `winCodeSign` 超时；`signAndEditExecutable:false` 会跳过 exe 图标/版本资源编辑。主程序仍能运行、安装包仍可安装，但主 exe 的图标/版本资源没有写入。证书和网络就绪后应恢复正常的签名构建（或改用本地 `rcedit` 在 `afterPack` 中写资源）。

### 9.4 签名、自动更新、干净 VM

见本文 §11.7–11.9。当前均未完成。

## 10. 开发进度清单

### 已完成

- 2026-09-03 起：本地文件工作区替代 Supabase/协作/远程数据库
- 2026-09：MinerU OCR adapter、任务清理、页数修正、页图/结构
- 2026-09/10：旧版学生用书、知识清单、练习册解析与规则迁移
- 2026-10-09：审校 Skill 24 条规则、独立审校页、Findings、报告
- 2026-10-09：修改建议 Context Pack、建议卡片
- 2026-10-30：Electron 桌面壳、一键安装包、便携 OCR、AI Key
- 2026-11-02：卸载/升级保留 document、发布自检、SHA256
- 2026-11-03：通用助手 OCR 原页证据；本地资料库导入/移除/自动 OCR；随包范本集合

### 部分完成

- 学生用书/知识清单/练习册生成：可产出、可保存、可导出，但结构完整性和内容质量仍需教研复核
- 审校：单模块/单书可用；整课不可用；报告可用；报告后的 DOCX 未在工作台内直接提供
- OCR：可用；Lesson/Module 边界只能在正文里改，不能可视化编辑边界
- 范本集合：随包 `autumn-2026-l5`；集合导入/移除的教师 UI 还没做（只有通用 PDF/Markdown 导入）
- 本地资料库：通用 PDF/Markdown 可用；集合仍是安装包基线

### 未完成

- 生成规则随包（当前最大的交付缺口）
- 设置页
- 单词小超市（第四书）
- 整课审校
- 干净 VM 全流程验收、签名、自动更新
- 生成质量门禁（空小节/空词卡/编号行）

## 11. 已知缺陷、风险与未完成功能

### 11.1 生成规则没有随安装包（最优先）

- 开发工作区 `D:\APP\document\rules\` 有 **34 条 generation 规则**（R-SB-001~024、R-WB-001/002/003/005/006/007/009/010/012/013）
- `resources/rules/` 只有 **24 条 review 规则**；安装版 `document/rules` 也只有 24 条 review
- 结果：安装版生成时规则快照为空，生成质量依赖大纲/来源/骨架/模型
- 原因：Q-CORE-018 要求生成规则草案经教研确认后才能转正随包；当前是默认不转正
- 下一步：让教研确认规则；确认后把 R-SB/R-WB 放入 `resources/rules/` 或建立单独的生成规则基线；安装版需补装/新装。短期内部试用可把 `D:\APP\document\rules` 的 R-SB/R-WB 复制到安装版 `document/rules`，但不要提交 git。

### 11.2 设置页缺失

- 侧栏 `/settings` 是 `ready:false`
- 老师不能改工作区、AI Gateway、OCR 选项
- 当前 AI 配置由发布包/`.env.local`/DPAPI 管理，对内部工具够用，但不是完整产品
- 下一步：实现只读诊断 + 受限配置页；不要暴露 Key 明文

### 11.3 第四书未实现

- `BOOK_TYPES` 有 `vocab`，但模块目录只有 knowledge/student/workbook；`/api/module-definitions?bookType=vocab` 返回空
- 单词小超市没有素材/规则/骨架；无法生成
- 绘本不在四书范围，但也没有纳入
- 对外不能说“四书全部完成”

### 11.4 整课审校缺失

- `ReviewScope` 只有 `module` / `book`；`scope:"lesson"` 返回“审校范围不受支持”
- 产品文档要求“当前 Module、单书或完整 Lesson”
- 数据契约可以扩展，但选择器/汇总视图/报告统计未做

### 11.5 OCR 边界编辑只读

- 资料识别页能看“切分核对：N 个讲次”，但不能拖拽/编辑 Lesson/Module 边界
- 老师只能改整段 Markdown；边界靠标题/页眉识别
- 这是 PRODUCT §4.1 的缺口

### 11.6 生成质量门禁不足

- 生成可产出空表/空小节/孤立编号行（实测词卡前有 `1`、`2`，空词卡、空 `FCE 话题词汇联想`）
- 当前 Hard Rule/覆盖检查能拦一部分，但没有“结构完整性/空小节/空表格”通用门禁
- 修改建议/审校可以帮助发现，但不应依赖模型兜底
- 生成结果必须当 Draft，不能当成品

### 11.7 安装包未签名 + exe 资源编辑关闭

- 没有代码签名证书；SmartScreen 会提示“未知发布者”
- 本次内网构建设置 `signAndEditExecutable:false`，主 exe 图标/版本资源未写入
- 证书就绪后：设置 `CSC_LINK` / `CSC_KEY_PASSWORD`，恢复 `signAndEditExecutable`；或用 `rcedit` 写图标/版本
- 企业 AppLocker/WDAC/Smart App Control 可能直接拦截未签名程序

### 11.8 干净 VM 验收未完成

- 当前测试机已装开发环境，不是干净 Windows
- 需要在一台未装 Node/Python 的 Windows x64 上走完 HANDOVER §2 的 10 步
- 当前安装包已在本机实测：安装、启动、OCR、扫描件自动 OCR、资料库、助手原页、集合补装；仍需干净机复验

### 11.9 自动更新未配置

- `latest.yml` / `.blockmap` 会生成，但应用没有 `electron-updater`，没有更新源
- `latest.yml` 的 path 是 ASCII，实际安装包名是中文；启用自动更新前必须统一
- 当前按安装包手动覆盖升级；`document/` 保留

### 11.10 资料库 OCR 的恢复边界

- OCR 队列是进程内串行；应用重启后未完成任务会标 `failed`，可点“重新处理”
- 大扫描件耗时较长；不要把它当作即时操作
- 移除正在 OCR 的条目会先取消并提示稍后再移除
- 资料库文档目前只进通用助手，不进生成/修改建议 Context Pack

### 11.11 审校/模型的已知不确定性

- LLM 审校可能报出正文没有的问题（Q-CORE-026）；当前保留并标注“未经核实/无正文定位”
- 4 条 `human_visual` 规则无法在文字稿上执行，标 `insufficientEvidence`
- 审校标准没有逐元素“通过项”记录（Q-CORE-028）
- 结论不带 severity 是已确认的产品决策，不是缺陷
- 审校报告是 HTML 查看；审校页没有直接 DOCX 导出（用制作页导出）

### 11.12 其他

- 生成规则、知识集合、`.env.local`、`build/ocr`、安装包都不在 git；clone 不等于完整项目
- 开发工作区 `document` 可能含测试/老师数据；交接按公司数据规定处理
- `Q-CORE-030/031/033` 等已被 P0 部分改变，但审校/建议的旧来源条目仍可能没有页码；原页证据以 OCR/资料库导入路径为准
- 规则草案/教材内容版权与分发范围遵循 A-018；随包集合 license 字段已写“内部教研使用；随包分发经需求方确认”
- 安装包内 AI Key 是内部工具口径，不是可公开分发模型

## 12. 常用开发/检修提示词

> 用法：在 `D:\APP` 打开 Agent，先贴提示词，再把报错/截图/文件路径补上。不要一次让 Agent 改十个模块；一次聚焦一个可验证问题。

### 12.1 接手/全局审查

```text
你是接手 D:\APP 的开发 Agent。先读 AGENTS.md、profile.md、PRODUCT.md、question.md、
docs/HANDOVER.md、docs/TRANSFER.md、workflow.md，不要先改代码。

请输出：
1. 当前架构和数据流（页面 → API → lib → 工作区文件）；
2. 已实现功能和代码入口；
3. 未完成/有缺陷的功能，按“影响老师使用”排序；
4. 你认为最优先的 3 个修复，以及每个的验证方法；
5. 需要我确认的问题。

约束：不要删除/覆盖 document/，不要打印 Key，不要未经确认批量改教材。
```

### 12.2 修 Bug

```text
请修复这个 Bug，先定位再改：
- 复现步骤：
- 期望：
- 实际：
- 相关页面/接口/文件：
- 最近改动：

要求：
1. 先读相关代码和测试，说明根因；
2. 只改必要文件，保持现有抽象和命名；
3. 补一个能复现该问题的测试（如果项目测试体系允许）；
4. 运行最小充分验证：相关 test + lint + tsc；
5. 报告修改、验证结果、未覆盖风险。
不要用“看起来对”代替实际运行。
```

### 12.3 OCR 页数/进度问题

```text
请检查资料识别任务的页数与进度：
1. 读取 document/.app/jobs/<jobId>.json、document/ocr/<dir>/manifest.json、structure.json；
2. 核对 PDF 实际页数（pypdfium2）与 manifest.pageCount；
3. 检查 MinerU 日志/进度是否把区域数当页数；
4. 检查失败/中断清理是否留下进程、上游目录、页图；
5. 给出根因、修复点和回归测试。

不要删除已确认来源；不要直接改老师原件。
```

### 12.4 生成质量/迁移规则问题

```text
请按 Preserve → Adapt → Generate 检查这个 Module 的生成质量：
- 项目/Lesson/书种/模块：
- 大纲 lessonProfile：
- 使用来源：
- 期望样张：
- 实际 markdown：

检查：
1. 目标词汇/语法/阅读/技能是否按大纲；
2. 旧版栏目是否正确映射（Hello Vocabulary → Let's say 等）；
3. 课时目标是否固定格式、英文、无中文；
4. 表格/词卡/空小节/编号行是否符合样张；
5. 规则快照、来源 refs、迁移计划是否随版本保存。

先报告差异和证据，不要直接重写规则或教材。
```

### 12.5 审校问题

```text
请检查审校结果：
- jobId：
- 范围/书种/模块：
- findings.json / manifest.json / decisions.json：

确认：
1. Finding 是否有正文定位/规则依据/证据；
2. 是否不带 severity；
3. 是否有重复/无依据结论；
4. 老师决定是否保存、报告是否可重建；
5. 报告是否无脚本/远程资源。

不要删除原始 Finding；不要用模型自由生成整页 HTML。
```

### 12.6 资料库/助手原页问题

```text
请排查本地资料库与通用助手：
1. document/library/<item> 的原件、索引、OCR 缓存是否一致；
2. PDF 是文字版还是扫描件，自动 OCR 状态/错误；
3. /api/assistant 是否命中 library:/ocr:，是否带 pageIndex/pageImageUrl；
4. 页图路由是否 200，路径是否 containment；
5. 移除是否进 .recycle，索引是否清理。

不要永久删除原文件；先用测试 Markdown/PDF 复现。
```

### 12.7 打包/发布

```text
请做一次发布回归：
1. npm test、npm run lint、npx tsc --noEmit；
2. npm run dist:win；
3. npm run verify:release；
4. 安装包 SHA256、大小、集合/OCR/AI 配置；
5. 在安装版验证 health、OCR、资料库导入、扫描件自动 OCR、助手原页；
6. 报告任何 warning（例如 latest.yml path 不一致）和未完成项。

不要在没有备份的情况下卸载/覆盖老师工作区。
```

### 12.8 规则/文档更新

```text
请更新规则或产品文档：
- 先读 profile.md / PRODUCT.md / question.md 的相关章节；
- 说明改动属于产品决策、规则变更还是实现细节；
- 规则变更要保留 rule ID、作用域、Hard/Soft、版本/快照；
- 未确认事项追加到 question.md，并写默认处置；
- 不要用模型猜测代替教研确认。
```

## 13. 给新手的 AI 基本知识

### 13.1 LLM 是什么

LLM 根据上下文预测下一个 token。它没有数据库、没有事实校验器，输出是概率性的。模型“说得像”不等于“教材正确”。所以本项目的原则是：

```text
规则/来源/人工确认 > 模型生成
```

### 13.2 常见词

- **Token**：模型处理文本的单位，约等于字/词片段；影响成本、上下文上限和速度。
- **Context window**：一次请求能放多少 token；整本教材不能无脑塞入。
- **Prompt**：给模型的指令 + 上下文。系统消息定角色/纪律，用户消息放任务。
- **Temperature**：随机性。教材生成不建议高温度；本项目默认不发送 temperature，除非显式配置。
- **Streaming / SSE**：模型逐块返回；本项目 AI Gateway 用流式，避免长请求超时。
- **Stop reason / max tokens**：`length`/`max_tokens` 表示被截断；生成侧遇到截断必须报错，不能保存半成品。
- **Hallucination**：模型编造。要来源定位、规则 ID、`INSUFFICIENT_EVIDENCE` 和人工复核。
- **RAG / Retrieval**：先检索本地资料，再把片段放进上下文。本项目用**结构化检索**，不是整本 PDF 向量化。
- **Embedding**：把文本变向量做语义相似度；本项目只把它当可替换能力，不替代 Lesson/Module 来源边界。
- **Agent / Tool use**：模型调用工具（读文件、跑命令、搜索）。Agent 能做事，也会做错；必须限定权限、先计划、后验证。
- **OCR vs LLM**：OCR 把图像转结构化文本；LLM 生成/判断。OCR 错会导致后面全错，所以确认来源是硬门槛。
- **Evaluation**：用真实样张、正例、反例、已知错误集评估，不靠“看起来不错”。

### 13.3 本项目里模型负责什么

- 生成 Module 初稿
- 生成修改建议
- 审校的语言/语义检查
- 通用助手把自然语言问题翻成查询计划

**不负责**：OCR 识别、规则解析、来源确认、确定性检查、HTML 报告模板、版本保存、页数统计。

### 13.4 提示词/上下文纪律

- 规则压缩必须保留规则 ID、Hard/Soft、作用域、约束、冲突；不能只做自然语言摘要。
- Cambridge/本地资料必须带来源定位；不能把整本资料塞入。
- 模型不能直接输出整页 HTML；报告由固定模板生成。
- 模型输出必须校验/转义；不能直接执行。
- 任何“无来源结论”都要显示资料缺口，不要补造。

## 14. 代码维护规则

- 先读 `AGENTS.md` 和 `CLAUDE.md`；项目规则优先。
- 不新增数据库/远程 API；本地文件是事实源。
- 文件写入用 `writeJson`/原子写；路径用 `safeSegment`/containment 校验。
- 不把教材内容、路径、模型名写死进业务代码；通过工作区/manifest/配置替换。
- 不删除老师原件；批量改/删先显示范围并确认。
- 生成/接受建议/人工保存都产生新版本，不覆盖历史。
- Finding 不带 severity；报告固定模板、无脚本。
- 私有 Key 不进 git、不进日志、不进文档。
- 每次改完：`npm test`、`npm run lint`、`npx tsc --noEmit`；涉及打包再 `npm run dist:win` + 安装回归。
- 大改先 plan；小改直接做；完成后写清验证结果。

## 15. 交接清单（离职前必须完成）

- [ ] 把最新 commit 推到 GitHub，确认同事能 clone
- [ ] 给同事 GitHub 仓库权限/转移仓库
- [ ] 通过安全渠道交接 `.env.local`（含 AI Key）
- [ ] 交接 `D:\APP\document\rules\`（尤其 R-SB/R-WB 生成规则）
- [ ] 交接 `D:\APP\document\knowledge\collections\`（如需要）
- [ ] 交接 `build/ocr/` 或确认同事能重建
- [ ] 交接 `release/AI教材工作台-Setup-0.1.0.exe` + `SHA256SUMS.txt`
- [ ] 说明安装包未签名、未做干净 VM、未配置自动更新
- [ ] 说明设置页、单词小超市、整课审校、生成规则随包未完成
- [ ] 说明公司 AI Key 的归属/轮换方式；离职后是否继续使用需负责人确认
- [ ] 处理开发机上的老师/教材数据，按公司数据规定备份或清除
- [ ] 让接手人按本文 §4/§5 跑一遍，并提交自己的接手报告
- [ ] 约定第一个里程碑：生成规则随包 + 干净 VM 验收

## 16. 需要教研/需求方确认的事项

不要自行拍板，统一记录到 `question.md`。当前最影响接手的：

- Q-CORE-018：生成规则何时转正、随包？
- Q-CORE-025：整课审校何时做？
- Q-CORE-030：Cambridge/参考资料层如何导入？P0 资料库是否替代？
- Q-CORE-033：旧来源无页码，是否重导？
- Q-SB-007/010/011/012/013 等：学生书目标/星号/英式英语/题量
- Q-KL-008：知识清单学习目标固定四行
- Q-WB-006/008/009/011：练习册规则冲突与复习课
- Q-VB/Q-PB：小超市/绘本是否在范围

---

# 第二部分：使用教学

> 给老师的使用说明。软件是本地工具，所有教材、OCR、规则和导出物都在你电脑的安装目录里；不需要登录、上传云端或安装 Python/Node。

## 1. 软件是什么

AI 教材工作台把旧版教材 PDF/图片、规则和参考资料变成可追溯的本地来源，帮助你按新版 Lesson/Module 结构制作教材初稿，并做本地审校和 DOCX 导出。

三个主功能：

1. **资料识别**：把扫描 PDF/图片变成可编辑、可确认的本地来源；
2. **教材制作**：按大纲/模块生成学生用书、知识清单、练习册初稿；
3. **教材审校**：按 24 条公司审校标准检查已保存版本，人工处理并生成 HTML 报告。

主页还有：

- **通用助手**：只读检索本地教材、OCR、资料库 PDF/Markdown、规则和语法参考，能看原页；
- **规则库**：导入/删除规则文件。

## 2. 安装与第一次启动

1. 双击 `AI教材工作台-Setup-0.1.0.exe`。
2. Windows 可能提示“未知发布者”（当前未签名）；确认来源后选择“更多信息 → 仍要运行”。
3. 安装是一键、当前用户级，不需要管理员权限；默认安装目录：
   `%LOCALAPPDATA%\Programs\ai-textbook-workbench`。
4. 双击桌面“AI教材工作台”快捷方式。
5. 第一次启动会在安装目录下创建：
   `document\`（你的工作区）、`document\library\`、`document\ocr\`、`document\knowledge\` 等。
6. 不需要配置端口、Node、Python、模型路径；公司 AI Gateway 已随包配置。

**如果安装目录不可写**：把软件装到你自己的可写目录；不要装到 `Program Files` 等需要管理员权限的位置。

## 3. 界面地图

左侧导航：

- **资料识别**：导入/识别 PDF、图片，查看页图/结构，确认来源。
- **教材制作**：选项目/Lesson/书种/模块，生成、编辑、版本、建议、导出。
- **教材审校**：独立审校工作台。
- **本地资料库**：老师导入的 PDF/Markdown、OCR 来源、范本/语法/审校判据。
- **设置**：当前显示“准备中”，暂不可用。
- 左上角套准十字：返回主页；主页有通用助手和规则库。

## 4. 资料识别

### 4.1 导入

1. 打开“资料识别”。
2. 选择学期（寒假/春季/暑假/秋季）和书种（学生用书/知识清单/练习册/单词小超市）。
3. 点击“选择 PDF / 图片”，选一个 PDF 或 JPG/PNG；也可以“导入已处理过的 OCR 产物”。
4. 文件会复制到工作区；原文件不会被改写。

### 4.2 看进度

- 任务列表显示“识别中”、页数进度或阶段百分比（如“识别中 · 文字识别 62%”）。
- 识别在后台跑，关闭页面不会取消；可以稍后回来。
- 大 PDF 需要几分钟；页数以 PDF 本身为准。

### 4.3 核对与修订

1. 点任务，右侧出现原页和正文。
2. 左侧选页，点击块可定位；低置信块会提示。
3. 在“识别结果正文”里直接改文字、表格、标题。
4. 展开“切分核对”看会被切成几个讲次、每讲有哪些栏目。
5. 修改后点“保存修订”。

### 4.4 确认来源

- 只有点“确认并加入资料库”后，这份 OCR 才会变成制作页可用的“已确认来源”。
- 确认前是“待核对”，不能参与生成。
- 失败/中断/取消的任务会被清理；重新导入即可。失败原因在日志里，不留在任务列表。
- 已确认来源不会被自动删除。

### 4.5 注意

- 当前不能拖拽编辑 Lesson/Module 边界；边界靠标题/页眉识别，只能改正文。
- 扫描件识别质量取决于原图；确认前务必抽查页数、标题、表格和词卡。
- OCR 页图是证据；不要删除 `document/ocr` 里的已确认目录。

## 5. 本地资料库

“本地资料库”管理四类东西：

1. 老师导入的 PDF/Markdown（`document/library`）；
2. 已确认 OCR 教材；
3. 范本/参考资料集合（随包或内部准备）；
4. 语法参考、审校判据。

### 5.1 导入 PDF/Markdown

1. 打开“本地资料库”。
2. 点“导入文件”：可多选 PDF、`.md`、`.markdown`；每个文件一个条目。
3. 或点“导入文件夹”：选一个文件夹，保留子目录，只复制 PDF/Markdown。
4. 导入后立即出现在“本地资料”列表；原件复制到资料库，不会移动/改写原文件。

### 5.2 状态

- **可检索**：Markdown 已索引；数字版 PDF 已抽取文字；扫描件 OCR 完成。
- **处理中**：正在抽取/OCR；扫描件会显示进度阶段。
- **部分可检索**：部分页没有文字，已索引的页可用。
- **需要识别/失败**：没有可检索文字或 OCR 失败；点“重新处理”重试。
- **需要本机 OCR**：扫描件自动 OCR 的中间状态。

### 5.3 使用

- 通用助手会检索资料库里的 Markdown 和已索引 PDF；PDF 命中可“查看原页”。
- 资料库文档当前用于**检索/参考**，不会自动进入教材生成或修改建议的上下文；生成仍以已确认来源和随包范本为准。
- 数字版 PDF 直接抽文字；扫描件自动调用本机 MinerU，耗时较长。

### 5.4 移除与回收

- 点条目“移除”，确认后移到 `document\.recycle\library\`，不会永久删除。
- 需要恢复时，把回收区对应文件夹移回 `document\library\`，或联系管理员。
- 处理中的条目先等完成或重试后再移除。

### 5.5 资料库文件夹

- 打开“打开资料库”可看到 `document\library`。
- 备份：整个 `document` 一起复制，至少保留 `library`、`ocr`、`knowledge`、`rules`、`projects`、`exports`。

## 6. 教材制作

### 6.1 开始前准备

1. 在“资料识别”导入并确认旧版来源；
2. 准备新版部门大纲 `.xlsx`；
3. 在“资料库”确认有范本/参考资料（随包 `autumn-2026-l5` 已带）。

### 6.2 选择上下文

在“教材制作”左栏：

1. 选择学期、年级、Lesson 编号和标题。
2. 选择书种：学生用书/知识清单/练习册（单词小超市当前不可用）。
3. 选择课型：常规课/复习课。复习课规则：
   - 春季/秋季第 5、10、15 课，夏季/冬季第 7 课是复习课；
   - 复习课没有知识清单；
   - 可手动改课型。
4. 导入部门大纲 `.xlsx`：系统解析 Lesson/主题/目标词汇/语法/阅读/技能。
5. 从“已确认来源”选择旧版 OCR；如果列表没更新，点刷新或切回页面。

### 6.3 生成模块

1. 左侧显示本课模块卡片（A/B/C…，数量由书种/课型决定）。
2. 点一个模块，系统按来源、规则、骨架、大纲、范本生成。
3. 生成结果显示在中间正文区；右侧显示规则检查/迁移计划/建议。
4. 生成后建议先看：
   - 课时目标是否固定四条、英文、无中文；
   - 词卡/表格是否完整；
   - 是否出现空小节/孤立编号；
   - 来源是否对应旧版栏目。

### 6.4 编辑与保存

- 直接在中间正文编辑 Markdown。
- “保存新版本”会生成新版本，不覆盖旧稿。
- 版本历史可切换/查看；历史不可随意覆盖。
- 接受建议、人工修改、重新生成都产生新版本。

### 6.5 修改建议

1. 选中一个有草稿的模块。
2. 在右侧“修改建议”输入自然语言要求，如“把阅读题难度降到 PET，保留核心词汇”。
3. 系统只带当前 Module、Lesson Context、生效规则、相关来源；返回建议卡片，包含原文范围、建议、理由、规则依据、来源和不确定性。
4. 逐条“采用/忽略”；采用只改当前草稿，点保存才生成新版本。
5. 建议不会自动改正文，也不会改其他书种。

### 6.6 导出

- 在制作页选择导出格式（Markdown/Word），默认 Word `.docx`。
- DOCX 由当前正文生成；不读取数据库。导出前确认正文已保存。

## 7. 教材审校

### 7.1 开始审校

1. 左侧“教材审校”。
2. 选择项目、Lesson、范围：
   - 单个模块；
   - 整本书。
   - **整课范围当前不支持**。
3. 选择书种和模块（单模块时）。
4. 点“开始审校”；后台运行，页面轮询进度。

### 7.2 查看 Finding

- 结果按教材顺序排列，不按严重度（标准明确不新增 severity）。
- 可按书种、处理状态、是否有正文定位筛选。
- 每条 Finding 显示问题、原文定位、规则、证据/建议、不确定性。
- 可点“定位正文”查看命中位置；原页证据取决于来源是否有 OCR/页图。

### 7.3 人工处理

- **采用建议**：把建议应用到当前草稿，保存后生成新版本；
- **忽略**：只记录决定，不删除 Finding；
- **标记复查**：留给后续处理。
- 处理状态会保存，重新打开仍保留。

### 7.4 报告

- 审校完成后点“生成审校报告”，再“查看报告”。
- 报告由 `findings.json` + manifest + 老师决定 + 固定模板生成；不是模型自由写 HTML。
- 报告只读、无脚本、无远程资源，可重新生成。
- 报告文件位置：`document\projects\<id>\lessons\lesson-NN\review\<jobId>\report.html`。
- 当前审校页不直接导出 DOCX；需要 DOCX 时在制作页导出。

## 8. 通用助手

### 8.1 提问

主页“通用助手”输入问题，如：

- “查找 Let's say 中包含 environment 的核心词汇”
- “这课阅读题的考试技能是什么？”
- “在已确认教材里找某个语法点”

可选范围：全工作区/某个项目；可选来源类型。

### 8.2 结果

- 先显示“查询计划”（关键词/过滤），再显示本地命中，不是模型总结。
- 每条显示：来源书名/文档、Lesson/Module（如有）、页码、状态、片段、来源引用。
- OCR 教材/资料库 PDF 命中可点“查看原页”，高亮块坐标；没有坐标时只显示整页并说明。
- Markdown 资料只显示文字定位，没有原页。

### 8.3 边界

- 通用助手只读，不会改教材、规则、审校结论。
- 没有命中会如实显示“没找到”和已搜索范围，不会编造。
- 资料库扫描件 OCR 未完成前不会参与检索。

## 9. 规则库

主页“规则库”：

- 显示已导入规则文件/规则条数/版本；
- “导入”支持 Markdown 规则文件；
- 删除规则文件会二次确认；
- 导入规则写当前本地工作区，不改安装包基线。
- 规则是“人类可读说明 + 机器可读约束”；Hard Rule 不可被低层覆盖。
- 当前安装包随带审校规则；生成规则草案未随包（见开发部分）。

## 10. 数据、备份与恢复

### 10.1 工作区位置

默认：

```text
%LOCALAPPDATA%\Programs\ai-textbook-workbench\document\
```

包含：

```text
rules\        规则
knowledge\    资料库/集合/语法/审校判据
library\      你导入的 PDF/Markdown
ocr\          OCR 结果
projects\     项目/Lesson/版本/来源
exports\      导出
.app\         日志/任务/索引缓存
.recycle\     移除资料的回收区
```

### 10.2 备份

- 关闭软件后，完整复制整个 `document` 文件夹到移动硬盘/公司备份目录；
- 至少保留 `rules`、`knowledge`、`library`、`ocr`、`projects`、`exports`；
- `.app` 索引可重建，但保留也不影响；
- 不要只备份 `exports`，否则源材料和版本会丢。

### 10.3 恢复/换电脑

- 在新电脑安装同版本软件；
- 关闭软件，把备份的 `document` 放到新电脑安装目录；
- 打开软件，检查项目、来源、资料库、规则是否都在；
- 如果安装目录变了，程序仍以安装目录下 `document` 为准，不要把备份放到其他路径。

### 10.4 删除/卸载

- 卸载程序会保留 `document`；
- 删除项目默认进回收区；
- 移除资料库条目进 `.recycle\library`；
- 彻底清理需要手动删除 `document`（先确认备份）。

## 11. 故障排查

| 现象 | 先做什么 |
| --- | --- |
| 双击安装包被 SmartScreen 拦截 | 当前未签名；确认文件 SHA256 后“更多信息 → 仍要运行”；企业策略拦截需 IT |
| 应用打不开/白屏 | 看 `document\.app\logs\desktop.log`；确认安装目录可写；重启应用 |
| OCR 引擎未就绪 | 资料识别页看引擎状态；确认安装包内 `resources\ocr` 完整；重启 |
| OCR 一直 0 页/页数不对 | 看是否大 PDF 仍在启动；页数只认 PDF；必要时重新导入；查 `ocr-failures.log` |
| OCR 失败/中断 | 任务会被清理；重新导入；确认磁盘空间和文件未损坏 |
| 制作页看不到已确认来源 | 确认来源已点“确认”；刷新/切回页面；检查学期/书种 |
| 目标/课时目标有中文或对不上 | 检查大纲字段；系统应只取英文；复习课用固定三条（学生书）；知识清单固定四行 |
| 生成内容空/结构乱 | 检查是否选了 Lesson/大纲/来源；检查规则是否齐全；生成是 Draft，需人工复核 |
| 修改建议没有规则依据 | 检查规则库；资料缺口会显示；不要编造 Cambridge 依据 |
| 审校报错/结论可疑 | 检查审校范围和已保存版本；模型结论需人工复核；看 Finding 是否有正文定位 |
| 资料库 PDF 一直处理中 | 扫描件自动 OCR 较慢；看状态/进度；重启后会标记失败，可重新处理 |
| 资料库导入无反应 | 确认使用桌面版（浏览器版没有原生选择框）；检查文件类型/大小/路径 |
| DOCX 导出失败 | 确认正文非空；检查下载目录权限；看日志 |
| 卸载后工作区还在 | 这是设计；卸载保留 `document`，彻底清理需手动删除 |
| 安装后没有范本集合 | 正常安装包应带 `autumn-2026-l5`；检查 `resources\knowledge\collections`；首次启动会补装 |

日志：

```text
document\.app\logs\desktop.log
document\.app\logs\ocr-failures.log
```

## 12. 当前版本限制（请如实告知老师）

- **设置页未开放**；AI/OCR 配置由发布包预置，老师不需要改。
- **单词小超市暂不可生成**；学生用书、知识清单、练习册可用。
- **整课审校暂不支持**；只能单模块/单本书。
- **生成规则未随包**：当前安装版生成主要依赖大纲、来源、模块骨架、范本和模型；规则库里的生成规则需要内部导入/后续版本。
- **扫描件自动 OCR 需要时间**；大文件可能几分钟。
- **资料库 PDF/Markdown 目前用于助手检索**，不自动进入生成上下文。
- 安装包未签名，可能出现“未知发布者”；未配置自动更新，按新安装包覆盖升级。
- OCR/生成/审校都是 AI 辅助，最终必须人工复核；不要让模型直接发布教材。

## 13. 推荐工作流

```text
1. 安装并打开
2. 资料识别：导入旧教材 PDF → 核对页数/标题/表格 → 确认来源
3. 资料库：导入 Cambridge/参考 PDF/Markdown（可选）
4. 制作：选学期/年级/Lesson/书种/课型 → 导入大纲 → 选已确认来源
5. 逐模块生成 → 看目标/结构/来源 → 编辑 → 保存新版本
6. 修改建议：描述要求 → 逐条采用/忽略 → 保存
7. 审校：单模块/单书 → 处理 Finding → 生成报告
8. 导出 Word → 教研复核 → 交付
9. 备份 document
```

## 14. 术语表

| 术语 | 含义 |
| --- | --- |
| Lesson | 新版课时；旧版 Unit 只在来源和 provenance 保留 |
| Module | 书种内的模块（如 Let's say、Let's read、Day 1） |
| 四书 | 学生用书、练习册、知识清单、单词小超市 |
| Production Source | 老师确认过的旧版教材来源，可参与生成 |
| Finding | 审校发现的结构化问题，不带严重度 |
| INSUFFICIENT_EVIDENCE | 资料不足，无法核查；不编造结论 |
| OCR | 图像/PDF → 结构化文字、表格、页图 |
| 规则快照 | 生成/审校时使用的规则版本记录 |
| Context Pack | 发给模型的最小必要上下文 |
| Manifest | 来源/集合/OCR 的元数据索引 |
| 回收区 | `.recycle`，移除资料可恢复 |

---

## 附录 A：关键文件速查

```text
AGENTS.md                       项目协作规则（最高优先）
profile.md                      产品与技术权威方案
PRODUCT.md                      老师可见功能/界面
question.md                     待确认事项台账
docs/HANDOVER.md                构建/发布/备份手册
docs/TRANSFER.md                本文
docs/OCR-ENGINE-DECISION.md     OCR 选型/契约
docs/REVIEW-SKILL-INTEGRATION.md 审校规则/报告
docs/AI-ASSISTANT-RETRIEVAL.md  助手/建议 Context 契约
workflow.md                     模块进度/验证记录
package.json                    脚本/依赖
electron-builder.yml            安装包配置
electron/main.cjs               桌面壳
lib/generation/service.ts       生成核心
lib/review/service.ts           审校核心
lib/library/store.ts            资料库
lib/assistant/ocr-corpus.ts     助手 OCR 语料
scripts/verify-release.mjs      发布自检
```

## 附录 B：开发环境变量

```dotenv
AI_PROVIDER=openai-compatible
AI_BASE_URL=...
AI_API_KEY=...          # 只在 .env.local/安全渠道
AI_MODEL_GENERATION=...
AI_MODEL_REVIEW=...
AI_MODEL_VISION=...
AI_AUTH_MODE=           # 可选
AI_TEMPERATURE=         # 可选
```

其他：

```text
AI_TEACHING_INSTALL_DIR   安装根目录（Electron 设置）
AI_TEACHING_WORKSPACE     测试工作区覆盖
MINERU_HOME               便携 OCR 根目录
MINERU_TOOLS_CONFIG_JSON  MinerU 模型配置
```

## 附录 C：接手后建议的第一个 Sprint

1. 把生成规则随包/导入安装版，解决“安装版无生成规则”。
2. 做一次干净 Windows VM 全流程验收，记录问题。
3. 实现设置页（AI/OCR 诊断、工作区打开、版本信息；不显示 Key）。
4. 决定单词小超市是否首版支持；不支持就在 UI/文档明确。
5. 实现整课审校范围，或明确排期。
6. 补生成结构完整性门禁（空小节/空表/编号行）。
7. 决定是否要代码签名、自动更新源、集合导入 UI。
