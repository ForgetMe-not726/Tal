# AI 教材智能迁移与审校工具

> 文档同步基线：profile.md V1.2，2026-09-22。

这是一个面向教研老师个人使用的本地教材迁移、优化与审校工具。它将旧版教材、规则、剑桥参考资料与 OCR 结果保存在老师本地工作区，帮助老师完成“资料识别 → 教材制作 → 教材审校”的闭环，并提供受控的 Module 修改建议和可查看原书 PDF 证据的通用助手。

当前仓库仍是 Next.js / Supabase 原型，主要保留 UI、规则、检索、版本与 DOCX 的迁移资产；正式产品方向已调整为 Windows 本地安装包、文件工作区与本地 OCR Worker。

先阅读：

- [项目文档索引](docs/README.md)
- [总体方案](profile.md)
- [产品说明](PRODUCT.md)
- [OCR 选型](docs/OCR-ENGINE-DECISION.md)
- [审校 Skill 整合与 HTML 报告](docs/REVIEW-SKILL-INTEGRATION.md)
- [AI 修改建议与本地检索助手](docs/AI-ASSISTANT-RETRIEVAL.md)
- [待确认问题](question.md)
- [本地版移交说明](docs/HANDOVER.md)

## 原型开发说明

安装依赖后，可运行：

~~~text
npm run dev
npm test
npm run build
~~~

这仅用于现有原型维护和后续本地化迁移验证，不是老师端的正式安装方式。
