# OCR 引擎选型与本地集成方案

> 状态：2026-09-22 已与 profile.md V1.2 同步。适用于本地个人工具，不授权立即下载、复制或分发任何第三方代码/模型；正式打包前必须复核上游版本与许可证。

## 决策

默认采用 **MinerU** 作为本地教材资料识别引擎，以独立 sidecar Worker 运行；PaddleOCR PP-StructureV3 作为同批评测的对照候选。

本工具调用上游引擎并消费结构化输出；不复制、魔改或自研 OCR 核心算法。

## 为什么不是普通 OCR

教材 PDF 往往包含中英文混排、图片、表格、文本框、页眉页脚、栏目和复杂阅读顺序。只得到一段纯文本无法支持后续的 Lesson/Module 切分、图片迁移、表格校对和来源定位。

应用需要的结果至少包括：

~~~text
page
block_id
block_type: title | text | table | image | list | other
bbox
reading_order
text / table payload
confidence / warnings
asset path
source page
~~~

## 主引擎：MinerU

- 上游：opendatalab/MinerU
- 能力：OCR、布局检测、表格识别、公式识别、阅读顺序恢复、Markdown 输出；
- 许可：代码采用 Apache-2.0 加附加条款（`LicenseRef-MinerU-Open-Source-License`）；发布版本与所带模型许可仍须逐项归档；
- 集成方式：发布包携带固定版本 Python runtime、Worker、模型和启动脚本。桌面应用经本地命令桥创建任务、读取结果、取消任务和显示进度。

不把 Worker 作为公网服务启动，不要求老师运行命令，不让老师下载模型或填写 Python 路径。

## 备选与对比

| 方案 | 角色 | 结论 |
| --- | --- | --- |
| MinerU | **默认本地解析器** | 已在真实教材（学生用书 131 页、知识清单 52 页）验证，输出已匹配稳定契约；许可证为 Apache-2.0 加附加条款，**商用与分发允许**（商业许可门槛为月活 1 亿 / 月收入 2000 万美元，本项目远未触及）；随包分发仍走 Q-CORE-012 确认，并逐项归档所带模型许可 |
| PaddleOCR PP-StructureV3 | 同批评测的对照候选 | 代码 Apache-2.0；所带模型许可须逐项归档。未在真实教材上验证前不得替换默认引擎 |
| Docling | 多格式/统一文档模型的备选 | 进入质量对比；MIT 代码，仍需核验模型许可 |
| OCRmyPDF / Tesseract | 辅助文字层或兜底 | 不承担结构化教材加工 |

## 已落地的 adapter（2026-09-29）

`lib/ocr/` 是唯一调用外部进程的地方，业务层只读 `sources/ocr/<学期>-<书种>-ocr/`（如 `spring-sb-ocr`）下那几个文件。

实测命令（MinerU 3.4.5，本机 venv）：

```bash
mineru.exe -p <pdf> -o <临时目录> -b pipeline -m ocr -l ch
```

三个必须记住的实测事实：

1. **必须显式 `-b pipeline`**——默认是 `hybrid-engine`，CPU 上实测 21 分钟跑不完、单进程 4.3 GB；
2. 输出子目录由 backend+method 决定（`pipeline` → `<out>/<stem>/<method>/`，method 随 `-m` 变），**不能硬编码**；
3. 取消必须杀**进程树**——不给 `--api-url` 时 CLI 会再拉起一个 `mineru-api` 子进程。

归一化的三条要点：

- 主输入是 `_content_list.json`（v1，**不是 v2**）：它保留了 `header`/`footer`/`page_number` 块，
  而旧版教材的课号印在页眉——判课边界只能靠它；
- 它的 `bbox` 在**归一化的 1000×1000 方框**里，不是 PDF 点（实测三本书、两种页面尺寸都吻合），
  拿它和 `middle.json` 的 `page_size` 混算会让块框整体跑偏；
- **整页页图引擎不产出**，由 adapter 用 venv 里的 `pypdfium2` 从 `_origin.pdf` 渲染
  （`pymupdf`/`fitz` 在本环境未安装）；`_layout.pdf` / `_span.pdf` **不复制进工作区**
  （学生用书这两份合计 544 MB）。

## 引擎适配契约

Worker 的上游输入输出必须封装在 adapter 内，业务层只读取下列本地文件：

~~~text
ocr-job/
  manifest.json
  content.md
  structure.json
  pages/
  assets/
  diagnostics.json
