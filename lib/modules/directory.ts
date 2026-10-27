/**
 * 各书种的**出厂默认模块目录**。
 *
 * 这是模块目录的**出厂默认**：首次运行时写入工作区的 `module-definitions.json`，
 * 之后以工作区文件为准。目录项 `payload` 里的同名字段会覆盖这里的默认值——
 * 教研可以不改代码就调整模块与骨架（见 `resolveModuleOutline`）。
 *
 * 为什么必须带书种：**同一个 module_key 在不同书种里是完全不同的东西**。
 * `lets_say` 在知识清单是中文词卡表，在学生用书是英文短篇 + word box + 派生词练习。
 * 早先按 module_key 单独索引，导致学生用书查不到骨架而静默回退，这是本次重构要修的核心问题。
 *
 * 骨架只描述“内容长什么样”，不写死任何学期、Lesson、词汇或语法事实。
 */

import type { BookType, LessonType, ModuleDefinitionRow } from "../db/types.ts";
import type { LegacySectionKey } from "../knowledge/legacy-markdown.ts";
import { VOCAB_CARD_HEADER } from "../markdown/word-card.ts";

export class ModuleDirectoryError extends Error {}

/** 确定性生成器：不走模型，直接由大纲算出正文。 */
export type DeterministicBuilder = "objectives_table" | "objectives_lesson_page";

export type ModuleOutline = {
  bookType: BookType;
  moduleKey: string;
  /** 工作台与文档里显示的模块名，例如 `Let's say! · 核心词汇`。 */
  displayName: string;
  /**
   * 正文里的标题（不含编号），例如 `Let's say!`。
   * `null` 表示该模块不显示独立标题——知识清单的「学习目标」标题并进表格首行。
   */
  heading: string | null;
  sortOrder: number;
  /** 是否参与整课编号。参与的话按同书种内的 sortOrder 顺序编 1、2、3… */
  numbered: boolean;
  /** 适用课型。学生用书的 explore/read 只在常规课出现。 */
  lessonTypes: LessonType[];
  /** 有值时该模块由代码确定性生成，不调用模型。 */
  deterministic?: DeterministicBuilder;
  /** 从旧版材料里取哪些栏目（规范键，见 legacy-markdown 的 LegacySectionKey）。 */
  sourceSections: LegacySectionKey[];
  /**
   * 复习课的来源栏目；没写就沿用 `sourceSections`。
   *
   * 复习课的题源与常规课不同：练习册的复习单元是整课复习，它的内容按 `revision` 归口
   * （旧版复习单元没有 `Hello X` 栏目名，只有 ①–⑤ 编号题），常规课的任何模块都不取它。
   */
  revisionSourceSections?: LegacySectionKey[];
  /** 输出结构说明，原样进入 Prompt。 */
  outline: string;
  /**
   * 复习课的输出结构说明；没写就沿用 `outline`。
   *
   * 复习课的小节结构与常规课不同（学生用书复习课只有 say/talk/use，小节从 1a 起，
   * 内容是把旧版整课复习材料当题源重排），所以骨架也得分开写。
   */
  revisionOutline?: string;
  /** 目录本身是否已由教研确认。placeholder 表示占位待确认。 */
  status: "placeholder" | "confirmed";
};

const PLACEHOLDER = "placeholder" as const;
const ALL_LESSON_TYPES: LessonType[] = ["regular", "revision"];
const REGULAR_ONLY: LessonType[] = ["regular"];

const VOCAB_CARD = `每个词条输出一张表格，第一行是固定表头，第二行是四个取值，之后每个字段各占一行：

| ${VOCAB_CARD_HEADER.join(" | ")} |
| --- | --- | --- | --- |
| <等级> | <词汇> | <音标> | <词性>. <中文释义> |
| 释义 | <英文释义> | | |
| 搭配 | <英文搭配 中文解释> | | |
| 拓展 | <派生或近反义词 中文解释> | | |
| 例句 | <英文例句>；<中文翻译> | | |

每张词卡表前面单独一行写**裸序号**（\`1\`、\`2\`、\`3\`…），不要写「1 B2 admission」这种带等级和词汇的行——
等级和词汇都在表格里，重复写会多出一行。

格式硬性要求：
- 表格每一行必须写在一行内，单元格里绝对不能换行；多项内容用“；”分隔，不要用回车或 \`<br>\`。
- 表头四个字段名和顺序不能改，也不要增删列。
- 释义/搭配/拓展/例句四行只在第二列写内容，后面两列留空（渲染时会自动合并成整行）。

字段填写规则：旧版来源里的注音、词性、释义、搭配、拓展和例句是已经人工核验过的，直接采用并整理格式，不要因为“无法二次核对”而留空或写待确认。只有来源里确实没有该字段时，才省略“搭配”“拓展”两行，或让“音标/释义/例句”的取值**留空**——留空即可，不要写“（待人工确认）”这类占位文字。`;

