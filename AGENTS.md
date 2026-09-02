# AI 教材智能迁移与审校平台 · 工作区指令

## 权威方案

- **`profile.md` 是唯一权威的产品与技术总体方案（V1.0）**，已于 2026-09-01 经需求方逐条确认。所有产品形态、业务流程、数据模型与架构决策以该文件为准；与它冲突的旧文档一律失效。
- 2026-09-01 之前的访谈台账、ADR、领域模型草案、术语表、审校 Skill 评估和原型生成 prompt 已归档至 `_archive/pre-profile-docs-2026-09-01/`，仅供历史追溯，不作为实现依据。

## 核心定位与原则（摘要，全文见 profile.md）

- 定位：**AI 辅助教材迁移、优化、协同制作与审校平台**，不是从零创作的 AI 写作工具。
- 最高生产原则：**Preserve → Adapt → Generate**——能沿用的原样迁移，不符合新版结构/标准的改写，只有旧版缺失时才生成新内容。
- 六条总原则：确定性优先于智能；结构化优先于 Prompt；规则优先于模型知识；人工确认优先于 AI；建议优先于自动修改；**Workflow 控制 AI，而不是 AI 控制 Workflow**。

## 工程原则（2026-09-02，需求方确认）

1. **库内容即插即用**：灵活修改和切换知识库与规则库是本项目的关键功能。正式数据库内容敲定之前，程序设计必须为库内容预留充分空间（稳定 ID + 作用域绑定 + JSONB 扩展字段 + 版本化），保证内容到位后即插即用；严禁把具体规则/知识内容写死进代码。
2. **面向非技术用户**：目标用户不懂代码。在完整实现功能的前提下，尽量简化代码结构与前端操作逻辑，界面语言使用教研术语而非工程术语，便于使用和维护。
3. **可移交性**：项目开发后期将整体移交，开发全程遵循 `docs/HANDOVER.md` 约定（表结构走 migrations 进 git、密钥不进库、文档同步更新）。此条重要性最低，不得影响开发效果与进度。

## 已确认的核心决策

- 业务层级：`Project → Grade → Term/Course → Lesson → 四书 → Module`；最小生成单位是 **Module**（一次生成一个完整模块，不逐段生成）。
- 四书 = 学生用书（主书）、练习册、知识清单、单词小超市。生产顺序：学生用书制作并 Confirmed → 系统提取生成 **Lesson Context** → 老师轻量确认 → 其余三书同时参考旧版对应书稿、Lesson Context、已确认学生用书和规则生成。
- Lesson Context 是四书共享事实源，当前字段：Theme / Core Vocabulary / Grammar（后续可扩展 phonics、交际功能、文化点、学习目标、Cambridge mapping）。
- 信息优先级：人工确认 > Lesson Context > 项目/课程规则 > 模块规则 > 旧版教材 > 剑桥参考资料 > 模型自身知识。AI 不得推翻人工确认内容。
- 旧教材知识库不做朴素 RAG（PDF→OCR→Chunk→Embedding 猜检索）。建独立的**教材加工后台**：上传扫描 PDF → OCR+Vision → 页面结构识别 → Lesson/Module 切分 → 文字与图片提取 → 人工快速确认 → 入库；正式生产用 **Structured Retrieval + RAG**。
- 图片 MVP 只识别、保存、迁移（Asset 表记录来源页码、Lesson、Module 与图文关联），不做 AI 重绘。
- 新旧模块映射存在一对一/一对多/多对一，用 **ModuleMapping** 多条记录表达，不写死一对一。
- 规则 = 人类可读说明 + 机器可读约束。程序能确定的事（字数、题量、答案存在性、核心词汇覆盖、英式拼写、格式结构）用确定性检查；AI 只判断难度、自然度、连贯性、教学目的。形成 **Deterministic Check + LLM Review** 双层审校。
- 规则作用域：Global / Project / Grade / Book / Module / Lesson Override；**Hard Rule** 不可被下级覆盖；Rule Resolver 为每次任务构建 Effective Rule Set。
- 规则必须版本化（Draft / Published / Deprecated，旧版本永久保留）；生成任务记录 rule_id + rule_version + rule_snapshot 以支持历史复现；规则更新绝不自动修改已有教材，只提示"基于旧版规则生成"并提供重新检查入口。
- 生成管线 11 步：Identify → Mapping Resolver → Source Retriever → Context Builder → Rule Resolver → Cambridge Retriever → Migration Planner → Generator → Validator → Save Version → AI Suggestions。先产出 **Migration Plan**（reuse/adapt/generate 的 JSON），再正式生成，防止 AI 拿到旧教材后全部重写。
- 内容块后台必须记录来源类型 COPY / ADAPT / GENERATE 与来源定位（前台不必展示）；用于统计复用率与审计。
- AI 优化建议与正文**分离存储**（正文 + AI 建议旁栏），老师点击"接受"才修改正文；四书同步一律 **Suggest，不 Auto Apply**。
- 编辑器：浏览器端用 **Tiptap/ProseMirror 类 Word-like 富文本编辑器**，数据库存 Editor JSON；导出走 Editor JSON → DOCX Generator，DOCX 交独立排版团队。
- 版本机制：AI 重生成永远产生新 Module Version，绝不覆盖人工修改稿；支持查看历史、对比版本、恢复版本。
- 模块状态机：Draft → Editing → Confirmed；Confirmed 后再编辑进入 Modified，系统提示可能影响的关联书种，但不自动修改。
- 多人协作 MVP 用 **Module Edit Lock**（locked_by / locked_at / lock_expire_at）+ Audit Log（谁、何时、改了什么、前后值），不做实时协同。
- 整课状态机：Not Started → In Production → Student Book Confirmed → Four Books Completed → Reviewing → Human Review → Approved → Archived；四书全部完成才显示"提交审校"按钮。
- 整课审校是一条 **Pipeline**（Preprocessor → Rule Checks → Cross-book Checks → Cambridge Checks → Language Checks → LLM Review → Finding Aggregator → Human Review），不是一个 Prompt。
- 审校产出独立结构化 **Finding**（finding_id、书种、模块、位置、rule_id、severity、problem、evidence、suggestion、replacement_text、confidence、status：Open/Accepted/Rejected/Fixed/Recheck Required），支持"点击问题 → 定位正文 → 查看证据 → 应用建议"。
- 审校允许 **INSUFFICIENT_EVIDENCE**，涉及剑桥要求、授权材料、课程标准而资料不足时不得硬猜。
- 知识库分三层：Production Source（旧版公司教材，迁移用，权重最高）/ Authoritative Standards（Cambridge 官方大纲、CEFR、词表）/ Reference Materials（真题、教辅，仅参考不等权）。
- AI 架构：Workflow Orchestrator 统一调度能力节点（Source Retriever、Context Builder、Rule Resolver、Cambridge Retriever、Migration Planner、Content Generator、Suggestion Generator、Review Engine）；Agent 只能放在节点内部，不能决定流程走向。
- 模型路由 MVP 只配置 default_generation_model / default_review_model / vision_model，记录 provider、model、prompt_version、temperature、token_usage、latency；不提前做自动路由/成本优化。
- 从第一天记录生产数据：生成/编辑/审校时长、copy/adapt/generate 比例、建议接受与拒绝数、finding 数与人工复核准确率。

