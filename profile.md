# AI 教材智能迁移与审校平台
## 产品与技术总体方案 V1.0

## 一、项目定位

本项目不应定位为“AI 自动生成教材 Agent”，而应定位为：

**AI 辅助教材迁移、优化、协同制作与审校平台。**

项目核心目标不是从零创作教材，而是：

> 在最大程度保留旧版教材优质内容的前提下，根据新版教材结构和教研规则，将旧版教材自动迁移为新版教材 Draft，并通过剑桥知识库、课程规则和 AI 审校能力提供优化建议，最终由教研人员完成确认。

整个系统遵循最高生产原则：

**Preserve → Adapt → Generate**

即：

1. 可以直接沿用的内容，优先原样迁移；
2. 不符合新版结构或标准的内容，进行必要改写；
3. 只有旧版缺失或明显不能满足新版要求时，才生成新内容。

这也是系统区别于普通 AI 写作工具的核心。

---

# 二、产品最终形态

正式产品采用：

**公司内部 Web 协作平台**

而不是本地个人软件。

开发阶段可以使用本地环境，但正式数据、规则、教材版本和任务状态统一存储在服务端。

原因包括：

- 多位老师会协作制作同一个 Lesson；
- 需要记录每位老师修改过什么；
- AI 生成结果需要保存历史版本；
- 规则需要版本管理；
- 四书之间存在联动；
- 教材存在 Draft / Confirmed / Reviewed / Approved 等正式状态；
- 后续可能推广至整个部门。

因此推荐：

**Browser → Next.js → Backend → PostgreSQL/Supabase → AI Gateway**

初期几人使用时保持单体架构，不提前做复杂微服务。

---

# 三、核心业务对象

系统最重要的业务单位不是 Unit，而是：

**Lesson**

推荐正式层级：

```text
Project
└── Grade
    └── Term / Course
        └── Lesson
            ├── Student Book
            │   ├── Let's explore!
            │   ├── Let's say!
            │   └── Let's read!
            │
            ├── Workbook
            ├── Knowledge List
            └── Vocabulary Book
```

系统的最小生成单位：

**Module**

即老师点击 Let's explore!，一次生成这一完整模块。

不是逐段生成。

---

# 四、四书生产顺序

四书不是完全平级。

确定：

**学生用书为主书。**

推荐生产顺序：

```text
旧版资料
    ↓
学生用书
    ↓
老师修改
    ↓
Confirmed
    ↓
Lesson Context
    ↓
其余三书
    ↓
四书完成
    ↓
整课审校
```

因此：

### 第一阶段

先制作 Student Book。

### 第二阶段

Student Book 确认后，系统提取：

- Theme
- Core Vocabulary
- Grammar

生成：

**Lesson Context**

### 第三阶段

老师进行一次轻量确认。

之后其他三书生成时：

必须同时参考：

1. 旧版对应书稿；
2. Lesson Context；
3. 已确认学生用书；
4. 当前模块规则；
5. 全局规则。

这样可以显著降低“四本书各写各的”的问题。

---

# 五、Lesson Context：四书共享事实源

Lesson Context 是整个系统最重要的数据对象之一。

例如：

```text
Lesson:
L3 Winter Lesson 04

Theme:
At the Zoo

Core Vocabulary:
lion
tiger
elephant
giraffe

Grammar:
What is it?
It's a ...

Confirmed by:
Teacher A

Version:
3
```

四书需要保持一致的内容目前包括：

- Theme
- Core Vocabulary
- Grammar

未来可以扩展：

- phonics
- communicative functions
- cultural points
- learning objectives
- Cambridge mapping

Lesson Context 的优先级必须高于普通教材内容。

即：

```text
人工确认
>
Lesson Context
>
项目/课程规则
>
模块规则
>
旧版教材
>
剑桥参考资料
>
模型自身知识
```

AI 不应自行推翻人工确认内容。

---