// ---------------------------------------------------------------------------
// 知识清单（Parent's Book）
// ---------------------------------------------------------------------------

const KNOWLEDGE_MODULES: ModuleOutline[] = [
  {
    bookType: "knowledge",
    moduleKey: "learning_objectives",
    displayName: "学习目标",
    heading: null,
    sortOrder: 0,
    numbered: false,
    // 复习课没有知识清单（需求方 2026-10-27 确认）。
    lessonTypes: REGULAR_ONLY,
    deterministic: "objectives_table",
    sourceSections: [],
    // 本模块由 buildObjectivesMarkdown 直接生成，不走模型，这里的说明仅作档案。
    outline: "确定性映射：目标词汇取核心词汇，核心语法取语法点，阅读文章与技能训练无信息时留空。",
    status: PLACEHOLDER,
  },
  {
    bookType: "knowledge",
    moduleKey: "lets_say",
    displayName: "Let's say! · 核心词汇",
    heading: "Let's say!",
    sortOrder: 1,
    numbered: true,
    // 复习课没有知识清单（需求方 2026-10-27 确认）。
    lessonTypes: REGULAR_ONLY,
    sourceSections: ["say"],
    outline: `依次输出三个部分：

### 核心词汇

按大纲列出的目标词汇逐个输出。${VOCAB_CARD}

词条数量与顺序必须与大纲的目标词汇完全一致：大纲里有的词一个不能少，大纲里没有的词一个不能加。

### FCE 重难点派生词表

输出四列表格：

| 名词 | 动词 | 形容词 | 副词 |
| --- | --- | --- | --- |

每一行对应一个核心词族，行数按核心词汇里实际存在的词族确定，缺一个词族就少一行内容，不允许用空行占位。
确认不存在的词形填 \`/\`；无法确认时**留空**，不要写占位文字。不要为了凑齐四列编造词形，也不要输出整行空白的表格行。

### FCE 话题词汇联想

按行输出，每行一个词条，格式为：

\`1. 词条 n./v./adj. 中文释义\`

从 1 开始连续编号，不跳号、不重复；成稿里这一节是编号列表，不是圆点列表。

词条来自该 Lesson 主题的相关话题词汇，不要与核心词汇重复。`,
    status: PLACEHOLDER,
  },
  {
    bookType: "knowledge",
    moduleKey: "lets_read",
    displayName: "Let's read! · 阅读词汇与技能",
    heading: "Let's read!",
    sortOrder: 2,
    numbered: true,
    // 复习课没有知识清单（需求方 2026-10-27 确认）。
    lessonTypes: REGULAR_ONLY,
    sourceSections: ["read"],
    outline: `依次输出两个部分：

### 阅读词汇

用**单列**表格输出，一行一个词条，每行写两段：

| 阅读词汇 |
| --- |
| **词汇 n. 中文释义**<br>该词所在的阅读原句 |

第一段是加粗的词条与中文释义，第二段是它出现的原文原句。
原句必须取自阅读文章原文，不得改写或自造；原句里的该词**不加粗**。
词条取本课阅读里的重难点词汇或短语，约 10 个。

### 阅读技能

先写技能名称，再写一段中文说明（这个技能在考试中如何表现、出题人如何隐藏答案）。
然后用**编号步骤**写解题方法，最后给 2 个实例：

\`\`\`
**<技能名称>**

<一段中文说明>

**<方法名，如「猜词三步法」>**
- **Step 1：** <做法>
- **Step 2：** <做法>
- **Step 3：** <做法>

**例1：<例子的小标题>**
- 生词：<词>
- 怎么猜：<怎么从上下文推出词义>
- 结果：<词义>

**例2：<例子的小标题>**
- 生词：…
- 怎么猜：…
- 结果：…
\`\`\`

这一节**不要输出表格**——成稿是「方法步骤 + 实例」的说明体，技能主题由大纲的考试题型决定。`,
    status: PLACEHOLDER,
  },
  {
    bookType: "knowledge",
    moduleKey: "lets_talk",
    displayName: "Let's talk! · 语法",
    heading: "Let's talk!",
    sortOrder: 3,
    numbered: true,
    // 复习课没有知识清单（需求方 2026-10-27 确认）。
    lessonTypes: REGULAR_ONLY,
    sourceSections: ["talk"],
    outline: `依次输出：

### <语法主题>

先写语法点名称（中英文并列），再用一两句话点出它的作用，然后输出**结构表格**。

表格的列由语法点本身决定，不固定：
- 时态类语法用 \`时态/结构 | 用法 | 例句\`；
- 介词搭配类用 \`动词 + 介词 | 名词 + 介词 | 形容词 + 介词\`；
- 其他语法点按它自己的维度选列（如 \`结构 | 含义 | 例句\`）。

单元格里可以有多项，每项单独一行，不要挤在一行里。

表格行要覆盖大纲该语法点的完整范围。若该语法点有易混处（例如同一个词接不同介词时含义不同），
在表格后再补一段**注意**说明，并给出对照表。`,
    status: PLACEHOLDER,
  },
];

