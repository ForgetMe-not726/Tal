# 项目文档索引

> 同步基线：profile.md V1.2，2026-09-22。

## 现行权威文档

| 文档 | 负责内容 | 何时读取 |
| --- | --- | --- |
| [总体方案](../profile.md) | 产品定位、架构、数据边界、开发顺序 | 任何产品或技术方向变更 |
| [产品说明](../PRODUCT.md) | 老师可见流程、页面与状态 | 产品流程和前端信息架构 |
| [设计系统](../DESIGN.md) | 视觉语言、布局和组件行为 | UI 设计与实现 |
| [工作区指令](../AGENTS.md) | Agent 读取顺序和工程约束 | 每次项目任务 |
| [项目工作流](../workflow.md) | 需求、开发、双重复核和会话收尾 | 开发与验证 |
| [待确认问题](../question.md) | 唯一未决事项台账 | 需求判断和教研确认 |
| [移交与发布](HANDOVER.md) | 安装包、备份、依赖和新电脑验收 | 发布与交接 |

## 专项规范

| 文档 | 负责内容 |
| --- | --- |
| [OCR 引擎决策](OCR-ENGINE-DECISION.md) | PaddleOCR adapter、输出契约与质量评测 |
| [审校 Skill 整合](REVIEW-SKILL-INTEGRATION.md) | 规则迁移、Finding、人工复核和 HTML 报告 |
| [AI 建议与检索助手](AI-ASSISTANT-RETRIEVAL.md) | Context Pack、建议、检索 adapter 和 PDF 证据 |

## 草稿与证据

- [docs/drafts/README.md](drafts/README.md) 说明教材规则和映射草稿的使用边界。
- `docs/drafts/_refs/` 是从样本材料提取的只读证据，不是现行产品文档或正式规则。
- `_archive/pre-profile-docs-2026-09-01/` 保存 V1.0 之前的历史方案，只供追溯。

## 冲突处理

文档冲突时，`profile.md` 始终优先；其后按职责裁决：用户流程看 `PRODUCT.md`，视觉与交互细节看 `DESIGN.md`，OCR、审校和检索技术契约看对应专项规范。草稿不能覆盖上述文档，`question.md` 中的未决事项也不能被草稿假设为已确认。
