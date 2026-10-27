# 本地版移交与发布手册

> 本手册适用于 profile.md V1.2 之后的本地个人工具。当前 Next.js / Supabase 原型只作为迁移参考，不能按旧的云端移交流程发布给老师。

## 1. 交付资产

| 资产 | 正式交付方式 | 不能交给老师做的事 |
| --- | --- | --- |
| 桌面应用 | Windows x64 安装包 | 安装 Node.js、Python 或数据库 |
| OCR Worker 与模型 | 随安装包或应用内模型包交付 | 手工下载模型、配置命令行 |
| 教材项目 | 本地工作区文件夹 | 导入远程数据库 |
| 规则与参考资料 | 工作区内可复制的 Markdown / JSON / 原始文件 | 编辑环境变量 |
| 审校结果与报告 | `findings.json`、老师决定和可重建的静态 HTML | 手工拼接或执行模型生成的网页脚本 |
| 本地检索 | 可重建索引、来源定位与页图证据 | 把内部索引当作唯一资料源 |
| AI Gateway 凭据 | 发布配置或系统凭据库 | 写入项目文件或 git |

## 2. 新电脑验收

在一台未装开发环境的 Windows x64 电脑上：

1. 运行安装包；
2. 从桌面打开应用；
3. 确认应用自动创建本地工作区；
4. 导入扫描 PDF，完成一次 OCR 并查看页图、文本、表格和图片；
5. 确认来源，生成并保存一个 Module Draft；
6. 对 Module 提出自然语言修改要求，查看并采用一条有规则和来源依据的建议；
7. 在独立审校页面完成一次审校，在软件内生成并查看 HTML 报告；
8. 用通用助手定位一个知识点并查看原书页图；
9. 导出 DOCX；
10. 复制整个工作区到另一台已安装应用的电脑，确认可继续打开。

上述过程不得要求终端、Python、Node、数据库、端口、环境变量或模型路径。

## 3. 工作区备份与恢复

- 工作区是教材、规则、OCR 结果、版本和导出物的唯一事实源；
- 安装包必须装到当前用户**可写**的目录，否则 `document/` 建不出来（程序会给出明确提示，不会写到用户文档目录兜底）；
- 工作区固定在**安装目录下的 `document/`**（`rules/` 规则库、`knowledge/` 资料库、`ocr/` OCR 内容，以及 `projects/`、`exports/`、`.app/`）；
- 备份时完整复制 `document/`，保留 `ocr/`、`projects/<id>/sources/originals`、`rules/`、`knowledge/`、`projects/<id>/lessons`、`exports/` 和 `.app/`；
- .app/index.json 等索引可以重建，但原件、manifest、正文、结构 JSON 和版本文件不能缺失；
- 项目删除默认进入工作区回收区；除非用户明确确认，不删除原始教材和导出文件。

## 4. 依赖与许可证

安装包必须装到当前用户可写的目录，并由桌面壳把程序所在目录通过 `AI_TEACHING_INSTALL_DIR` 传给应用；工作区固定为该目录下的 `document/`。

每个发布版本应附带依赖清单，至少记录：

- 桌面壳与前端版本；
- OCR Worker、PaddleOCR、模型、PDF 渲染组件的版本与许可证；
- 任何可选 OCR 引擎的启用状态；
- DOCX、AI Gateway 客户端和其他第三方库的版本。

MinerU 或其他带附加许可的 OCR 引擎，未经公司确认不得放入安装包。

### 资料识别（Local-1）的实测依赖

| 依赖 | 版本 | 许可 | 状态 |
| --- | --- | --- | --- |
| MinerU（本机 venv，`~/.venvs/mineru`） | 3.4.5 | Apache-2.0 + 附加条款（商用与分发允许，门槛远未触及） | 随包分发已由需求方确认（2026-10-27，A-018）；发布前登记版本与许可证 |
| pypdfium2（渲染整页页图） | 5.10.1 | Apache-2.0 / BSD 系 | 随 venv 提供；随包分发前同样逐项核验 |
| MinerU 所带模型（PDF-Extract-Kit、MinerU2.5-Pro） | 见 `~/mineru.json` | 需逐项归档 | 随包分发已确认（A-018），发布前逐项归档 |

引擎路径由环境变量 `MINERU_HOME` 指定（默认 `~/.venvs/mineru`）。安装包阶段这一层要换成
随包 sidecar——`lib/ocr/mineru.ts` 是唯一需要改的地方，业务层不动。

## 5. 当前原型的迁移提醒

当前仓库中仍包含 Next.js API、Supabase migration、Mock Store 与环境变量示例。它们是旧原型的实现资产，后续本地化开发要逐步替换，不得把 Supabase 密钥、远程数据库或对外 API 一并带入正式老师安装包。

用户后续提供的审校 Skill 与本地检索工具也属于迁移资产。交接时必须记录其原始版本、许可证、迁移映射、adapter 版本和评测结果，不能只留下已改写后的提示词或不可重建索引。

## 6. 开发工具状态

- Impeccable 已于 2026-09-22 从官方 GitHub 仓库的 `skill-v4.3.1` 标签更新到 4.3.1。
- 更新包通过 GitHub Skill Installer 下载；安装前核对了 `SKILL.md` 版本、内部文档链接、Windows 启动器和文件清单。
- 原 4.1.1 目录已移出活动技能目录，保存在 `.agents/skill-backups/impeccable-4.1.1-20260922`；确认新版稳定后再决定是否删除。
- 新版 `impeccable.cmd context --target PRODUCT.md` 健康检查已通过。当前项目没有启用自动设计 hook；UI 实现完成后需按新版提示手动运行 detector，或另行启用 hook。
- 新版检查指出 PRODUCT.md 仍是旧 schema。只能在用户确认后运行 Impeccable `init`，由访谈补齐 Positioning、Operating Context、Evidence on Hand 和 Product Principles；不能从现有内容擅自推断改写。