# 六、旧版教材知识库不能直接做普通 RAG

旧教材主要为：

- 扫描 PDF
- 图片
- 表格
- 文本框
- 教材排版

因此不应采用：

```text
PDF → OCR → Chunk → Embedding → RAG
```

然后每次生成教材都让 AI 猜应该找哪一块。

教材本身具有高度结构化关系。

推荐采用：

# Structured Retrieval + RAG

两个系统分别承担不同任务。

---

# 七、旧教材结构化加工流水线

建立独立的：

**Knowledge Ingestion / 教材加工后台**

旧教材上传后，只处理一次。

流程：

```text
上传扫描 PDF
        ↓
OCR + Vision
        ↓
页面结构识别
        ↓
Lesson 切分
        ↓
Module 切分
        ↓
文字提取
        ↓
图片提取
        ↓
自动分类
        ↓
人工快速确认
        ↓
发布至知识库
```

例如最终知识库中不是：

```text
PDF 第23页的一段文字
```

而是：

```text
Project: L3 Winter
Lesson: 01
Book: Student Book
Old Module: Hello World

Text:
...

Images:
image_001.png
image_002.png
```

这样正式生产过程中不需要重复 OCR。

---

# 八、图片处理原则

MVP 阶段：

**只负责识别、保存和迁移旧教材图片。**

暂时不要加入 AI 重绘图片。

例如：

旧版：

```text
Hello World
[动物园图片]

Look at the picture...
```

迁移至新版：

```text
Let's explore!

[原动物园图片]

Look at the picture...
```

系统必须维护：

```text
Asset
- asset_id
- source_document
- page
- lesson
- module
- image_url
- relation_to_text
```

这样图片不会在 OCR 过程中丢失。

---

# 九、新旧模块映射不能写死成一对一

已经确认存在：

- 一对一
- 一对多
- 多对一

因此必须单独建立：

**Module Mapping**

例如：

```text
Old:
Hello World
+
Words

        ↓

New:
Let's explore!
```

也可能：

```text
Old:
Reading Time

        ↓

New:
Let's explore!
+
Let's read!
```

数据库中不能简单保存：

```text
old_module_id → new_module_id
```

推荐建立 Mapping 表：

```text
ModuleMapping

id
project_id
source_module_id
target_module_id
mapping_type
priority
notes
```

多条记录共同表达多对多关系。

---

# 十、规则系统设计

现有方案中 `Rules as Data` 的思想应该完整保留。

但规则不能只是 Markdown 文件。

应该升级为：

# Rule = Human-readable Instruction + Machine-readable Constraints

例如：

```text
Rule:
Let's Read Word Count

说明：
Let's read 阅读文本长度应该为 120–150 words。

Structured Constraint:

min_words = 120
max_words = 150
```

原因是：

**程序能够确定的事情，不应该全部交给 AI 判断。**

例如：

适合程序检查：

- 单词数
- 题目数量
- 是否存在答案
- 是否包含核心词汇
- 模块是否完整
- 英式拼写词表匹配
- 格式结构

适合 AI 判断：

- 难度是否合适
- 表达是否自然
- 上下文是否连贯
- 是否符合教学目的
- 题目是否真正检测目标知识

形成：

**Deterministic Check + LLM Review**

双层审校。

---

# 十一、规则作用域

规则至少支持：

```text
Global
Project
Grade
Book
Module
Lesson Override
```

同时把规则分成：

### Hard Rule

不可被下级规则覆盖。

例如：

- 英式英语
- 公司内容安全要求
- 教材红线

### Scoped Rule

允许更具体规则覆盖。

例如：

```text
L3 reading
120 words
```

但：

```text
L5 reading
180 words
```

可以不同。

建议解析逻辑：

```text
Global Hard Rules
        ↓
Lesson Override
        ↓
Module Rules
        ↓
Book Rules
        ↓
Grade Rules
        ↓
Project Defaults
```