// ---------------------------------------------------------------------------
// 学生用书（Student's Book）
// ---------------------------------------------------------------------------

/**
 * 复习课的小节结构与常规课不同：只有三个模块（say/talk/use）、小节从 `1a` 起、
 * 内容是把**旧版整课复习材料当题源**重排（依据成稿样本 Lesson 15「Fun with review」
 * 与 `规则库导入-学生用书-初拟.md` R-SB-019）。所以 say/talk/use 各带一份
 * `revisionOutline`，常规课的 `outline` 不动。
 */
const STUDENT_MODULES: ModuleOutline[] = [
  {
    bookType: "student",
    moduleKey: "learning_objectives",
    displayName: "课时目标",
    heading: "In this lesson, we will...",
    sortOrder: 0,
    numbered: false,
    lessonTypes: ALL_LESSON_TYPES,
    deterministic: "objectives_lesson_page",
    sourceSections: ["objectives"],
    // 本模块由 buildLessonObjectivesMarkdown 直接生成，不走模型，这里的说明仅作档案。
    outline:
      "确定性映射：常规课四条（主题词汇 / 阅读文章 / 核心语法 / 考试技能训练），复习课三条（复习词汇 / 复习语法 / 练习考试技能）。",
    status: PLACEHOLDER,
  },
  {
    bookType: "student",
    moduleKey: "lets_explore",
    displayName: "Let's explore!",
    heading: "Let's explore!",
    sortOrder: 1,
    numbered: true,
    // 复习课不含本模块。
    lessonTypes: REGULAR_ONLY,
    sourceSections: ["explore"],
    outline: `只输出 1a 一项，没有练习、没有问题、没有答案。

题面为 \`1a Did you know...\`，下面接一段科普前导短文，围绕本课主题引入话题。
短文中要**自然出现本课的全部核心词汇**（大纲「核心词汇」列出的词一个不漏），但不要求加粗。

只写短文本身，不要补充 comprehension 问题或答案。`,
    status: PLACEHOLDER,
  },
  {
    bookType: "student",
    moduleKey: "lets_say",
    displayName: "Let's say!",
    heading: "Let's say!",
    sortOrder: 2,
    numbered: true,
    lessonTypes: ALL_LESSON_TYPES,
    sourceSections: ["say"],
    outline: `依次输出下面几项，小节编号用 \`<模块序号>a\`、\`<模块序号>b\` 的形式（模块序号由系统在正文标题里给出）：

**2a**：一段连贯的英文小短文，**包含本单元的全部核心词汇**。短文里出现的核心词汇用**加粗**呈现。
题面写成“读短文，从上下文猜出这些词的意思”这类要求。

**2b**：根据英文释义和句子上下文，从 word box 中选择单词填空。
word box 用一行列出待选词；题目逐条给出英文释义或带空格的句子。

**〔Develop Your Vocabulary〕**（旧版有该栏目时才输出，没有就整块省略）：
词汇拓展知识块，例如 Words with multiple meanings。放在 2b 与 2c 之间。

**2c**：选用本单元的**标星词**，做原型与派生词的二选一。星号由老师人工标注，不要自行判定哪些词该加星。

出题要求：单词必须考全（本课核心词汇都要考到一遍）、拼写与大小写无误、难度由易到难、不超纲、答案唯一且分布不集中。
全部使用**英式英语**拼写。

只输出正文内容，绝对不要输出答案、参考答案或答案页。`,
    revisionOutline: `复习课的 Let's say! 是小节 \`1a\`–\`1c\` 的**词汇复习**，不写新课文。

**1a** 看图补全单词：给出首尾字母，学生补出中间的字母。
**1b** 按英文释义从词框里选词填空，词框用一行列出待选词。
**1c** 括号内二选一，把句子补完整。

词汇范围是本册前几课的核心词汇，不得超纲。
旧版整课复习材料**只作题源**：题型与题量按上面的结构重排，不得整块平移，
也不得把整课复习材料当成某一课的新内容。
全部使用**英式英语**拼写。只输出正文内容，绝对不要输出答案。`,
    status: PLACEHOLDER,
  },
  {
    bookType: "student",
    moduleKey: "lets_read",
    displayName: "Let's read!",
    heading: "Let's read!",
    sortOrder: 3,
    numbered: true,
    // 复习课不含本模块。
    lessonTypes: REGULAR_ONLY,
    sourceSections: ["read"],
    outline: `依次输出四块，小节号写在题面开头：

**3a** 阅读前导入：1 道讨论题，引导学生预测文章内容。
随后给一个 \`Think about\` 提示框（表格形式），里面列出 3–4 条思考方向。

**3b** 阅读文章：先写文章标题，再写导语（旧版有的话），然后是分段正文。
正文每段前可加粗体段落标签（\`A\`/\`B\`/\`C\`/\`D\`）表示不同人物或部分。
**文章正文必须取自旧版来源原文，不得改写、不得自造。这一块不接题目。**

**SKILLS** 技能框（表格形式）：第一行只写 \`SKILLS\`，第二行写一段英文说明，
讲这个阅读技能怎么用。技能主题必须与本课阅读相关。

**3c** 阅读理解题：把**旧版来源里这一课的阅读题目原样迁移过来**，题型按旧版实际有的来
（单项选择、句子挖空、判断等）。题量按旧版实际数量，**不要为了凑数编造题目**；
旧版这一课没有题目就整块留空，不要写占位文字。

题面以小节号开头（如 \`3a You are going to read...\`）。
题目必须能从原文找到定位，不能靠图片推出。
全部使用**英式英语**拼写。只输出正文内容，绝对不要输出答案。`,
    status: PLACEHOLDER,
  },
  {
    bookType: "student",
    moduleKey: "lets_talk",
    displayName: "Let's talk!",
    heading: "Let's talk!",
    sortOrder: 4,
    numbered: true,
    lessonTypes: ALL_LESSON_TYPES,
    sourceSections: ["talk"],
    outline: `依次输出：

**语法标题**：先给语法点名称（英文 + 中文，如 \`Prepositional Collocations 介词固定搭配\`）。

**结构表格**：用表格列出该语法点的结构。列由语法点本身决定，不固定——
介词搭配类用 \`Verb + Preposition | Noun + Preposition | Adjective + Preposition\`，
时态类用 \`时态 | 用法 | 例句\`。单元格里可以有多项，每项单独一行。

**LOOK 提示框**：若该语法点有需要特别说明的特殊用法，输出一个 \`LOOK\` 提示框——
表格形式，第一行只写 \`LOOK\`，第二行写说明，第三行放对照内容。**放在 4a 之前。**

**4a**：基础语法规则填空或识别题，题面以 \`4a\` 开头。

**4b**：语法巩固题（选词填空、变形等），题面以 \`4b\` 开头。
需要词框的题目用单列表格列出待选词。

**4c**：语法运用题（同义改写、完成句子等），题面以 \`4c\` 开头。

**4d**：（旧版有对应内容时才输出）综合运用题——对话、短文或句子内变形填空。

每个部分的题量在 5 题左右。小题在句首用阿拉伯数字编号。

格式规则：语法点名称**只加粗**；句型**加粗并加斜体**；规则讲解中提到的具体单词加*斜体*；
例句中的目标关键词**加粗**；例句一律**左对齐**。
全部使用**英式英语**拼写。只输出正文内容，绝对不要输出答案。`,
    revisionOutline: `复习课的 Let's talk! 是小节 \`2a\`–\`2c\` 的**语法复习**，不写新的语法讲解。

**2a** 选择正确的形式把句子补完整（括号内二选一或三选一）。
**2b** 单项选择（A/B/C），考语法辨析。
**2c** 用词框里单词的正确形式完成句子。

覆盖本册前几课的核心语法点，难度不超过对应的常规课。
旧版整课复习材料**只作题源**：题型与题量按上面的结构重排，不得整块平移。
格式规则同常规课：语法点名称**只加粗**、句型**加粗并加斜体**、例句一律**左对齐**。
全部使用**英式英语**拼写。只输出正文内容，绝对不要输出答案。`,
    status: PLACEHOLDER,
  },
  {
    bookType: "student",
    moduleKey: "lets_use",
    displayName: "Let's use!",
    heading: "Let's use!",
    sortOrder: 5,
    numbered: true,
    lessonTypes: ALL_LESSON_TYPES,
    sourceSections: ["use"],
    outline: `依次输出：

**页眉**：一行 \`Cambridge English Qualification | <考试名称>\`。

**Exam tip**：该题型**在本书内首次出现时**才提供说明；已经出现过的题型直接省略这一块。

**题型框**：一行 \`<考试名称> <Paper 名称> Part N\`。

**5a（以及必要时 5b、5c）**：该题型的实战题目——FCE 真题或模拟题，按该题型的官方体例排版。
听力、阅读与语用模块的题量在 5 题左右。
难度保持在 **B1**，不得过难；题型取自大纲「考试技能」列，不得自行替换。

全部使用**英式英语**拼写。只输出正文内容，绝对不要输出答案。`,
    revisionOutline: `复习课的 Let's use! 是小节 \`3a\`–\`3e\` 的**考试技能实战**，小节数量可按题源调整。

**直接从 \`3a\` 写起**：复习课不写 Cambridge 页眉、不写题型框、也不写 Exam tip
（成稿样本 Lesson 15 的复习课就是这样，题型此前都出现过）。

**3a 起**：按该题型的官方体例输出题目。复习课通常一次覆盖多项技能，
听力、阅读、语用、写作各按自己的体例（听力满足 "write one word or a number" 的要求；
阅读用四选一或句子填空；写作给出任务要求与要点）。
题量在 5 题左右，难度保持 **B1**，不得过难。

本课大纲没有单列考试技能，**题型以旧版题源里实际有的备考练习为准**，不得自行替换或编造。
旧版整课复习材料**只作题源**：按上面的结构重排，不得整块平移。
全部使用**英式英语**拼写。只输出正文内容，绝对不要输出答案。`,
    status: PLACEHOLDER,
  },
];

