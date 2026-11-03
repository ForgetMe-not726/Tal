# 本地版移交与发布手册

> 离职移交与老师使用教学见 [TRANSFER.md](TRANSFER.md)。本文保留构建、发布、备份和数据契约细节。

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

## 交付形态结论（2026-10-30）

正式交付采用 **Windows x64 本地安装包**：桌面壳 + 本机 loopback 服务 + OCR sidecar + 安装目录下的 `document/` 工作区。**不部署公网网站**。

理由：

- OCR 和整本教材（实测 200 MB 以上）都在本机处理，放服务器会带来算力、上传下载和排队成本；
- 教材原件、Cambridge 参考资料和审校记录属于版权敏感材料，默认不出本机；
- 产品是单人本地工具，没有账号、协作、多租户和远程数据库需求；
- 网站形态会额外引入鉴权、存储配额、备份、租户隔离和合规审查，和 profile 的本地事实源边界冲突。

浏览器访问只作为本机应用的 loopback 调试/兼容方式，不作为交付方式；AI Gateway 仍按任务发送必要上下文。

## 桌面安装包构建（2026-10-30 首版）

首版桌面壳采用 **Electron**（profile §8 的“同等桌面壳”），Next.js 以 standalone 形式随包，
由 Electron 在本机随机 loopback 端口启动；老师不需要 Node/Python/端口。

### 构建步骤（Windows x64）

1. `npm ci`
2. `powershell -ExecutionPolicy Bypass -File scripts/build-ocr-runtime.ps1`
   生成 `build/ocr`（便携 Python + MinerU venv + PDF-Extract-Kit pipeline 模型，约 2.5 GB，
   **不提交 git**）。
3. `node scripts/configure-ai.mjs --build-only`（从 `.env.local` 生成 `resources/config/ai.json`，含内部 Key；文件不提交 git）
4. `npm run stage:collections`（从 `document/knowledge/collections` 整理精简范本集合到
   `build/knowledge-collections`；只带 manifest、modules 和页图，不带原书 PDF/assets；源目录须由构建机准备）
5. `npm run build`（`next build --webpack`；Turbopack 在含中文源码的 code frame 上会 panic）
6. `node scripts/prepare-desktop.mjs`（把 `.next/static`、`public` 补进 standalone）
7. `npx electron-builder --win nsis`（一键安装；首次需配置 `ELECTRON_MIRROR` 与
   `ELECTRON_BUILDER_BINARIES_MIRROR`，或预先缓存 Electron/NSIS）
8. `npm run verify:release`：校验安装包 SHA512/size、Next 产物、node_modules、随包 OCR 模型、
   规则/知识库基线、AI 发布配置和版本号，并把 SHA256 写入 `release/SHA256SUMS.txt`。
9. 产物：`release/AI教材工作台-Setup-<version>.exe`（one-click，per-user，无需管理员）；
   安装到 `%LOCALAPPDATA%\Programs\ai-textbook-workbench`（electron-builder 对非 ASCII
   productName 使用 ASCII 目录名；桌面/开始菜单快捷方式显示“AI教材工作台”），
   `document/` 在安装目录下。0.1.0/P0 实测安装包约 1.55 GB，安装后约 3.0 GB
   （其中 OCR 运行时与模型约 2.5 GB，范本页图约 0.07 GB），本机静默安装约 6–8 分钟。

### 运行时约定

- `AI_TEACHING_INSTALL_DIR` 由 Electron 设为安装目录；`document/`、`resources/` 都以它为基准。
- `MINERU_HOME=<安装目录>/resources/ocr`；`MINERU_TOOLS_CONFIG_JSON` 指向
  `document/.app/ocr/mineru.json`，模型路径在首次启动时写死为随包路径。
- 便携 venv 的 `pyvenv.cfg` 在首次启动时改写成实际安装路径。
- 老师导入的 PDF/Markdown 放在 `document/library/`；索引、OCR 缓存放在 `document/.app/retrieval/`；
  移除资料移到 `document/.recycle/library/`。原始资料只复制、不改写。
- 范本集合随安装包放在 `resources/knowledge/collections/`，首次启动按集合 id 补装到
  `document/knowledge/collections/`，不覆盖已有集合。

### 卸载与升级（2026-11-02 实机回归）

- 卸载入口：Windows“应用和功能”中的“AI教材工作台 0.1.0”，或安装目录下的
  `Uninstall AI教材工作台.exe`；一键安装模式支持 `/S` 静默卸载。
- `build/installer.nsh` 的 `customRemoveFiles` 只删除程序、`resources/`、`locales/`
  和快捷方式/注册表项；**不删除 `document/`**。
- 实机验证：安装当前版本 → 在 `document/` 写入 sentinel → 覆盖安装新包 → sentinel 与
  AI 配置保留 → 静默卸载 → 程序文件和注册表项移除，`document/` 与 sentinel 保留。