最后由 Rule Resolver 为每次任务构建：

**Effective Rule Set**

---

# 十二、规则必须版本化

不能：

```text
编辑 → 保存 → 覆盖
```

必须：

```text
Rule v1
↓
Rule v2
↓
Rule v3
```

状态：

```text
Draft
Published
Deprecated
```

团队即使平权，也不代表可以破坏历史。

任何成员可以：

- 创建新版本；
- 编辑 Draft；
- 发布版本。

但旧版本永久保留。

生成任务必须记录：

```text
rule_id
rule_version
rule_snapshot
```

从而实现历史复现。

原方案已经有记录 `used_rules` 的意识，但正式版必须保存具体版本，而不是只保存规则名称。

---

# 十三、规则更新后的教材处理

规则更新绝不能自动修改已有教材。

例如：

```text
Let's read
生成时：Rule v3

当前：Rule v4
```

界面显示：

```text
⚠ 当前内容基于旧版规则生成

[查看规则变化]
[使用最新版重新检查]
```

老师点击以后：

生成新的 Review 或新的 ModuleVersion。

原稿永不直接覆盖。

---

# 十四、教材迁移生成 Pipeline

老师点击：

**Generate Let's explore!**

后台启动异步任务。

完整过程：

```text
1. Identify
确定 Lesson / Book / Module

        ↓

2. Mapping Resolver
查找旧版 → 新版映射

        ↓

3. Source Retriever
精准取得旧版文字 + 图片

        ↓

4. Context Builder
取得：
Lesson Context
Student Book confirmed content
related modules

        ↓

5. Rule Resolver
取得有效规则集

        ↓

6. Cambridge Retriever
只检索与本模块真正相关的剑桥资料

        ↓

7. Migration Planner
判断：
COPY
ADAPT
GENERATE

        ↓

8. Generator
生成新版模块 Draft

        ↓

9. Validator
进行程序级结构检查

        ↓

10. Save Version
保存 Module Version

        ↓

11. AI Suggestions
生成独立优化建议
```

---

# 十五、AI 迁移不要直接“自由创作”

模型内部应该先生成 Migration Plan。

例如：

```json
{
  "reuse": [
    "paragraph_1",
    "image_2"
  ],
  "adapt": [
    {
      "source": "paragraph_2",
      "reason": "new structure requirement"
    }
  ],
  "generate": [
    {
      "type": "warm_up_question",
      "reason": "missing in old material"
    }
  ]
}
```

然后再正式生成教材。

这样系统更容易遵循：

**Preserve → Adapt → Generate**

而不是拿到旧教材以后全部重新写一遍。

---

# 十六、生成结果要记录内容来源

内部数据应记录：

```text
COPY
ADAPT
GENERATE
```

例如：

```text
Block 01

origin_type:
COPY

source:
old_L3_L01_HelloWorld_p2

rule:
LetsExplore_v4
```

用户前台不一定显示。

后台必须记录。

未来才能统计：

- 多少内容直接迁移；
- 多少内容 AI 改写；
- 多少内容属于新生成。

这也是判断系统价值的重要指标。

---

# 十七、AI 优化与正文必须分离

确定采用：

**正文 + AI 建议旁栏**

而不是模型自动修改正文。

界面：

```text
┌───────────────────┬─────────────────────┐
│                   │ AI Suggestions      │
│                   │                     │
│     教材正文      │ ① 建议修改...       │
│                   │ [接受] [忽略]       │
│                   │                     │
│                   │ ② 建议增加...       │
└───────────────────┴─────────────────────┘
```

AI 建议可能来源于：

- 剑桥要求；
- 新版规则；
- 教材难度；
- 内容质量；
- 四书一致性。

老师点击：

**接受建议**

才修改正文。

---

# 十八、正文编辑器

浏览器中不应该直接使用 DOCX 作为底层编辑格式。

使用：

**Word-like Rich Text Editor**

底层建议：