// ---------------------------------------------------------------------------
// 练习册（Workbook）
// ---------------------------------------------------------------------------

/**
 * 练习册一课的板块是 `Day 1`–`Day 5`，不是 `Let's X!`。
 *
 * 层级是四层：`Day N` → `Let's xxx!` → 大题（阿拉伯数字，**每个 Day 从 1 重新计数**）
 * → 小题。练习册**没有** `Let's explore!`；Day1–3 是词汇与语法的滚动训练（每天各 1–2 题，
 * 难度逐天提高），Day4 只做阅读，Day5 对应 `Let's use!`。
 *
 * 依据：`26教材list-5A.xlsx` 的「练习册」审校工作表 + 新版成稿样例
 * （`新版内容/Lesson 13  An open mind练习册在线文档.docx`）。
 *
 * 核心约束（审校清单原文）："练习册的所有题目是基于学生用书，其考点需与学生用书一一对应，
 * 且考点不能超纲学生用书，题型与学生用书基本保持一致"——所以它除了旧版练习册，
 * 还要参考已确认的学生用书（由生成管线的"同一 Lesson 的其他已确认内容"提供）。
 */
const WORKBOOK_MODULES: ModuleOutline[] = [
  {
    bookType: "workbook",
    moduleKey: "day_1",
    displayName: "Day 1",
    heading: "Day 1",
    sortOrder: 1,
    // 练习册的编号就是 Day 本身，不额外加「1.」前缀。
    numbered: false,
    lessonTypes: ALL_LESSON_TYPES,
    sourceSections: ["say", "talk"],
    // 复习课的题源是旧版**整课复习材料**（`revision`）：它没有 `Hello X` 栏目名，
    // 只有 ①–⑤ 编号题，所以解析器不判题型，由下面的 revisionOutline 交给模型分。
    revisionSourceSections: ["revision"],
    revisionOutline: `复习课的 Day 1 是**词汇与语法的滚动复习**，来源是旧版整课复习材料。

本 Day 输出两个板块，顺序固定：先 \`## Let's say!\`（词汇复习），再 \`## Let's talk!\`（语法复习）。

\`## Let's say!\`

把来源里的**词汇题**按原样迁移过来（补全拼写 / 根据定义选词 / 选词填空 / 二选一等），
数量按旧版实际，不要增删。

\`## Let's talk!\`

把来源里的**语法题**按原样迁移过来（判断题 / 情景选择题 / 二选一 / 选词填空 / 改错等），
数量按旧版实际，不要增删。

大题的编号用阿拉伯数字，**本 Day 从 1 开始连续编号**（词汇题在前，语法题接续）。
**词框按旧版原样保留行列排布**：旧版是几行几列就写几行几列，不要把多行压成一行。

来源是**整课复习材料**，只取词汇与语法部分；写作任务属于 Day 5，不要放进本 Day，也不要重复。
保持旧版原有的难度，不要为了制造梯度而改写题目。`,
    outline: `本 Day 输出两个板块，顺序固定：先 \`## Let's say!\`（词汇），再 \`## Let's talk!\`（语法）。

\`## Let's say!\`

把旧版来源里这一天的词汇题**原样迁移过来**，数量按旧版实际，不要增删。考点覆盖本课的核心词汇。
按难度选取题型：用词框里的词补全句子 / 根据英文释义猜词 / 根据下划线的定义选择替换词 /
情景选择题 / 选词填空（词形不变）/ 括号内二选一（与学生用书 2c 同型）。

\`## Let's talk!\`

把旧版来源里这一天的语法题**原样迁移过来**，数量按旧版实际，不要增删。考点覆盖本课的语法点。
常见题型：判断题 / 情景选择题 / 括号内二选一 / 选词填空 / 改错。

大题的编号用阿拉伯数字，**本 Day 从 1 开始连续编号**（词汇题在前，语法题接续）。
**词框按旧版原样保留行列排布**：旧版是几行几列就写几行几列，不要把多行压成一行——实测旧版一个词框是 3 行 6 列，压成一行会变成 16 列的错表。

保持旧版原有的难度梯度，不要为了制造梯度而改写题目。`,
    status: PLACEHOLDER,
  },
  {
    bookType: "workbook",
    moduleKey: "day_2",
    displayName: "Day 2",
    heading: "Day 2",
    sortOrder: 2,
    numbered: false,
    lessonTypes: ALL_LESSON_TYPES,
    sourceSections: [],
    outline: `**旧版这一课通常没有 Day 2 的独立内容。** 旧版练习册一课只有一组
「词汇 + 语法」（对应新版 Day 1–3），已完整迁移到 Day 1；新版把内容铺成三天是**扩充**。
所以本 Day 通常没有旧版来源，留空即可，由教研后续用修改建议功能补充。

若旧版来源里确实还有未迁移的词汇或语法题，按下面的结构输出：

\`## Let's say!\`（词汇，1–2 题）

\`## Let's talk!\`（语法，1–2 题）

大题的编号用阿拉伯数字，**本 Day 从 1 开始连续编号**。
**词框按旧版原样保留行列排布**：旧版是几行几列就写几行几列，不要把多行压成一行——实测旧版一个词框是 3 行 6 列，压成一行会变成 16 列的错表。`,
    status: PLACEHOLDER,
  },
  {
    bookType: "workbook",
    moduleKey: "day_3",
    displayName: "Day 3",
    heading: "Day 3",
    sortOrder: 3,
    numbered: false,
    lessonTypes: ALL_LESSON_TYPES,
    sourceSections: [],
    outline: `**旧版这一课通常没有 Day 3 的独立内容。** 旧版练习册一课只有一组
「词汇 + 语法」（对应新版 Day 1–3），已完整迁移到 Day 1；新版把内容铺成三天是**扩充**。
所以本 Day 通常没有旧版来源，留空即可，由教研后续用修改建议功能补充。

若旧版来源里确实还有未迁移的词汇或语法题，按下面的结构输出：

\`## Let's say!\`（词汇，1–2 题）

\`## Let's talk!\`（语法，1–2 题）

大题的编号用阿拉伯数字，**本 Day 从 1 开始连续编号**。
**词框按旧版原样保留行列排布**：旧版是几行几列就写几行几列，不要把多行压成一行——实测旧版一个词框是 3 行 6 列，压成一行会变成 16 列的错表。`,
    status: PLACEHOLDER,
  },
  {
    bookType: "workbook",
    moduleKey: "day_4",
    displayName: "Day 4",
    heading: "Day 4",
    sortOrder: 4,
    numbered: false,
    lessonTypes: ALL_LESSON_TYPES,
    sourceSections: ["read"],
    outline: `本 Day 只输出一个板块 \`## Let's read!\`，对应学生用书的 Let's read!。

先写阅读文章：文章标题单独一行，再写正文。**文章必须取自旧版来源原文，不得改写、不得自造。**
文章之后写题目。

题型与学生用书保持一致（如四选一人物匹配、单项选择、句子挖空），主题相关。
题目的答案必须能从文章原文定位，不能靠图片推出；出题顺序与文段出现顺序一致。

大题用阿拉伯数字从 1 编号；小题在句首用阿拉伯数字连续编号。
对话气泡内容与人物一一对应，顺序自上而下、自左而右。`,
    status: PLACEHOLDER,
  },
  {
    bookType: "workbook",
    moduleKey: "day_5",
    displayName: "Day 5",
    heading: "Day 5",
    sortOrder: 5,
    numbered: false,
    lessonTypes: ALL_LESSON_TYPES,
    sourceSections: ["use"],
    revisionSourceSections: ["revision"],
    revisionOutline: `复习课的 Day 5 是**写作与考试技能的复习**，来源是旧版整课复习材料。

本 Day 只输出一个板块 \`## Let's use!\`，对应学生用书的 Let's use!。
只取来源里的**写作任务**（题目要求、要点、检查项），按旧版原样迁移过来；
来源里没有听力题就整块省略，**不要编造**。

若为写作：给出题目要求与要点，题量按旧版实际。
来源是**整课复习材料**，不要重复词汇与语法题——那些属于 Day 1。
全部使用**英式英语**拼写。只输出正文内容，绝对不要输出答案。`,
    outline: `本 Day 只输出一个板块 \`## Let's use!\`，对应学生用书的 Let's use!。

按本课的考试题型输出 1–2 道大题：
- 若为**听力**：满足 "write one word or a number" 的要求；
- 若为**阅读/语用**：按该题型的官方体例（如四选一完形填空）；
- 若为**写作**：给出题目要求与要点。

大题用阿拉伯数字从 1 编号，小题在句首用阿拉伯数字连续编号。
难度不得过难；题型取自大纲「考试技能」列，不得自行替换。`,
    status: PLACEHOLDER,
  },
];

