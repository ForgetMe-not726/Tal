---
name: AI 教研自动化工作台
description: 教培 AI 教材自动化 · 出版排样台视觉系统
colors:
  brand: "#0056bf"
  brand-deep: "#003a8c"
  brand-tint: "#e5effb"
  spot: "#f97316"
  spot-tint: "#feefe3"
  reg: "#00a06b"
  violet: "#7c5cff"
  violet-tint: "#efeaff"
  proof: "#e5484d"
  ink: "#161b20"
  ink-2: "#46505a"
  ink-3: "#5b6773"
  line: "#e2e7ec"
  paper: "#ffffff"
  sheet: "#fbf8f1"
  canvas: "#e9edf1"
  chrome: "#14181c"
  chrome-2: "#1e242a"
typography:
  body:
    fontFamily: "PingFang SC, Hiragino Sans GB, Microsoft YaHei, Segoe UI, system-ui, sans-serif"
    fontWeight: 400
  content:
    fontFamily: "Songti SC, STSong, SimSun, Noto Serif SC, serif"
    fontSize: "15px"
    lineHeight: "1.75rem"
  label:
    fontFamily: "SF Mono, Cascadia Code, Consolas, JetBrains Mono, monospace"
    fontSize: "12px"
rounded:
  sm: "2px"
  md: "6px"
  lg: "8px"
spacing:
  sm: "8px"
  md: "16px"
  lg: "24px"
components:
  button-primary:
    backgroundColor: "{colors.brand}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    height: "36px"
    padding: "0 16px"
  button-primary-hover:
    backgroundColor: "{colors.brand-deep}"
---

# Design System: AI 教研自动化工作台

## Overview

**Creative North Star: "出版排样台（The Prepress Station）"**

教材工作台是一张印前拼版纸：配置与规则是印前参数，模块是油墨色版，正文是落墨的排样。它拒绝通用 SaaS 的「白卡片 + 蓝色按钮 + 图标网格」套路，转而用出版印前车间的语言——裁切线、套准十字、色标条、油墨 CMYK——承载一个教研人员真正在做的任务：像排版一样控制 AI 生成教材。

气质是「克制而坚定」：Operate 工具应有的熟悉与克制打底，同时用印前标记做出别人无法照抄的辨识度。密度较高（工单、模块、参数），但中央 A4 纸始终是唯一的焦点，四周的 chrome 退后。

**Key Characteristics:**
- 墨色系：青版（学而思蓝）+ 专色（学而思橙）+ 墨黑，纸白 / 暖纸白 / 冷灰拷贝台
- 工具是 sans，产品是 serif——一眼分清「在改工具」还是「在看成品」
- 细发丝裁切线 + 套准十字 + 版号色标条是签名几何
- 落墨（ink-settle）与出片（plate-fill）是唯一的署名动效

## Colors

调色板是一套「墨色」体系：正文与 chrome 是墨黑 + 两级浅墨，学而思品牌蓝/橙被抽象为两种工艺油墨，只在状态与色版上出现，不做装饰。