ProseMirror / Tiptap 类结构化编辑器。

支持：

- 字体
- 字号
- 粗体
- 斜体
- 下划线
- 表格
- 图片
- 列表
- 标题
- 高亮
- 评论
- 撤销
- 重做

数据库保存：

```text
Editor JSON
```

最终：

```text
Editor JSON
↓
DOCX Generator
↓
.docx
```

内容生产团队使用系统制作内容。

随后 DOCX 交给独立排版团队。

---

# 十九、版本机制

AI 重新生成绝不能覆盖原内容。

例如：

```text
Let's explore!

V1 AI Generated

V2 Teacher Edited

V3 AI Regenerated

V4 Teacher Edited
```

系统保存完整历史。

老师可以：

- 查看历史；
- 对比版本；
- 恢复版本。

尤其：

老师修改 V1 后点击重新生成：

**生成 V2，而不是覆盖老师修改稿。**

---

# 二十、Module 状态机

每个 Module：

```text
Draft
↓
Editing
↓
Confirmed
```

Confirmed 代表：

**可以被其他教材作为正式上下文引用。**

如果 Confirmed 后重新编辑：

```text
Confirmed
↓
Modified
```

系统提示：

```text
该模块已发生修改。

可能影响：
Workbook
Knowledge List

[查看关联模块]
```

但不能自动修改其他教材。

---

# 二十一、四书同步策略

确定：

**Suggest，不 Auto Apply。**

例如学生用书：

```text
Vocabulary:
lion
tiger
elephant
```

老师修改：

```text
elephant → giraffe
```

系统检测：

Workbook 中仍然存在 elephant。

显示：

```text
Cross-book consistency suggestion

Student Book:
giraffe

Workbook:
elephant

建议同步。

[查看]
[应用]
[忽略]
```

绝不能直接修改 Workbook。

---

# 二十二、多人协作

MVP 不做 Google Docs 式实时共同编辑。

采用：

**Module Edit Lock**

例如：

```text
Let's read!

王老师正在编辑

[只读查看]
```

王老师保存/退出后释放锁。

后台记录：

```text
locked_by
locked_at
lock_expire_at
```

同时通过 Audit Log 记录：

```text
谁
什么时候
修改了什么
修改前
修改后
```

后期如果确实有需求，再升级实时协作。

---

# 二十三、整课状态机

Lesson 推荐状态：

```text
Not Started
↓
In Production
↓
Student Book Confirmed
↓
Four Books Completed
↓
Reviewing
↓
Human Review
↓
Approved
↓
Archived
```

中文前台可以显示：

```text
未开始
制作中
主书已确认
四书完成
AI审校中
待人工复核
已通过
已归档
```

只有四书全部达到完成状态：

才显示：

**提交审校**

按钮。

这与现有方案中“四书工作包完成后投入整课审校”的业务原则一致。

---

# 二十四、审校不是一个 Prompt，而是一条 Pipeline

不要：

```text
四本教材
↓
“请帮我检查”
↓
LLM
↓
长报告
```

推荐：

```text
四书
↓
Preprocessor
↓
Rule Checks
↓
Cross-book Checks
↓
Cambridge Checks
↓
Language Checks
↓
LLM Review
↓
Finding Aggregator
↓
Human Review
```

原审校 Skill 可以作为这一系统的重要方法来源，但具体新版规则需要后续由专业老师重新确认；现有项目文档也已经明确现有 PET Skill 只能复用方法而不是直接作为新版规则基线。

---

# 二十五、审校 Finding 结构

不要直接保存：

“一篇审校报告”。

每个问题都是独立 Finding：

```text
finding_id

lesson_id

book:
Student Book

module:
Let's read!

location:
Paragraph 3

rule_id:
VocabularyCoverage

severity:
Major

problem:
目标词汇覆盖不足

evidence:
核心词汇 giraffe 未出现

suggestion:
在第二段增加...

replacement_text:
...

confidence:
0.91

status:
Open
```

