# 审校 Skill 迁移记录（初拟）

> 来源：`pet-material-review` v1.0.0（生效 2026-10-08）
> 转换：`scripts/convert-review-skill.mjs`（机械转换，可重跑；id 为确定性派生，重跑结果逐字一致）

## 1. 条目清单（按 `docs/REVIEW-SKILL-INTEGRATION.md` §2 的五类）

| 类别 | 内容 | 处理 |
|---|---|---|
| 教材规则 | `data/review-rules.json` 的 24 条 | 写成 `resources/rules/<规则 id>/`（工作区存储格式，基线复制即可用），id 原样沿用 |
| 方法 | SKILL.md 的分层流程、红线门控、三个回归锚点 | 已落在 `lib/review/pipeline.ts` 的八段 |
| 判据标准 | references 四份 + B1 词表 | 放进 `resources/knowledge/review-standards`，按 `standard_refs` 取用 |
| 报告表达 | 三表/七表、逐项审校列定义、三态结果 | 映射到 `findings.json` + 固定模板 HTML 报告（不实现 XLSX） |
| 实现辅助 | `scripts/*.py`、`assets/*.jpg` | 不移植；版式扫描记为后续确定性扫描器候选 |

## 2. 规则清单（24 条）

| id | 阶段 | 执行方式 | 硬度（本项目推断） | 标题 |
|---|---|---|---|---|
| INTAKE-001 | intake | model_assisted | 普通 | 确认教材、课次与版本角色 |
| INTAKE-002 | intake | hybrid | 普通 | 按依赖范围处理缺失材料 |
| MAP-001 | inventory | hybrid | 普通 | 页面、任务容器与叶元素完整盘点 |
| LEX-001 | language | hybrid | 普通 | 词条语义链闭合 |
| LANG-001 | language | hybrid | Hard | 全英文字符、拼写、词形与句法 |
| LANG-002 | language | model_assisted | 普通 | 中英释义、代词与局部上下文一致 |
| TASK-001 | task | hybrid | 普通 | 指令、标签与实际作答动作一致 |
| TASK-002 | task | hybrid | 普通 | 教学目标到材料、题目与答案的交叉引用闭合 |
| ANSWER-001 | answer | hybrid | Hard | 逐题独立求解与答案材料核对 |
| ANSWER-002 | answer | model_assisted | Hard | 对抗式检查多解、无解与干扰项 |
| ANSWER-003 | answer | hybrid | 普通 | 题干与选项合成及答案容量回填 |
| ALIGN-001 | alignment | hybrid | Hard | 目标、教学内容与练习双向对齐 |
| FACT-001 | facts | source_lookup | Hard | 事实命题、限定与审校日时效 |
| EXAM-001 | exam | source_lookup | Hard | Cambridge 官方任务标签与任务契约 |
| LEVEL-001 | difficulty | model_assisted | Hard | B1—B2 难度与梯度证据 |
| VIS-001 | visual | human_visual | Hard | 图片教学焦点、诊断特征与事实相符 |
| VIS-002 | visual | human_visual | 普通 | 图片比例、裁切与可读性 |
| STYLE-001 | visual | human_visual | 普通 | 粗体、斜体、颜色与高亮按教学角色核对 |
| TYPO-001 | layout | hybrid | Hard | 标点、大小写、符号与空格按文本功能核对 |
| LAYOUT-001 | layout | human_visual | Hard | 阅读顺序、换行、对齐与页间连续 |
| LAYOUT-002 | layout | hybrid | 普通 | 答案线、空格和答案单位容量 |
| FEEDBACK-001 | feedback | hybrid | 普通 | 专家意见与替换稿先复核再采纳 |
| REVISION-001 | delivery | hybrid | 普通 | 修订后重新检查受影响元素和依赖项 |
| REPORT-001 | delivery | hybrid | 普通 | 按元素聚合证据并可回链软件界面 |

## 3. 字段映射

| Skill 字段 | 本项目落点 |
|---|---|
| `rules[].id` | `rule_key`（原样沿用，可按 id 回链） |
| `rules[].title` | `display_name` |
| `trigger` / `checks` / `decision` / `evidence_required` | 规则版本的 `instruction` |
| `phase` / `execution_mode` / `element_kinds` / `review_list_refs` / `standard_refs` | `RuleRow.payload`（元数据，不是机器约束） |
| `materials` | 规则绑定作用域（`all` → global；点名教材 → book，如 EXAM-001 三条 book 绑定） |
| `decision.{pass,needs_revision,cannot_verify}` | Finding 的三态语义（`cannot_verify` ↔ `insufficientEvidence`） |
| `finding_lifecycle.{confirmed,dismissed,unresolved,candidate_only}` | 老师决定 `adopt / ignore / recheck` + `unverified` 标记 |
| `ruleset_version` | `ReviewManifest.rules.rulesetVersion`（历史结果按原版本解释） |

## 4. 待教研确认（已登记 question.md）

1. **硬度推断**（Q-CORE-027）：标准没标 Hard/Soft，转换按它的「硬门槛」六条映射了 10 条为 Hard Rule；
2. **严重度**：已按标准的「不新增严重度字段」执行（2026-10-09 确认，见 question.md A-014）；
3. **逐元素通过记录**（Q-CORE-028）：标准要求登记全部叶元素并保留「通过」项（precision-v2），工作台目前只记问题；
4. **human_visual 四条**（Q-CORE-029）：工作台审的是文字稿、没有成品图片与样式证据，按标准自己的 `cannot_verify` 处理。

## 5. 重新生成

```bash
node --experimental-strip-types scripts/convert-review-skill.mjs <skill-dir>   # 生成
node --experimental-strip-types scripts/convert-review-skill.mjs <skill-dir> --check   # 只自检
npm run test:review-skill   # 离线校验仓库里的基线（不需要 Skill 源目录）
```

改动本目录内容请改转换脚本后重跑，**不要手改生成物**：id 是确定性派生的，重跑结果逐字一致，手改会被下次重跑冲掉。