/** 出厂默认模块目录。顺序：知识清单、学生用书、练习册，各自按 sortOrder。 */
export const MODULE_DIRECTORY: readonly ModuleOutline[] = [
  ...KNOWLEDGE_MODULES,
  ...STUDENT_MODULES,
  ...WORKBOOK_MODULES,
];

/** 目录项的稳定键。书种 + 模块标识才唯一。 */
export function directoryKey(bookType: BookType, moduleKey: string): string {
  return `${bookType}:${moduleKey}`;
}

const BY_KEY = new Map(MODULE_DIRECTORY.map((item) => [directoryKey(item.bookType, item.moduleKey), item]));

/** 查出厂默认骨架；没有就返回 null（由调用方决定是报错还是用数据库覆盖）。 */
export function findModuleOutline(bookType: BookType, moduleKey: string): ModuleOutline | null {
  return BY_KEY.get(directoryKey(bookType, moduleKey)) ?? null;
}

/**
 * 某个书种、某个课型下的模块，按 sortOrder 排好。
 * 复习课自动少掉 explore/read——由 lessonTypes 决定，不在调用处写死。
 */
export function modulesFor(
  bookType: BookType,
  lessonType: LessonType = "regular",
): ModuleOutline[] {
  return MODULE_DIRECTORY
    .filter((item) => item.bookType === bookType && item.lessonTypes.includes(lessonType))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * 模块在整课里的编号：按同书种内**参与编号的模块顺序**从 1 开始。
 * 常规课的学生用书是 explore=1 … use=5；复习课没有 explore/read，于是 say=1、talk=2、use=3。
 */
export function ordinalOf(
  bookType: BookType,
  moduleKey: string,
  lessonType: LessonType = "regular",
): number | null {
  const numbered = modulesFor(bookType, lessonType).filter((item) => item.numbered);
  const index = numbered.findIndex((item) => item.moduleKey === moduleKey);
  return index >= 0 ? index + 1 : null;
}

// ---------------------------------------------------------------------------
// 数据库目录项 → 可用模块定义
// ---------------------------------------------------------------------------

const LESSON_TYPES: readonly string[] = ["regular", "revision"];
const DETERMINISTIC_BUILDERS: readonly string[] = ["objectives_table", "objectives_lesson_page"];
const SECTION_KEYS: readonly string[] = [
  "objectives", "explore", "say", "read", "talk", "use", "revision",
  // 练习册按 Day 分块，来源粒度也是 Day（见 legacy-markdown 的 LegacySectionKey）
  "day_1", "day_2", "day_3", "day_4", "day_5",
  "notes", "consolidation", "other",
];

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * 把一条数据库目录项解析成可用的模块定义。
 *
 * 合并规则：**数据库 payload 的同名字段覆盖出厂默认**——教研可以不改代码就调整模块与骨架。
 * 两边都没有 `outline` 时**抛错**，绝不静默回退成一段通用说明：
 * 早先就是在查不到骨架时回退成“按知识清单的常规结构输出”，
 * 导致学生用书 5 个模块全部产出结构不受控的稿子且没有任何提示。
 *
 * 返回的 `outline` 是**该课型实际要用的那一份**：复习课优先用 `revisionOutline`，
 * 没写就沿用常规课的那份。调用方因此不必再按课型分支。
 */
export function resolveModuleOutline(
  row: ModuleDefinitionRow,
  lessonType: LessonType = "regular",
): ModuleOutline {
  const fallback = findModuleOutline(row.book_type, row.module_key);
  const payload = row.payload ?? {};

  const payloadOutline = stringOrUndefined(payload.outline);
  const regularOutline = payloadOutline ?? fallback?.outline;
  if (!regularOutline) {
    throw new ModuleDirectoryError(
      `模块 ${row.book_type}:${row.module_key} 没有输出骨架，无法生成；` +
        `请在模块目录的 payload.outline 里补上它的结构说明`,
    );
  }
  const revisionOutline =
    stringOrUndefined(payload.revisionOutline) ?? fallback?.revisionOutline;
  const outline = lessonType === "revision" ? (revisionOutline ?? regularOutline) : regularOutline;

  const declaredDeterministic = stringOrUndefined(payload.deterministic);
  if (declaredDeterministic && !DETERMINISTIC_BUILDERS.includes(declaredDeterministic)) {
    throw new ModuleDirectoryError(
      `模块 ${row.module_key} 的确定性生成器不受支持:${declaredDeterministic}`,
    );
  }

  const declaredSections = Array.isArray(payload.sourceSections)
    ? payload.sourceSections.filter(
        (item): item is LegacySectionKey =>
          typeof item === "string" && SECTION_KEYS.includes(item),
      )
    : undefined;

  const declaredLessonTypes = Array.isArray(payload.lessonTypes)
    ? payload.lessonTypes.filter(
        (item): item is LessonType => typeof item === "string" && LESSON_TYPES.includes(item),
      )
    : undefined;

  const declaredRevisionSections = Array.isArray(payload.revisionSourceSections)
    ? payload.revisionSourceSections.filter(
        (item): item is LegacySectionKey =>
          typeof item === "string" && SECTION_KEYS.includes(item),
      )
    : undefined;

  const sourceSections = declaredSections ?? fallback?.sourceSections ?? [];
  const revisionSections =
    declaredRevisionSections ?? fallback?.revisionSourceSections;

  return {
    bookType: row.book_type,
    moduleKey: row.module_key,
    displayName: row.display_name || fallback?.displayName || row.module_key,
    // heading 允许显式为 null（标题并进表格首行），所以不能用 ?? 吞掉 payload 里的 null。
    heading:
      payload.heading === null
        ? null
        : (stringOrUndefined(payload.heading) ?? fallback?.heading ?? null),
    sortOrder: row.sort_order,
    numbered: typeof payload.numbered === "boolean" ? payload.numbered : (fallback?.numbered ?? false),
    lessonTypes:
      declaredLessonTypes && declaredLessonTypes.length > 0
        ? declaredLessonTypes
        : (fallback?.lessonTypes ?? ["regular", "revision"]),
    deterministic:
      (declaredDeterministic as DeterministicBuilder | undefined) ?? fallback?.deterministic,
    // 与 `outline` 同理：返回的是**该课型实际要用的那一份**题源栏目清单。
    sourceSections:
      lessonType === "revision" ? (revisionSections ?? sourceSections) : sourceSections,
    outline,
    status: stringOrUndefined(payload.status) === "confirmed" ? "confirmed" : "placeholder",
  };
}