状态：

```text
Open
Accepted
Rejected
Fixed
Recheck Required
```

这样前端才能实现：

**点击问题 → 定位正文 → 查看证据 → 应用建议。**

---

# 二十六、审校必须允许“不确定”

AI 不允许强制做判断。

推荐：

```text
PASS
FAIL
WARNING
INSUFFICIENT_EVIDENCE
```

尤其涉及：

- 剑桥要求；
- 授权材料；
- 课程标准；
- 信息不完整。

如果资料不足：

必须输出：

**INSUFFICIENT_EVIDENCE**

而不是模型自己猜。

---

# 二十七、知识库需要分层

不要把所有资料扔进一个 Vector Store。

至少分：

### 1. Production Source

旧版公司教材。

用途：

**教材迁移。**

权重极高。

---

### 2. Authoritative Standards

未来确定：

- Cambridge 官方 syllabus
- CEFR
- 官方词表
- 官方考试要求

用途：

**判断规范是否符合。**

---

### 3. Reference Materials

例如：

- 真题
- 教辅
- 公司资料
- 教研资料

用途：

**提供参考。**

不能与官方标准拥有同等权重。

---

# 二十八、数据库核心模型

原来的三张表只能支持 Demo。

正式系统建议至少存在以下核心对象：

```text
users

projects

lessons

books

modules

module_versions

lesson_contexts

source_documents

source_modules

assets

module_mappings

rules

rule_versions

rule_bindings

generation_jobs

suggestions

review_jobs

findings

audit_logs
```

关系简化如下：

```text
Project
  ↓
Lesson
  ↓
Book
  ↓
Module
  ↓
ModuleVersion
```

旁路：

```text
Rule → RuleVersion

SourceDocument
     ↓
SourceModule
     ↓
ModuleMapping
```

以及：

```text
Lesson
↓
LessonContext
```

---

# 二十九、AI 架构

不建议构建一个万能 Agent。

推荐：

```text
Workflow Orchestrator
        │
        ├── Source Retriever
        │
        ├── Context Builder
        │
        ├── Rule Resolver
        │
        ├── Cambridge Retriever
        │
        ├── Migration Planner
        │
        ├── Content Generator
        │
        ├── Suggestion Generator
        │
        └── Review Engine
```

AI 是 Workflow 中的能力节点。

Workflow 才是系统真正的控制者。

这是整个项目最重要的架构原则：

> **LLM 是流水线工人，不是流水线厂长。**

---

# 三十、模型路由

系统虽然可以支持 GPT、GLM 等多个公司 API，但 MVP 不要过早设计复杂自动模型路由。

第一阶段建议：

```text
default_generation_model
default_review_model
vision_model
```

管理员配置。

记录：

```text
provider
model
prompt_version
temperature
token_usage
latency
```

后期才做：

- 成本路由
- fallback
- A/B testing
- 不同任务不同模型

---

# 三十一、前端信息架构

## A. Dashboard

展示：

- 我的 Lesson
- 最近编辑
- 待审校
- 审校完成
- 项目进度

---

## B. Workbench

建议最终采用四区结构：

```text
┌────────┬──────────────────────────────┬───────────────┐
│Lesson  │                              │ AI / Review   │
│Tree    │        Rich Editor           │ Suggestions   │
│        │                              │               │
│        │                              │               │
└────────┴──────────────────────────────┴───────────────┘
```

顶部：

```text
L3 / Winter / Lesson 04
Student Book
Let's read!

Draft / Confirmed
Version 4
```

---

## C. Rules

规则：

```text
Global
Grade
Book
Module
```

显示：

- 当前版本
- Draft
- Published
- Version History
- 谁修改
- 修改时间

---

## D. Knowledge Base

包含：

- Source Materials
- Cambridge Sources
- Processing Status

---

## E. Review Center

展示：

```text
Critical 2
Major 5
Minor 8
Warning 3
```

