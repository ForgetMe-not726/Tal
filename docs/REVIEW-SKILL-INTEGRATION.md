# 审校 Skill 整合与 HTML 报告规范

> 状态：**Skill 已接入（2026-10-09）**——`pet-material-review` v1.0.0 的 **24 条规则**已机械
> 转换进随包基线 `resources/rules/`，判据材料（含 B1 词表）进 `resources/knowledge/review-standards/`。
> `/review` 页面、八段 Pipeline、`manifest.json` / `findings.json` / `decisions.json` / `report.html`
> 契约、人工决定与固定模板报告均已实现并通过复核。
> 遗留的 4 项待教研/需求方确认见 `question.md` Q-CORE-027~029。
> 上位文档：profile.md V1.2。若本文与 profile.md 冲突，以 profile.md 为准。

## 0. 迁移结果（2026-10-09）

| 项 | 落点 |
|---|---|
| 24 条审校规则 | `resources/rules/<规则 id>/`（工作区存储格式，基线复制即可用）；`rule_key` 原样沿用 `LANG-001` 这类 id，可按 id 回链原标准 |
| 判据材料 | `resources/knowledge/review-standards/`（SKILL.md、review-list.md、review-standards.md、grammar-review.md、delivery-and-sources.md、B1 词表） |
| 转换 | `scripts/convert-review-skill.mjs <skill-dir>`（机械转换，id 为确定性派生，重跑逐字一致；覆盖不全直接报错） |
| 离线自检 | `npm run test:review-skill`（24 条齐全、38 源行 + 2 全书门控全覆盖、判据引用都有落点） |
| 迁移记录 | `docs/drafts/审校Skill迁移-初拟.md`（五类清单、字段映射、硬度推断、冲突与缺口） |

**规则分流**：迁移来的规则都是 `rule_type: review`。审校只取审校规则、生成只取生成规则
（`filterRuleSetByType`，`snapshot` 跟着过滤）。审校规则进生成 Prompt 只会挤占上下文，
其中的 Hard 项还会在保存时挡住老师——它检查的是"成品该长什么样"，而迁移阶段的输入是旧版教材。

**执行方式路由**（标准的 `execution_mode`）：

| 方式 | 处置 |
|---|---|
| `hybrid` / `model_assisted` / `deterministic_candidate` | 确定性检查 + 模型审校（现有路径） |
| `source_lookup` | 按规则的 `standard_refs` 把判据小节取进 Prompt；取不到按标准的三态给"材料未提供无法核查" |
| `human_visual` | 文字稿没有成品页图与样式证据 → 按标准自己的 `cannot_verify` 如实标注"需人工目视核对"（见 Q-CORE-029） |

**判据取用**：按规则引用的 `references/x.md:3、3.1` **精确取小节**，不整本塞进 Prompt
（四份材料共 140 KB）。引用对不上具体小节时（标准里有些引用写的是"讲了什么"而不是标题，
如 `delivery-and-sources.md:视觉三轮`）退一级给**该材料的目录**，并在阶段报告里写明未定位到小节——
既不假装取到，也不跳过。

**不带严重度**：标准明确"不新增严重度字段"，所以 Finding 不带严重度，报告也不给结论评级别
（2026-10-09 确认，Q-CORE-024 结项）。排序与呈现都按**教材顺序**（书 → 模块 → 正文位置）——
老师拿着教材从前到后核，结论也照这个顺序给。要表达"这条是硬门槛"，用规则自己的 `is_hard`
（报告里标"红线"），不复制到每条 Finding 上。列表标记按**处理状态**着色，不按级别。

**三态结果**：标准的 `通过 / 需要修改 / 材料未提供无法核查` 里，Finding 承载后两态。
模型必须回 `verdict` 字段（`needs_revision` / `cannot_verify`），`cannot_verify` 结构化记为
`insufficientEvidence`——不能只留在 message 里，否则界面与报告没法把"缺资料"单独归组。
认不出的 verdict 一律按 `needs_revision`。「通过」项不记（precision-v2 的逐元素登记是已知缺口，见 Q-CORE-025）。

## 1. 目标与边界

现有审校 Skill 是审校方法、检查维度、提示结构和报告逻辑的迁移来源，不是可以原样复制到新版产品中的成品。

整合目标是：

- 把可复用方法转为本地审校 Pipeline；
- 把适用规则转为项目统一的规则格式和清晰中文；
- 按新版 Lesson、四书、Module 和大纲重新确定作用域；
- 用结构化 Finding 支撑人工复核和 HTML 报告；
- 保留旧 Skill 条目到新规则的来源映射，便于追查迁移遗漏。

本阶段不把旧 Skill 中尚未被新版大纲确认的教材细节视为现行规则，也不把报告模板中的自然语言直接当作检查逻辑。

## 2. 接收 Skill 后的迁移顺序