- 升级直接再次运行新安装包，覆盖程序与随包资源；`document/` 和
  `%APPDATA%\AI教材工作台\ai-key.bin` 不被覆盖。
- 若需彻底清理，由老师手动删除安装目录下剩余的 `document/`。

### 本地资料库与助手证据（2026-11-03 P0）

- 通用助手现在直接读取 `document/ocr/<dir>/` 中**已确认**的 `content.md` + `structure.json`，
  返回页码、页内块坐标和原页地址；`/api/ocr/library/<dir>/pages/...` 不依赖任务记录。
- 老师可在“本地资料库”导入 PDF/Markdown（文件或文件夹），原件复制到
  `document/library/<item>/files/`；`document/library` 是可直接备份的本地资料目录。
- 数字版 PDF 在本机抽取逐页文字；扫描版 PDF 自动进入本机 MinerU OCR 队列，资料库显示进度。
  导入接口立即返回，OCR 串行执行；应用重启后未完成的条目标记为失败并可重试。
- Markdown 直接索引；PDF 命中可查看原页，Markdown 只显示文字定位。
- 移除资料移动到 `document/.recycle/library/`，不永久删除；索引和页图缓存放在
  `document/.app/retrieval/`，可重建。
- 安装包通过 `npm run stage:collections` 带入 `autumn-2026-l5` 的 manifest、模块正文和页图
  （约 66 MB，不带原书 PDF/assets）；首次启动按集合 id 补装到 `document/knowledge/collections/`，
  不覆盖老师已有集合。

### AI Gateway 凭据（内部工具口径）

- `node scripts/configure-ai.mjs` 从本地 `.env.local` 生成 `resources/config/ai.json`
  （provider/baseUrl/models/apiKey），随安装包分发；该文件含 Key，**不提交 git**。
- 本机已安装的桌面版同时用 Electron `safeStorage`（Windows DPAPI）写一份加密 Key，
  启动时优先使用，便于不改安装包即可换 Key。
- 需求方 2026-10-30 确认：公司内部工具，使用本地 Key，不额外做凭据分发流程。
- 未配置时识别/编辑/导出不受影响，生成/审校明确提示。
- Key 轮换：更新 `.env.local` 后运行 `npm run configure:ai` 可同时更新本机安装版的
  `resources/config/ai.json` 和 DPAPI 文件；给老师的安装包需要重新执行
  `npm run dist:win`（Key 随包）。不要提交 `resources/config/ai.json`，也不要把它复制进
  `document/`。

### 代码签名与分发

- 当前未购买/未配置代码签名证书，安装包未签名，Windows SmartScreen 可能提示
  “未知发布者”。内部分发时需告知老师核对 `SHA256SUMS.txt` 后再运行。
- 证书就绪后设置 `CSC_LINK`（.pfx 路径或 base64）和 `CSC_KEY_PASSWORD`，
  重新执行 `npm run dist:win`；electron-builder 会自动签名安装包和主程序。
- `latest.yml` 与 `.blockmap` 会随构建生成，但当前**没有配置更新服务器**，应用也不会
  自动检查更新；新版本按安装包手动覆盖安装。

### 交付前检查清单

1. `npm test`（含 `test:library`、`test:ocr-corpus`）、`npm run lint`、`npx tsc --noEmit` 通过；
2. `npm run dist:win` 生成含内部 AI 配置的安装包；
3. `npm run verify:release` 通过并生成 `release/SHA256SUMS.txt`；
4. 在一台未装 Node/Python 的 Windows x64 机器上按第 2 节走完 10 步；
5. 记录安装包 SHA256、版本号和已知问题，再交付。

### 尚未完成

- 代码签名证书；
- 安装包在干净 Windows VM 上完成 HANDOVER §2 全流程验收（当前验证机已装开发环境）；
- 自动更新源；
- 安装包体积/安装时长与公司分发渠道确认。

## 3. 工作区备份与恢复

- 工作区是教材、规则、OCR 结果、版本和导出物的唯一事实源；
- 安装包必须装到当前用户**可写**的目录，否则 `document/` 建不出来（程序会给出明确提示，不会写到用户文档目录兜底）；
- 工作区固定在**安装目录下的 `document/`**（`rules/` 规则库、`knowledge/` 资料库、`library/` 老师导入的 PDF/Markdown、`ocr/` OCR 内容，以及 `projects/`、`exports/`、`.app/`）；
- 备份时完整复制 `document/`，保留 `ocr/`、`library/`、`projects/<id>/sources/originals`、`rules/`、`knowledge/`、`projects/<id>/lessons`、`exports/` 和 `.app/`；`library/` 里的原件不能缺失；
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