可以按：

- Book
- Module
- Rule
- Severity

过滤。

---

# 三十二、系统应记录的生产数据

从 MVP 第一天开始记录。

不要求现在立刻制定目标值。

至少记录：

### Time

```text
generation_duration
teacher_edit_duration
review_duration
```

### Reuse

```text
copy_ratio
adapt_ratio
generated_ratio
```

### AI Suggestion

```text
suggestion_count
accepted_count
rejected_count
```

### Review

```text
finding_count
human_confirmed_count
false_positive_count
```

未来可以回答：

> AI 到底帮我们省了多少时间？

而不是：

> 大家感觉挺方便。

---

# 三十三、MVP 范围

第一版绝对不要试图完成整个“AI 教研自动化平台”。

只完成：

# 教材迁移闭环

完整 Demo：

```text
上传并预处理旧版教材
        ↓
建立新旧 Module Mapping
        ↓
配置新版 Rules
        ↓
选择 Lesson
        ↓
生成 Student Book Module
        ↓
人工修改
        ↓
Confirmed
        ↓
生成 Lesson Context
        ↓
制作其他三书
        ↓
四书完成
        ↓
提交 AI Review
        ↓
生成结构化 Findings
        ↓
人工复核
        ↓
Approved
        ↓
DOCX Export
```

做到这个闭环：

MVP 就已经非常有价值。

---

# 三十四、第一阶段暂时不要做

以下功能全部放到第二阶段以后：

- AI 自动修改规则
- 根据老师反馈自动训练
- Multi-Agent 自主讨论
- 实时多人编辑
- 自动换模型
- 自动生成教材图片
- 复杂成本优化
- 全部门复杂权限体系
- AI 自主决定生产流程
- AI 自动修改其他三书

这些都会增加复杂度，却不会决定 MVP 是否成功。

---

# 三十五、推荐技术栈

原方案中的技术选型整体可以保留。

推荐：

### Frontend

```text
Next.js
TypeScript
Tailwind
shadcn/ui
Tiptap / ProseMirror
```

### Backend

MVP 可以继续：

```text
Next.js Server
```

如果未来任务系统越来越复杂：

再独立：

```text
Python FastAPI
```

不建议现在就拆。

### Database

```text
PostgreSQL
Supabase
```

### Storage

```text
Supabase Storage / S3 compatible
```

存：

- PDF
- 图片
- DOCX

### AI

统一做：

```text
AI Gateway
```

业务代码不要直接绑某一家模型。

### Queue

生成和审校都属于异步任务。

早期可以：

```text
Supabase + background worker
```

规模扩大以后：

```text
Redis
+
BullMQ / Celery
```

### Deployment

早期：

```text
Vercel
+
Supabase
+
Worker
```

足够。

---

# 三十六、开发顺序

推荐严格按这个顺序推进。

## Phase 0：规则工程

先不要急着大量 Coding。

完成：

```text
新版教材结构表
模块列表
旧 → 新 Mapping
规则层级
Hard Rules
Module Rules
审校规则
```

如果这一阶段没做清楚：

AI 后面效果不好，不一定是模型问题。

---

## Phase 1：旧教材加工

完成：

```text
PDF Upload
OCR
Vision
Lesson 切分
Module 切分
图片提取
人工确认
```

先处理：

**1 个年级 + 2～3 个 Lesson**

不要一次处理所有教材。

---

## Phase 2：单模块迁移

只做：

```text
Student Book
Let's explore!
```

验证：

```text
旧教材
+
Mapping
+
Rules
↓
新版 Draft
```

这一阶段是整个项目的第一个生死节点。

---

## Phase 3：Editor + Version

加入：

```text
Word-like Editor
Version History
Confirm
Edit Lock
Audit Log
```

---

## Phase 4：Lesson Context

实现：

```text
Student Book Confirmed
↓
AI Extract
↓
Teacher Confirm
↓
Lesson Context
```

