import type {
  BookType,
  BookTypeId,
  FlowUnit,
  Level,
  ModuleDef,
  PlateTone,
  RuleFile,
} from "./types";

export const LEVELS: Level[] = ["L1", "L2", "L3", "L4", "L5", "L6"];

export const DEFAULT_LEVEL: Level = "L3";

export const BOOK_TYPES: BookType[] = [
  { id: "student", label: "学生用书" },
  { id: "knowledge", label: "知识清单" },
  { id: "workbook", label: "练习册" },
  { id: "vocab", label: "单词小超市" },
];

export const UNIT_NO = "Unit 1";

/** 色版循环：青版 → 专色 → 套准绿 → 紫版（学而思多彩油墨） */
const PLATE_TONES: PlateTone[] = ["brand", "spot", "reg", "violet"];
export function plateTone(index: number): PlateTone {
  return PLATE_TONES[index % PLATE_TONES.length];
}

/** 版号字母：A / B / C / D … */
export function plateLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

// ---------------------------------------------------------------------------
// 模块列表（按书种联动）与 Mock Markdown 生成内容
// 主题：L3 · Unit 1 · Colours（颜色）
// ---------------------------------------------------------------------------

const studentModules: ModuleDef[] = [
  {
    id: "student-a",
    label: "Let's explore!",
    markdown: `### Let's explore!

Look at the picture. What colours can you see?

- The sky is **blue**.
- The sun is **yellow**.
- The grass is **green**.

> **Task** 圈出图片中你认识的三个颜色词。`,
  },
  {
    id: "student-b",
    label: "Let's say!",
    markdown: `### Let's say!

**red** /red/ 红色的
**blue** /bluː/ 蓝色的
**yellow** /ˈjeləʊ/ 黄色的

> **Chant** Red, blue, yellow — colours, colours, colours!

- What colour is it?
- It's **red**.`,
  },
  {
    id: "student-c",
    label: "Let's talk!",
    markdown: `### Let's talk!

> **Dialogue** Amy 和 Ben 在教室里谈论颜色。

- Amy：What colour is your schoolbag?
- Ben：It's **blue**. And your pencil?
- Amy：It's **yellow**.

**Pair work** 两人一组，用 What colour 互相问答。`,
  },
  {
    id: "student-d",
    label: "Let's use!",
    markdown: `### Let's use!

用学到的颜色词描述你的文具。

1. My ruler is ______ .
2. My pencil is ______ .

> **Tip** 颜色词放在 be 动词后面作表语。`,
  },
];

const knowledgeModules: ModuleDef[] = [
  {
    id: "knowledge-a",
    label: "A. 单元知识框架",
    markdown: `### A. 单元知识框架

#### Unit 1 知识结构

- **词汇**：颜色词（red / blue / yellow / green / colour）
- **句型**：What colour is it? — It's ...
- **话题**：colours 颜色`,
  },
  {
    id: "knowledge-b",
    label: "B. 重点概念清单",
    markdown: `### B. 重点概念清单

1. **询问颜色**：用 What colour 提问。
2. **回答颜色**：用 It's + 颜色词。
3. **颜色词作表语**：It's red. 不要写成 It's colour red.`,
  },
  {
    id: "knowledge-c",
    label: "C. 易错点辨析",
    markdown: `### C. 易错点辨析

**易错点 1**：回答颜色漏用 is

- × The apple red.
- √ The apple **is red**.

**易错点 2**：What colour 后语序

- × What colour **it** is?
- √ What colour **is it**?`,
  },
];

const workbookModules: ModuleDef[] = [
  {
    id: "workbook-a",
    label: "A. 基础词汇练习",
    markdown: `### A. 基础词汇练习

**一、根据汉语提示填空**

1. 香蕉是 y______ (黄色的)。
2. 天空是 b______ (蓝色的)。

**二、选择正确的颜色词**

3. The apple is ______.
   - A. red　- B. blue　- C. yellow

**三、连一连**

- red — 红色
- blue — 蓝色
- yellow — 黄色`,
  },
  {
    id: "workbook-b",
    label: "B. 语法强化训练",
    markdown: `### B. 语法强化训练

**What colour 句型专项**

1. 补全对话：
   - — ______ ______ is the bag?
   - — It's blue.

2. 看图回答：
   - What colour is the banana? → ______
   - What colour is the sky? → ______`,
  },
  {
    id: "workbook-c",
    label: "C. 完形填空",
    markdown: `### C. 完形填空

This is my schoolbag. It is __1__. I like it very much.

1. A. red　B. red colour　C. colour red

> **Tip** 颜色词可直接作表语，前面不加 colour。`,
  },
];