## MVP 范围

- 只做**教材迁移闭环**：旧教材预处理 → 建 Module Mapping → 配置规则 → 选 Lesson → 生成学生用书模块 → 人工修改 → Confirmed → 生成 Lesson Context → 其余三书 → 四书完成 → AI Review → 结构化 Findings → 人工复核 → Approved → DOCX 导出。
- 暂不做（profile.md 第三十四节）：AI 自动修改规则、反馈自动训练、Multi-Agent 自主讨论、实时多人编辑、自动换模型、AI 生成教材图片、复杂成本路由、全部门复杂权限、AI 自主决定流程、AI 自动修改其他三书。
- 试点规模：先 **1 个年级 + 2~3 个 Lesson**，不一次性处理全部教材。

## 技术栈

- 前端：Next.js (App Router) + TypeScript + Tailwind CSS + shadcn/ui + Tiptap/ProseMirror。
- 后端：MVP 用 Next.js Server，任务复杂后再考虑独立 Python FastAPI（现在不拆）；数据库 PostgreSQL/Supabase；存储 Supabase Storage / S3（PDF、图片、DOCX）。
- AI：统一 **AI Gateway**，业务代码不直接绑某一家模型；队列早期 Supabase + background worker，规模大后再 Redis + BullMQ/Celery；部署 Vercel + Supabase + Worker。

## 开发顺序（Phase 0–7）

0. **规则工程**：新版结构表、模块清单、旧→新 Mapping、规则层级、Hard/Module/审校规则——没做清楚不要大量写码
1. **旧教材加工**：PDF Upload / OCR / Vision / 切分 / 图片提取 / 人工确认
2. **单模块迁移**：只做 Student Book · Let's explore!，验证 旧教材+Mapping+Rules → 新版 Draft（第一个生死节点）
3. **Editor + Version**：富文本编辑器、版本历史、Confirm、Edit Lock、Audit Log
4. **Lesson Context**：学生用书 Confirmed → AI 提取 → 老师确认
5. **四书**：扩展到全部书种 + Cross-book suggestions
6. **Review**：审校 Skill 改造为 Structured Findings；Rule Checks + LLM Review + Cross-book Review
7. **DOCX + Pilot**：导出 DOCX，10~20 个真实 Lesson 试点后决定推广

## 当前实现状态与已知差距

- 前端原型已迁入本项目：Next.js 16 + React 19 + TypeScript + Tailwind CSS 4，仍为纯 Mock 交互。
- 数据库迁移（curriculum / rules / knowledge）与 AI Gateway 双模式代码已就位：待 Supabase 项目创建并在 `.env.local` 填好环境变量后即可接入；AI Gateway 默认 mock 模式，无真实 Key 也能联调整条管线。
- 原型中的 `Unit` 命名、同步 `setTimeout` 模拟生成、只读 Markdown 正文、模拟保存/导出均不是正式契约，实现时一律按 profile.md 修正。
- 视觉系统见 `DESIGN.md`（出版排样台视觉语言），原型交互基线见 `PRODUCT.md`；二者仍适用于前端开发，但业务行为以 profile.md 为准。
- 主要五大风险（profile.md 第三十七节）：扫描 PDF 解析质量、规则工程未开始、AI 过度改写、四书内容漂移、规则更新污染历史。

## 工作记录

- 2026-08-26：完成两轮访谈并产出初始共识与 ADR（已归档至 `_archive/pre-profile-docs-2026-09-01/`）。
- 2026-09-01：需求方确认 GPT 产出的总体方案 `profile.md` 为唯一权威方案，取代此前所有过程文档。
- 2026-09-02：建立版本控制与移交机制（git 仓库、`.env.example`、`docs/HANDOVER.md`）；确认以现有示例规则先行搭建前后端，真实规则与知识库内容由教研老师整理到位后经系统界面录入，不做代码改动。
- 2026-09-02：记录三条工程原则（库内容即插即用 / 面向非技术用户 / 可移交性）；动工第一批基础设施：curriculum、rules、knowledge 三组迁移 + seed 示例数据 + Supabase 服务端客户端 + AI Gateway（mock / anthropic-compatible 双模式）。