~~~

manifest 至少记录：

- 原文件指纹、页数和导入时间；
- 上游引擎、版本、模型版本、CPU/GPU模式和参数；
- 成功、失败、取消、待核对状态；
- 输出文件清单和可恢复诊断。

任何引擎都不能绕过老师确认而直接写入 Production Source。

## UI 与任务要求

1. 文件导入后先复制到工作区的 sources/originals（**不再要求选项目**：单机单人工具，整个工作区一个资料库）；
2. OCR 在后台运行，关闭任务面板不取消任务；
3. 每页可查看原图、块框和结构化输出；
4. 老师可修改文字、表格、块类型、Lesson 和 Module 边界；
5. 点击“确认并加入资料库”后，才生成可被迁移检索的来源清单；
6. 失败或低置信结果必须可定位到页和块，不能只显示“识别失败”。

### 任务记录与清理（2026-10-21）

- **只保留成功识别的书目**：失败、中断、取消的任务一律清理——杀进程树（Windows 的
  `mineru-api` 会留孤儿）、删页图与上游产物、删任务记录；老师重新导入 PDF 即可。
  失败原因单独写进 `.app/logs/ocr-failures.log`，不留记录也不丢线索。
- **最多保留 10 条记录**，超出时从最早的**未确认**记录开始清；**已确认的来源永不自动删**
  （那是资料库事实源）。
- **重启可续跑**：上游产物落在稳定目录 `<ws>/.app/ocr-upstream/<jobId>/`（不是系统临时目录），
  应用重启后如果 MinerU 还在跑就等它，跑完了直接整理；进程没了但产物齐全也照样整理，
  不再让老师白等 5 分钟。
- **不误判"陈旧"**：任务记录带 `ownerPid`，本进程创建的任务在 MinerU 退出后（此时还要整理
  几十秒）不会被判成中断。
- `.app/jobs` 与审校共用：识别列表只认带 `bookType` 的记录；审校记录若缺失，会从
  `lessons/*/review/*/manifest.json` 自动重建。

### 进度与页数（2026-10-21 修正）

**页数只认 PDF 自己的**：MinerU 的 tqdm 进度条混着**区域数**——`OCR-rec Predict: 852/954` 是文字区域、
`OCR-det: 12/17` 是检测批次；只有 `Layout Predict` 与 `Processing pages` 是页级阶段。
此前把所有 `N/M` 都当页数，实测一本 **83 页**的书在界面上显示成 **1314/1668 页**。

现在的做法：

- 任务开始时用 pypdfium2 读 PDF 的真实页数，写进任务记录（`pagesSource: pdf`）；
- 进度解析只认页级阶段，且**分母必须等于真实页数**，否则丢弃；
- 旧记录在首次列出时一次性校正（并归一化中断任务的阶段文字）。

界面上**运行中显示阶段百分比**（如「识别中 · 文字识别 62%」），页级阶段才显示 `N/M 页`。
原因：文字识别阶段占大头（83 页的书约 3–5 分钟），它报的是**文字区域数**；旧实现把这
一阶段整段忽略，界面就一直是 `0/83`，看起来像卡死。

## 质量验证

在开发集成前，用公司允许的真实样张建立小型基准集，至少覆盖：

- 扫描中英文教材页；
- 多栏阅读页；
- 词汇卡和语法表格；
- 含插图、题号、页眉页脚的页面；
- OCR 易错的音标、专有名词和小字号文字。

用同一批样张比较 MinerU、PaddleOCR 和 Docling。评价不只看字符准确率，还要记录：

- 阅读顺序是否正确；
- 表格是否可编辑；
- 图片、页码与文字块是否对应；
- Lesson/Module 切分所需人工修订量；
- CPU 机器上的耗时和安装包体积；
- 失败是否可诊断和恢复。

默认引擎在真实样张完成评测前不得宣称“已满足教材生产精度”。

## 上游资料

- [PaddleOCR PP-StructureV3](https://github.com/PaddlePaddle/PaddleOCR/blob/main/docs/version3.x/algorithm/PP-StructureV3/PP-StructureV3.en.md)
- [PaddleOCR repository](https://github.com/PaddlePaddle/PaddleOCR)
- [Docling repository](https://github.com/docling-project/docling)
- [MinerU repository](https://github.com/opendatalab/MinerU)

调研日期：2026-09-21；文档同步日期：2026-09-22。