const vocabModules: ModuleDef[] = [
  {
    id: "vocab-a",
    label: "A. 单词速记卡",
    markdown: `### A. 单词速记卡

**red** /red/ 红色的
> 联想：太阳 red、苹果 red——red 是最热烈的颜色。

**blue** /bluː/ 蓝色的
> 联想：天空 blue、大海 blue——blue 是最安静的颜色。

**yellow** /ˈjeləʊ/ 黄色的
> 联想：香蕉 yellow、太阳 yellow——yellow 是最明亮的颜色。`,
  },
  {
    id: "vocab-b",
    label: "B. 拓展词族",
    markdown: `### B. 拓展词族

**colour（n. 颜色）**

- colourful（adj. 五彩缤纷的）
- colouring（n. 涂色）

**red（adj. 红色的）**

- reddish（adj. 微红的）`,
  },
];

export const MODULES: Record<BookTypeId, ModuleDef[]> = {
  student: studentModules,
  knowledge: knowledgeModules,
  workbook: workbookModules,
  vocab: vocabModules,
};

// ---------------------------------------------------------------------------
// 流程单元库（主页）
// ---------------------------------------------------------------------------

export const FLOW_UNITS: FlowUnit[] = [
  {
    id: "make",
    title: "制作教材",
    desc: "配置层级与书种，按模块生成结构化教材内容",
    accent: "brand",
    href: "/workbench",
  },
  {
    id: "review",
    title: "审校教材",
    desc: "按审校规则对成稿做红笔批注与修订",
    accent: "spot",
  },
  {
    id: "retrieve",
    title: "知识库检索",
    desc: "从结构化知识库召回并引用相关素材",
    accent: "neutral",
  },
];

// ---------------------------------------------------------------------------
// 规则库（灰箱接口）
// ---------------------------------------------------------------------------

export const RULE_FILES: RuleFile[] = [
  {
    id: "structure_primary",
    name: "structure_primary.md",
    desc: "小学教材单元结构规范",
    content: `# 小学教材结构规范

## 单元结构
- 每单元含 3 个课时：A 词汇 / B 句型 / C 语篇
- 每课时正文 60-120 词
- 语篇须含「语篇结构」与「阅读任务」两节

## 版式
- 例句使用 > 引用块标注
- 加粗仅用于重点词汇与核心句型
- 表格用于句型归纳`,
  },
  {
    id: "review_noslang",
    name: "review_noslang.md",
    desc: "审校禁用口语化表达",
    content: `# 审校禁用规则

## 禁用表达
- 口语缩略：gonna / wanna / kinda
- 网络用语：哈哈 / 666 / 绝绝子
- 过度主观：超级 / 无敌 / 爆赞

## 替换建议
- 口语 → 书面表达
- 缩写 → 全写（does not → doesn't 除外）`,
  },
  {
    id: "grammar_pacing",
    name: "grammar_pacing.md",
    desc: "语法点分布与难度梯度",
    content: `# 语法难度梯度

## 分布原则
- 每单元最多 1 个新语法点
- 语法复现间隔不超过 2 个单元

## 难度梯度
1. 感知（情境导入）
2. 归纳（句型表格）
3. 应用（练习与语篇）`,
  },
  {
    id: "knowledge_graph",
    name: "knowledge_graph.md",
    desc: "知识库检索召回策略",
    content: `# 知识库召回策略

## 召回
- 优先命中同层级、同话题素材
- 命中分数低于阈值时回退到通用语料

## 引用
- 引用素材须标注来源与版本号`,
  },
];
