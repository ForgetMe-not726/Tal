# 知识库（随安装包分发）

本目录的内容会**随安装包分发给每位老师**（2026-10-27 需求方确认），首次启动时复制到 `<安装目录>/document/knowledge/` 下。
之后以工作区里的副本为准；老师新增的资料只进工作区，不回写这里。

## 目录结构

```
knowledge/
  collections/                  一次投入的一批资料（可扩展）
    <collection-id>/
      manifest.json             批次元数据 + 索引（书种/课/模块 → 文件、页范围）
      ocr/<book>/               content.md / structure.json / pages/ / assets/ / original.pdf
      modules/<bookType>/lesson-NN/<moduleKey>.md   按模块切好的正文（带页码标记）
  grammar/                      语法参考（按语法点 GR01–GR22，含 index.json）
  review-standards/             审校判据（公司审校标准，按小节引用）
  entries.json                  工作区级知识条目（预留；目前没有生产写入路径）
```

范本教材集合（`collections/<id>/`）随包分发，但体积较大（含页图与 OCR 产物，首批约 492 MB）：
代码不把大文件提交进 git，由安装包构建步骤从指定目录带入本目录的 `collections/`。
基线按条目补齐、不覆盖老师已有内容。

## 四类资料与各自的用途

| 资料 | 位置 | 被谁用 | 取用方式 |
|---|---|---|---|
| **范本教材**（已定稿的新版教材） | `collections/<id>/`（`kind: exemplar`） | 生成 | 按**书种 + 模块**取同模块范本，随 Prompt 带一份，教模型"这个模块该长什么样" |
| **剑桥权威资料 / 参考** | `collections/<id>/`（`kind: cambridge` / `reference`） | 通用助手、修改建议 | 检索命中后按来源定位取用 |
| **语法参考** | `grammar/` | 生成、修改建议 | 按大纲的语法字段 → `index.json.labels` → 取那一个语法点 |
| **审校判据** | `review-standards/` | 审校 | 按规则的 `standard_refs` 精确取小节 |

**为什么按模块切**：生成要的是"同书种、同模块"的范本，按结构化键直接取就是 O(1)；
不做"整本 PDF 全文向量检索"（profile §6.2：Structured Retrieval 优先）。

## 新增一批资料

用 `scripts/ingest-knowledge-collection.mjs`（可重跑，不手抄）：

```bash
node --experimental-strip-types scripts/ingest-knowledge-collection.mjs \
  --id=autumn-2026-l5 --title=2026秋下L5完成版教材 \
  --kind=exemplar --grade=L5 --term=autumn \
  --book=student=<MinerU 输出目录> --book=workbook=<...> --book=knowledge=<...>
```

脚本做三件事：① 归一化 OCR 产物（正文/结构/页图/资产/原件）；② 按课与模块标题切分；
③ 写 `manifest.json`。切分用的是 `lib/modules/directory.ts` 里的模块标题，
不在这里硬编码栏目名。

`manifest.json` 是**索引**，可以从 `ocr/` 与 `modules/` 重建；文件才是事实源
（profile §3：任何索引都必须可重建，不能成为唯一事实源）。

## 与教材来源的区别

- **知识库资料**（本目录）：范本、权威标准、参考——随包分发或按批投入，跨项目可用。
- **教材来源**（`projects/<id>/lessons/<key>/sources.json`）：老师的旧版教材，
  经确认后才是 Production Source，**不随包分发**。

## 许可

第三方资料随包分发前必须确认授权口径（见 `question.md` 的 Q-CORE-017 / Q-CORE-032）。
`manifest.json` 的 `license` 字段用于记录每一批资料的来源与许可说明。