1. 完整读取 Skill 主文件、引用资料、规则清单、脚本、模板和样例；
2. 建立条目清单，标记为“方法”“教材规则”“报告表达”“实现辅助”或“已过时内容”；
3. 对每条教材规则判断适用书种、Module、年级、课程和 Hard/Soft 属性；
4. 将规则改写为项目规则包，并保存原 Skill 文件与条目的来源引用；
5. 将报告撰写逻辑拆成结构化字段、聚合规则和固定 HTML 模板；
6. 用正例、反例、边界样例和真实教材样张评测；
7. 教研确认后发布为本地规则集版本。

遇到与新版大纲冲突或无法确定作用域的内容，不自行猜测，写入 question.md；在确认前保持禁用或仅作提示。

## 3. 审校规则格式

审校规则继续采用“人类可读说明 + 机器可读约束”。每条从 Skill 迁入的规则至少包含：

| 字段 | 含义 |
| --- | --- |
| `rule_key` | 稳定规则 ID |
| `display_name` | 老师可理解的短标题 |
| `rule_type` | 主要用途标记为 `review`；是否同时参与生成仍按 Q-CORE-001 的最终结论执行 |
| `scope` | Global / Project / Grade / Book / Module / Lesson Override |
| `hardness` | Hard 或 Soft |
| `instruction_zh` | 无 Skill 术语、可直接给教研复核的中文说明 |
| `check_mode` | deterministic / llm / hybrid |

| `evidence_required` | 触发 Finding 时必须给出的证据 |
| `constraints` | 数量、枚举、模式、阈值和其他机器约束 |
| `finding_guidance` | 问题描述与修改建议的字段要求 |
| `source_skill_ref` | 原 Skill 文件及条目定位 |

规则文件仍以 Markdown 承载说明、JSON 承载约束。规则语言应陈述“检查什么、在什么范围、违反时如何证明”，避免把模型角色扮演、推理口号或模糊质量词直接当作规则。

确定性检查优先执行；LLM 只处理无法可靠计算的自然度、难度、教学目的、题目质量和跨书语义问题。Hybrid 规则必须说明确定性结果如何成为 LLM 的输入，不重复计数同一问题。

## 4. 审校任务输入与输出

一次审校任务必须固定以下输入：

- 审校范围：Module、单书或完整 Lesson；
- 明确的 Module Version 列表；
- Lesson Context 版本；
- 生效规则集与规则快照；
- 已确认来源和 Cambridge 参考命中；
- 审校 Pipeline 与模型版本。

`findings.json` 是审校结果的唯一事实源。每条 Finding 至少包含：

- Finding ID、规则 ID、标准环节和处理状态；
- Lesson、书种、Module、版本和正文定位；
- 问题说明、命中原文和必要上下文；
- 规则依据与来源证据；
- 修改建议或 `INSUFFICIENT_EVIDENCE`；
- 模型置信提示；
- 老师的采用、忽略、复查决定及备注。

模型不能以没有正文定位或证据的长评语替代 Finding。相同规则、相同位置、相同问题应在聚合阶段合并，避免报告重复轰炸。

## 5. 独立审校工作台

全局左侧导航包含“教材审校”。页面流程为：

~~~text
选择审校范围与输入版本
→ 检查资料与规则是否齐备
→ 开始审校
→ 查看并筛选 Findings
→ 逐条采用 / 忽略 / 标记复查
→ 生成审校报告
→ 在软件内查看 HTML 报告
~~~

采用 Finding 中的修改建议时，只修改当前草稿并展示差异；保存后生成新版本。忽略或复查只改变老师决定，不删除原始 Finding。

## 6. HTML 报告

HTML 报告通过固定模板读取审校 manifest、Findings 和老师决定生成。模型可以提供 Finding 的结构化文字，但不能自由编写整页 HTML。

报告至少包含：

1. 项目、Lesson、审校范围、输入版本和生成时间；
2. 规则集、参考来源、Pipeline 和模型信息；
3. 按条数、书种、Module 和处理状态统计的摘要；
4. 每条 Finding 的位置、原文、规则、证据、建议和人工决定；
5. `INSUFFICIENT_EVIDENCE` 与未完成复核清单；
6. 报告为 AI 辅助审校结果、需人工复核的说明。

保存契约：

~~~text
lessons/<lesson-key>/review/<review-job-id>/
  manifest.json
  findings.json
  decisions.json
  report.html
~~~

`report.html` 可由前三项重新生成。报告内所有教材内容和模型输出必须转义或经过白名单净化；不得包含脚本、远程资源、追踪代码或可执行链接。

## 7. 验证标准

具体规则接入后至少验证：

- 正例不应被误报；
- 已知错误能被对应规则检出；
- Finding 能定位到正文和原页证据；
- 同一问题不会被多个阶段无意义重复；
- 缺资料时输出 `INSUFFICIENT_EVIDENCE`，不编造结论；
- 老师决定可保存、恢复，重新生成报告后不丢失；
- HTML 中的特殊字符、教材片段和模型文本不能执行代码；
- 审校不修改输入版本，采用建议后才生成新版本。

审校 Skill 未提供前，不填造其具体规则，不声称已完成规则迁移。