### Primary
- **青版（Process Cyan）** (#0056bf)：主行动色。用于主按钮、当前选中、色版 A 的填充、链接文字用其深色版（见 Neutral 规则）。这是学而思主标识色。

### Secondary
- **专色（Spot Orange）** (#f97316)：审校 / 强调色，色版 B 的填充。学而思辅色。少量出现。

### Neutral
- **墨黑（Ink / Key）** (#161b20)：正文主色、深色侧栏 chrome。
- **次墨（Ink-2）** (#46505a)：次要文字、标签。
- **浅墨（Ink-3）** (#5b6773)：三级文字、提示、占位。在纸白与暖纸白上均 ≥4.5:1。
- **发丝线（Line）** (#e2e7ec)：边框、分隔线。
- **纸白（Paper）** (#ffffff)：工具 chrome 表面（侧栏、卡片、表单）。
- **暖纸白（Sheet）** (#fbf8f1)：A4 正文纸专用，暖于纸白。
- **拷贝台（Canvas）** (#e9edf1)：工作区底，冷灰，模拟拷贝台。
- **深色侧栏（Chrome）** (#14181c)：全局 60px 导航栏底。

### Named Rules

**The Two-Paper Rule.** 工具 chrome 用中性纸白（#ffffff），正文 A4 用暖纸白（#fbf8f1）。冷暖之分是「工具 vs 产品」的边界，二者不得混用。

**The Process-Ink Rule.** 品牌蓝/橙只作「油墨」——状态、选中、色版。它们不铺满区域，也不作装饰。链接与小号文字用青版的深色变体 brand-deep（#003a8c）而非 brand，以满足正文对比度。

## Typography

**Body Font:** PingFang SC / Hiragino Sans GB / Microsoft YaHei / Segoe UI（system-ui 栈）——工具 chrome 一律无衬线。
**Content Font:** Songti SC / STSong / SimSun / Noto Serif SC（宋体 serif）——教材正文专用。
**Label/Mono Font:** SF Mono / Cascadia Code / Consolas——工单字段、文件名、版号等数据读号。

**Character:** 单家族负责工具界面（无衬线够用，Operate 无需 display/body 配对），宋体只出现在生成的教材正文里。这种「工具 sans / 产品 serif」的分离是本系统的核心字体立场。

### Hierarchy
- **Title**（semibold 600, 15px, 1.2）: 面板标题、卡片标题。
- **Body**（400, 14px, 1.5）: 工具界面正文。
- **Content**（400, 15px, 1.75rem / 28px）: 教材正文，宋体，行高 1.75，一栏 65–75ch。
- **Label**（500, 12px，等宽）: 工单字段、文件名、版号、参数读号。

### Named Rules
**The Serif-is-the-Product Rule.** 宋体 serif 只出现在 A4 正文纸上。工具 chrome（按钮、标签、面板）永不使用 serif。

## Layout

- **全局骨架**：60px 深色侧栏（品牌十字 logo + 两个图标导航：主页/工作台）+ 右侧内容区。
- **工作台三栏**：左 240px（参数配置 + 印刷工单）｜中自适应（A4 拼版纸，max-w 680px 居中）｜右 280px（模块色版列表）。
- **栅格**：内容容器 max-w-5xl（主页）；正文 A4 宽 max-w-680px，居中于冷灰拷贝台上，两侧留白呼吸。
- **间距节奏**：紧凑组内 8px，组间 16–24px；标题上方留白大于下方。
- **响应式**：低于 lg（1024px），工作台左右面板坍缩为滑动抽屉（工具栏两个图标开关 + 半透明背板）；主页卡片单列堆叠。桌面宽屏为第一优先级。

## Elevation & Depth

分层靠「软阴影 + 发丝线」而非颜色块。A4 拼版纸与卡片悬浮于拷贝台之上，用同一枚 layered shadow；面板之间用 1px 发丝线分隔，不投影。

### Shadow Vocabulary
- **paper**（`box-shadow: 0 1px 1px rgba(22,27,32,.06), 0 8px 24px rgba(22,27,32,.08), 0 24px 48px -16px rgba(22,27,32,.14)`）: 唯一的阴影。用于 A4 纸、卡片、Dialog、抽屉。

### Named Rules
**The Flat-By-Default Rule.** 面板、工具栏、表单在静止时是平的，仅以发丝线分层；阴影只赋予「悬浮物」——A4 纸、卡片、弹层。

## Shapes

- **边角策略**：控件 rounded-md（6px），卡片/大按钮/Dialog rounded-lg（8px），A4 纸 rounded-[2px]（近乎直角，像纸张），色版块 rounded-[3px]，徽章 rounded-full。
- **签名几何**：A4 纸四角的 L 形裁切线、左上角的套准十字（圆环 + 十字刻度，内容对齐后变绿）、纸边右上的版号色标条（按青版/专色/墨黑着色的方块）。

## Components

### Buttons
- **Shape:** rounded-md（6px），高 36px，内边距 0 16px。
- **Primary:** 青版蓝底白字（bg-brand / #0056bf），hover 加深至 brand-deep。
- **Secondary / Outline:** 纸白底 + 发丝线 + 次墨文字；hover 转拷贝台底。
- **Ghost:** 无底，次墨文字，用于工具栏图标开关。

### 模块色版按钮（Signature）
- 生成动作的核心控件：纸白底 + 发丝线 + rounded-lg（8px）+ 阴影，hover 提亮至 brand-tint 并微升。
- 左端一枚按油墨着色的版号方块（青版/专色/墨黑）；右端未生成时显示「+ 生成」（brand-deep），已生成显示套准绿勾，生成中显示旋转图标。

### Cards / Containers
- **Corner:** rounded-lg（8px）。**Background:** paper。**Border:** 1px line。**Shadow:** paper。**Padding:** 20px。

### Inputs / Fields
- **Style:** paper 底 + 1px line + rounded-md（6px）+ 轻微阴影，高 36px。
- **Focus:** 2px 青版 ring（ring-brand）。**Placeholder:** 浅墨（ink-3）。

### Navigation（全局侧栏）
- 60px 深色 chrome，圆角图标钮；激活态 = 深一级底 + 青版图标；悬停有 tooltip。

### 拼版纸（A4 Sheet，Signature）
- 暖纸白底 + rounded-[2px] + paper 阴影，四周裁切线，左上套准十字，右上版号色标条；正文宋体，模块版头带版号方块 + 「第 N 版」。

## Do's and Don'ts

### Do:
- **Do** 用宋体 serif 呈现 A4 正文，用无衬线呈现工具 chrome——二者永不混用。
- **Do** 用品牌蓝/橙作为「油墨」承载状态与色版，小号品牌文字用 brand-deep（#003a8c）。
- **Do** 让 A4 纸成为焦点，四周 chrome 退后（纸白/冷灰拷贝台）。
- **Do** 用裁切线、套准十字、版号色标条延续印前语法。

### Don't:
- **Don't** 用渐变文字或彩色描边替代粗细与字号层级。
- **Don't** 用硬偏移阴影（offset 无 blur）——本世界的阴影始终软而分层。
- **Don't** 用 emoji/字符充当图标——图标一律来自统一描边的图标库或自绘 SVG。
- **Don't** 在工具 chrome 中使用宋体/display 字体。
- **Don't** 让品牌色铺满区域或作纯装饰——油墨只在状态、选中、色版上出现。
