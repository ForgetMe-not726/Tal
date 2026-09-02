# ADR-0003：采用现有 Next.js 原型作为前端基线

- 状态：已接受
- 日期：2026-08-26

## 背景

用户已使用 Claude Code 在 `D:\Tal internship\automaster` 制作高保真原型。原型具有完整的控制台和三栏工作台视觉，但使用 Mock 数据且没有后端。

## 决策

将原型主目录中的应用源码、组件、配置和设计文档迁入 `D:\APP` 作为前端基础。排除原型的 `.git`、`.next`、`node_modules`、重复 `pure code` 备份和旧项目级指令。

## 验证

- Next.js 生产构建通过。
- TypeScript `--noEmit` 检查通过。
- npm 审计报告 0 个已知漏洞。
- ESLint 留有 1 个问题：`components/workbench/WorkbenchCenter.tsx` 中通过 effect 同步文件名草稿状态。

## 后果

- 保留现有视觉语言和组件拆分，后续围绕真实领域模型替换 Mock 状态。
- 原型文案和交互不自动升级为产品决策；`Unit`、同步生成、只读正文和模拟导出需按后续 ADR 改造。
