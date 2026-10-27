# AI 教材智能迁移与审校工具 · 工作区指令

> 同步基线：profile.md V1.3，2026-10-27。

## 权威文档与读取顺序

1. [profile.md](profile.md) 是产品和技术总体方案的唯一权威来源。涉及本地化、文件存储、OCR、生成、审校或部署时必须先读。
2. [PRODUCT.md](PRODUCT.md) 定义老师可见的功能、状态与界面边界；处理产品流程或前端信息架构时必须读。
3. [docs/OCR-ENGINE-DECISION.md](docs/OCR-ENGINE-DECISION.md) 定义 OCR 引擎、输出契约、人工确认和质量评测；处理 PDF、图片、OCR、模型打包或 sidecar 时必须读。
4. [docs/REVIEW-SKILL-INTEGRATION.md](docs/REVIEW-SKILL-INTEGRATION.md) 定义审校 Skill 迁移、Finding 和 HTML 报告契约；处理审校规则、报告或审校页面时必须读。
5. [docs/AI-ASSISTANT-RETRIEVAL.md](docs/AI-ASSISTANT-RETRIEVAL.md) 定义修改建议、通用助手、Context Pack、检索和 PDF 证据契约；处理 AI 建议或本地检索时必须读。
6. [question.md](question.md) 是所有尚未解决、需要教研 / 需求方 / IT 确认事项的唯一台账。
7. [docs/HANDOVER.md](docs/HANDOVER.md) 定义交付和重建要求；处理安装包、工作区、凭据或发布时必须读。

早于 2026-09-21 的协作平台 / Supabase / 远程 API 方案只可作为历史与迁移参考。若与 profile.md 冲突，以 profile.md 为准。

## 产品锚点

- 产品是安装到老师电脑上的本地个人工具，不是多人 Web 协作平台。
- 每位老师只操作自己的本地工作区；项目隔离依赖目录边界，不依赖用户、角色或数据库隔离。
- 本地文件是唯一事实源。原始教材、OCR 结果、规则、剑桥资料、版本、审校记录和 DOCX 都写入工作区。
- 没有远程教材数据库、对外 REST API、账户体系、协作锁、跨用户审计或远程任务队列。
- OCR、生成和审校是本机后台任务；界面可关闭任务面板但不能丢失可恢复的任务结果。
- 资料识别、教材制作、教材审校是并列一级功能；通用助手位于主页且默认只读。
- 最高教材原则：Preserve → Adapt → Generate。人工确认 > Lesson Context > 规则 > 已确认来源 > 模型知识。
- 新版目标术语使用 Lesson；旧版来源中的 Unit 仅在原文与 provenance 中保留。

## 实施基线

- 现有 Next.js / Supabase 原型是 UI、规则、检索、编辑和 DOCX 逻辑的迁移来源，不是正式运行时架构。
- 正式交付是 Windows x64 一键安装包：老师不安装 Node、Python、数据库或 OCR 命令，不编辑环境变量。
- 推荐的目标形态是桌面壳 + 本地命令桥 + 本地工作区 + OCR sidecar；业务层不得再以 Supabase 或 Next REST API 为依赖。
- 默认 OCR 引擎为 MinerU（见 profile §5.2），PaddleOCR 作对照候选。必须通过 adapter 产出稳定的 manifest、Markdown、结构 JSON、页图和资产；不得把上游专有格式扩散到教材业务层。
- Docling 仅作备选和质量对比；任何引擎随安装包分发前，其代码与所带模型许可都必须逐项核验并走公司确认（Q-CORE-012）。

## 项目共识

- 业务层级：Project → Grade → Term/Course → Lesson → 四书 → Module；最小生成单位是完整 Module。
- 四书：学生用书、练习册、知识清单、单词小超市。学生用书确认后构建 Lesson Context，其余三书参考主书、上下文、旧版来源和规则。
- 规则是“人类可读说明 + 机器可读约束”，支持 Global / Project / Grade / Book / Module / Lesson Override，Hard Rule 不可被低层覆盖，且必须版本化与快照化。
- 旧教材正式生产使用 Structured Retrieval + 可替换的本地语义检索；不得用整本 PDF 的朴素 RAG 猜来源。
- OCR 结果在老师确认前不是 Production Source；图片只识别、保存和迁移，不做 AI 重绘。
- 正文与 AI 建议分离；接受建议与人工修改均生成新版本，绝不覆盖历史。
- 审校是本地 Pipeline，产出可定位的结构化 Finding；资料不足时允许 INSUFFICIENT_EVIDENCE。
- `findings.json` 是审校事实源，HTML 报告由结构化结果和老师决定生成，不让模型自由输出整页 HTML。
- 修改建议助手只作用于当前 Module；自然语言请求必须使用带规则 ID 和来源定位的最小 Context Pack，采用建议后才生成新版本。
- 用户后续提供的审校 Skill 和本地检索代码都是迁移来源，必须分别通过规则转换层和 adapter 接入，不把旧内容或内部索引格式直接扩散到业务层。

## 待确认事项台账

- 发现必须由教研、需求方或 IT 拍板的事项，立即追加到 question.md，不只留在聊天记录。
- 编号使用 Q-CORE / Q-KL / Q-SB / Q-WB / Q-VB / Q-PB 加序号。
- 每条必须有归属、影响与当前默认处置。
- 结论确认后，先写回 profile、规则、映射或代码，再将问题移到 question.md 的“已确认”区并标注日期；不直接删除。
- 每次结束开发会话前核对 question.md 与实际实现、规则和草稿一致。

## 文档和工程规则

- 新的产品决策先更新 profile.md；用户体验细节更新 PRODUCT.md；OCR 选择与质量结论更新 docs/OCR-ENGINE-DECISION.md。
- 不把具体教材规则、知识内容、路径或模型名写死进业务代码；它们必须可由本地工作区的文件与 manifest 替换。
- 未经用户明确授权，不改写或删除老师工作区中的教材原件。批量变更前先显示精确范围。
- 本地索引、缓存和预览可删除且可重建，不能成为唯一事实源。
- 安装包、运行时、OCR 模型和第三方依赖必须记录版本和许可证；密钥只存系统凭据库或发布配置，不进工作区和 git。
- 每完成一个产品模块，按 workflow.md 先做模块孤立复核，再做全产品集成复核；记录发现和验证结果后再进入下一模块。

## 当前阶段与完成标准

旧 Web MVP 已完成并保留为迁移资产；当前正式产品处于 Local-0 / Local-1 规划阶段：先完成本地单人工具基座与 OCR 资料识别，再迁移教材制作和审校逻辑。

本阶段的完成标准不是“页面能跑”，而是老师在新电脑上无需命令行和手工配置，即可导入扫描 PDF、查看并确认结构化 OCR、生成一个 Module Draft、保存版本并导出 DOCX。

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