---

## Phase 5：四书

扩展到全部四书。

完成：

```text
Cross-book suggestions
```

---

## Phase 6：Review

接入现有审校 Skill。

首先把 Skill 改造成：

**Structured Findings**

然后完成：

```text
Rule Checks
+
LLM Review
+
Cross-book Review
```

---

## Phase 7：DOCX + Pilot

导出 DOCX。

选取：

**10～20 个真实 Lesson**

让老师实际使用。

记录：

- 时间
- AI 修改量
- 建议接受率
- 审校准确率
- 老师反馈

然后才决定后续是否部门级推广。

---

# 三十七、项目最主要的五个风险

## Risk 1：PDF 解析

最大的工程风险可能不是 LLM。

而是：

**扫描教材解析质量。**

如果教材在进入系统前就被错误切分，后续 AI 再强也没有意义。

所以必须设计人工校验环节。

---

## Risk 2：规则不完整

规则工程还没有开始。

这是目前最大的业务风险。

不要用 Prompt 临时补规则。

必须把隐性教研经验显性化。

---

## Risk 3：AI 过度改写

因为项目是迁移，而不是重新创作。

必须通过：

```text
Preserve → Adapt → Generate
```

和 Migration Plan 机制控制。

---

## Risk 4：四书内容漂移

解决：

```text
Student Book
+
Lesson Context
+
Confirmed State
+
Cross-book Suggestions
```

---

## Risk 5：规则更新污染历史

解决：

```text
Rule Version
+
Rule Snapshot
+
Module Version
+
Audit Log
```

---

# 三十八、项目真正的“Agent”应该在哪里

如果以后仍希望加入 Agent，可以放在 Workflow 内部。

例如：

### Migration Agent

负责：

```text
Analyze
↓
COPY / ADAPT / GENERATE
```

### Review Agent

负责：

```text
Rule Interpretation
↓
Evidence
↓
Finding
```

### Knowledge Agent

负责：

```text
Cambridge Retrieval
↓
Evidence Ranking
```

但是不能让它们自己决定：

```text
下一步流程是什么
```

流程仍然由：

**Workflow Orchestrator**

决定。

---

# 三十九、最终产品核心竞争力

这个系统真正有价值的并不是：

“用了 GPT”。

而是逐渐积累出来的：

```text
旧教材结构化库
+
新版教材规则库
+
新旧结构 Mapping
+
Lesson Context
+
专业审校 Rule Set
+
历史教师修改
+
教材生产数据
```

这些才是真正属于公司的数字资产。

模型未来即使从 GPT 换成其他模型：

整个系统仍然成立。

---

# 四十、项目一句话架构

整个系统最终可以概括为：

```text
          ┌─ Cambridge Knowledge
          │
Old Books ┼─ Rule System
          │
          └─ Lesson Context
                  ↓
        Workflow Orchestrator
                  ↓
       AI Migration Pipeline
                  ↓
          Teacher Editing
                  ↓
             Confirmed
                  ↓
          Four-book Package
                  ↓
          Review Pipeline
                  ↓
      Structured Review Findings
                  ↓
           Human Approval
                  ↓
                DOCX
```

---

# 四十一、最终原则

整个项目开发过程中始终坚持六条原则：

### 1.
**确定性优先于智能。**

能够通过 Mapping 确定的事情，不让 AI 猜。

### 2.
**结构化优先于 Prompt。**

能够进入数据库的数据，不只写在 Prompt 中。

### 3.
**规则优先于模型知识。**

业务标准永远由规则和知识库决定。

### 4.
**人工确认优先于 AI。**

老师修改永远拥有最高优先级。

### 5.
**建议优先于自动修改。**

涉及教材内容联动时，默认 Suggest，而不是 Auto Apply。

### 6.
**Workflow 控制 AI，而不是 AI 控制 Workflow。**

这是整个系统保持稳定、可审计和可扩展的根本。