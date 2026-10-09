# 交付、资源与来源

本文件集中管理 XLSX 输出、视觉资产、来源性质和维护触发。普通审校只需读取与本次任务相关的章节。

## 1. XLSX 报告

默认交付 `<原文件名>-review-report.xlsx`。先生成 UTF-8 JSON，再运行：

```text
python scripts/validate_audit_evidence.py --input <data.json> --require-evidence
python scripts/build_review_workbook.py --input <data.json> --output <report.xlsx> --require-evidence
```

输出已存在时，仅在确认允许覆盖后使用 `--force`。脚本只依赖 Python 3 标准库。新审校必用 precision-v2 及 `--require-evidence`，不能省略标记来回避证据校验。旧载荷兼容只用于历史报告复现，会发出明确警告，不代表达到新版审校深度。显式未知 profile 或有证据但漏写 profile 均拒绝。

### 单文件 JSON

```json
{
  "metadata": {
    "material_type": "学生用书",
    "file_name": "Lesson 9.pdf",
    "lesson": "Lesson 9",
    "review_date": "2026-08-31",
    "audit_profile": "precision-v2",
    "ruleset_id": "pet-material-review",
    "ruleset_version": "1.0.0",
    "version_role": "定稿",
    "summary": "一句话结论"
  },
  "knowledge_map": [{
    "order": 1,
    "structure": "Let's explore!",
    "content": "内容摘要",
    "knowledge": "词汇、语法或功能",
    "task": "题型与技能",
    "difficulty": "B1 核心"
  }],
  "review_items": [{
    "element_id": "P7-2a-sentence-1",
    "source_ids": ["SB09"],
    "rule_ids": ["LANG-001"],
    "order": 1,
    "page": "P7",
    "section": "2a",
    "evidence": "原文使用 color，仅有美式拼写，不符合项目的严格英式英语要求。",
    "checks": [
      {"id": "SB09-03", "text": "题干、句子、选项和答案的拼写、大小写、语法、标点正确。"}
    ],
    "result": "需要修改",
    "suggestion": "将 color 改为 colour。"
  }]
}
```

上例仅示意可见报告字段，省略了下节定义的 `audit_evidence`，不能直接作为完整输入；实际输入必须列出全部叶元素、完整内部证据、所有原子 ID 及两项全书级检查。原子 ID 应由当前 review list 派生，不从示例/历史报告硬抄。

### 软件规则目录与数据接口

`data/review-rules.json` 是供教材全流程软件读取的机器规则目录，`data/review-rules.schema.json` 描述其 JSON 结构。二者与本 Skill 的 Markdown 共同维护：机器目录提供稳定规则 ID、触发条件、检查动作、适用教材/元素、结果判据、所需证据、执行方式和规则依据；Markdown 保留需要解释、裁量和原页视觉判断的完整标准。软件不能只读取 JSON 就跳过对应标准章节。

| 接口字段 | 用途 | 约束 |
| --- | --- | --- |
| `ruleset_id`、`ruleset_version` | 标识本次审校使用的规则版本 | 写入新运行的 `metadata`；保留在软件审校记录中，供历史结果按原版本解释 |
| `rules[].id` | 规则主键 | 在目录内唯一；`review_items[].rule_ids` 只引用此处存在的 ID |
| `rules[].review_list_refs` | 规则与正式源行的导航映射 | 38 个教材源行及两个全书门控均须至少映射一次；不替代 `source_ids`/原子 `checks` |
| `review_items[].source_ids`、`checks[].id` | 对应 review list 源行和原子要求 | 保持现有 precision-v2 校验和完整覆盖规则 |
| `review_items[].rule_ids` | 记录该元素实际应用/触发的规则 | 新软件记录应提供去重数组；按规则目录 ID 关联，不以规则标题或文本模糊匹配 |
| `audit_evidence.candidates[].disposition` | 记录疑点处置 | 与最终元素结论区分；未决候选不得显示为已确认错误，也不得隐去 |

新运行继续使用 `audit_profile="precision-v2"`，并在 `metadata` 写入 `ruleset_id`、`ruleset_version`、`material_type`、`lesson`、`version_role` 和 `review_date`。每个 `review_items` 元素增加 `rule_ids` 数组。软件先存储结构化审校数据，再从同一数据渲染工作台、版本记录及现有三表/七表 XLSX；不改变现有人工可读表头、结果枚举或元素聚合规则，也不新增严重度/置信度字段。

旧 precision-v2 载荷可继续生成历史报告；如果没有规则版本或 `rule_ids`，视为历史兼容数据，不推断或伪造规则关联。新软件运行不应省略规则版本。规则依据链接和专家反馈来源是维护追溯信息，不意味着原始反馈文档属于运行时依赖或每条意见均已采纳。

软件应把候选与裁决分开展示：扫描器/模型命中只生成候选；人工或有证据的程序裁决后，才进入确认、排除或未决状态。最终元素结论仍依照“已确认错误优先于缺证、缺证优先于通过”。规则目录用于导航与一致呈现，不自动代替事实查证、语言分析、答案对抗性求解或逐页视觉检查。

### precision-v2 内部证据（不增加工作表）

每个版本添加 `audit_evidence`，包括以下字段。内部记录用于约束核查深度，决定性发现仍要写入对应报告元素，不能仅藏在 JSON。

| 字段 | 结构与要求 |
| --- | --- |
| `schema_version` | 整数1 |
| `page_count` | 实际物理页数，正整数；不是印刷页码最大值 |
| `inventory` | `{element_id, kind, page, locator, required_dimensions}` 数组；与 review_items 一对一，先对原页登记全部叶元素。每页至少一个可定位元素，空白页也登记 page |
| `records` | `{element_id, dimension, result, evidence}` 数组；每个元素/维度唯一，必需维度不能漏。结论按错误＞缺证＞通过汇总并与报告一致 |
| `visual_passes` | `{page, round, result, evidence}`；每一物理页三轮，page 必须单页如 P1。错误/缺证与该页元素 layout/visual 记录双向闭合，不允许全轮通过吞掉局部版式问题 |
| `candidates` | `{candidate_id, element_id, disposition, evidence}`；所有人工及工具疑点逐一处置，disposition 为 confirmed/dismissed/unresolved。确认必须需要修改，未决不能通过，排除须给原页/语境依据，无候选才用空数组 |
| `anchors` | `{name, status, element_ids, evidence}`；cross_page、word_box、exam_tip 各一次。present 绑定实际元素，absent 使用空数组并说明未适用的观察范围，不虚构实例 |

合法元素类型与最低维度：

| kind | 粒度 | required_dimensions 至少包含 |
| --- | --- | --- |
| word | 一个词条或独立派生表单元 | language、lexical、layout、scope |
| sentence | 一条规则、例句、正文句子 | language、layout |
| question | 一道独立小题，含其全部选项和答案 | language、answer、layout、scope、difficulty |
| task | 一个指令/Exam tip/任务容器 | language、structure、layout |
| page | 一个页面框架 | layout |
| image | 一张图片及其题文绑定 | visual |
| global | 全书汇总，page=全书 | language、facts |
| missing | 不能定位的缺失材料，page=未定位 | scope |

按实际内容增加 facts、difficulty、scope、visual 等适用维度，不能把最低维度当成全部检查。事实句应增加 facts，词汇小题增加 lexical，规则增加 scope，计分的题必须用 question，不得改标 sentence 规避答案检查。可定位页可用 `P2–P3` 或 `P2-P3`；全书/未定位仅对应上述 kind。

维度记录示意：

```json
{"element_id":"p2-entry-3","dimension":"lexical","result":"需要修改","evidence":"词条 friendly 标为 adv；该义项及例句中均为形容词，后缀 -ly 不能证明副词。"}
```

语言 evidence 应覆盖本元素实际词形、词性/义项及句法判断；小题 answer evidence 应给独立答案、各选项/替代答案排除和回填结果。不要把同一句“已检查”填满所有维度。骨架验证拒绝缺元素、缺维度、缺页轮、重复和状态冲突，但不能验证原文件是否漏登记、证据是否真实、词典义项是否理解正确。完稿须再次逐页对照 inventory，不可把全部原子堆在全书行来代替局部审校。

### 可选疑点扫描

`scripts/inspect_language_layout.py` 只读原貌 TXT 或 JSON spans，输出候选，不自动修改材料或判语言正确。输入/输出及 CLI 以 `--help` 为准；粗斜体需输入已解析的有效样式，不能把未给值当 false，也不能只看字体名推断。候选保留原文位置，核对后映射到上述 candidates；不得悄悄删除难以判断的疑点。不同版的候选独立编号/处置。机器扫描不能替代词典义项判断、语法分析、语义上下文和原页三轮。

`material_type` 只允许 `学生用书`、`练习册`、`小超市`、`知识清单`；`result` 只允许 `通过`、`需要修改`、`材料未提供无法核查`。`knowledge_map`和`review_items`不得为空。

`review_items`以教材元素为单位：

- `element_id`：当前版本内唯一的内部元素标识，不显示在 XLSX；同一元素不得换名重复上报。
- `source_ids`：该元素实际应用的 review-list 源行，非空、去重；全部元素合计必须覆盖当前教材类型的所有正式源行。
- `order`：按“页数 → 教材部分 → 页面内元素”的顺序从 1 连续递增，不显示在 XLSX。
- `page`：用 `P1`、`P2`、`P7–P8`；文档级元素写`全书`并排在逐页元素之后；没有决定性材料且无法定位时写`未定位`并放最后。
- `section`：教材页面上的模块、题号或小节，如`Let's talk!`、`2a`；同页同部分必须连续。
- `evidence`：识别教材元素，写原文或可观察事实、结论与决定性依据。任务题优先写明题干实际要求、与各选项合成后的关键结果及最长答案回填结论；视觉问题写明目标教学角色、实际样式或主视觉焦点和对照依据。它是 XLSX 的 C 列`判断和依据`。
- `checks`：该元素适用的详细要求、核查对象和审校维度组成的非空对象数组，每项含由源行和原子序号组成的唯一 `id`（如`SB08-01`）及 `text`。同一元素内不得重复 `id`；所有源行下的原子 ID 合计必须至少出现一次。相同 `text` 在显示时自动去重，不要手工编号；脚本自动合并为同一单元格中的`1. 2. 3.`。
- `GLOBAL-FACTS` 和 `GLOBAL-BRITISH` 是必须出现的全书级检查；它们只能放在覆盖全部源行的`全书`元素中，并在证据中说明每个模块均已扫描。
- `suggestion`：仅写最小修改建议；通过项可写`—`。若涉及句子改写，必须在同一单元格内成对写出完整原句和可直接替换的完整修改句，保留完整标点，使用`原句：…`与`修改后：…`标签；多句逐句编号，不得只写词语、片段或省略号。非句子类建议仍用短句。

同一元素不因触发多个规则而生成多行；不同元素不因错误相同而合并。结果按元素汇总：存在已确认错误时为`需要修改`；没有已确认错误但缺决定性材料时为`材料未提供无法核查`；全部适用核查项有证据通过时才为`通过`。脚本拒绝重复 `element_id`、同页同部分中完全重复的判断、重复核查项、页码倒序、页或部分分组断裂以及 review-list 源行覆盖不足。

事实与时效发现的相应源行写入`source_ids`，对应要求写入`checks`。`evidence`写明待核命题、教材位置、来源机构、来源日期或核查日期及结论；不以无来源的“常识错误”代替证据。时效性结论必须记录本次审校日期。

### 单文件：三张工作表

1. `审校概览`：教材类型、文件名、课次、审校日期、审校元素总数、三类结果统计、总体结论。教材类型只填正式名称；不输出“使用规则”“目标范围”。
2. `知识点地图`：序号、教材结构、内容、知识点、题型与技能、难度。按教材实际模块顺序；语法模块同时写出当课语法点→练习位置→覆盖状态。
3. `逐项审校`：A`页数`、B`教材部分`、C`判断和依据`、D`核查项`、E`核查结果`、F`修改建议`。按页数和教材部分分层排列；同一教材元素只占一行，适用核查项在 D 列单元格内自动编号。

文字使用短句。通过、需要修改和材料不足的教材元素全部保留；不设置严重度或置信度。三表第2行冻结并启用筛选；长文本换行、顶端对齐；三种结果使用克制底色。验收文件可打开、三表顺序正确、元素统计与逐项行数一致，且同一元素的判断与建议没有重复行。

### 双版本比对

只有同时输入同一教材类型、同一课次的`在线文档`和`定稿`时才启用。在线文档文件名必须含`在线文档`且不含`定稿`，定稿文件名必须含`定稿`且不含`在线文档`，两个文件名必须不同；任一条件不满足时不得生成方向性 diff。先分别完成全部审校，再做差异比对；不得以定稿替代在线文档审校，也不得以在线文档的问题推定定稿仍有问题。

对齐顺序：教材模块 → 小标题/题号 → 题干、正文段落、例句、选项、答案、图片文字或版式单元。只忽略提取造成的换行、重复页眉页脚和明确的 OCR 噪声；拼写、标点、大小写、编号、答案、图片和版式变化都保留。页面位置只能辅助对齐，不能作为唯一匹配键。

以`在线文档 → 定稿`为方向，差异表只保留实际差异和无法比对项；不输出逐项一致记录，不计算同步率。每项的`change_types`为非空数组，可组合记录：

- `定稿新增`：只在定稿出现；
- `定稿删除`：只在在线文档出现；
- `内容修改`：文字、题目、答案、图片信息或知识点发生变化；
- `位置移动`：内容实质不变但模块、题号或位置改变；
- `版式变化`：排版、样式或视觉呈现改变；
- `无法比对`：文件缺页、内容不可读或缺少决定性材料。
- `无差异`：完成全量比对且没有实际差异；只能作为差异表唯一一行。

`内容修改`、`位置移动`和`版式变化`可在同一行组合。`定稿新增`、`定稿删除`、`无法比对`和`无差异`各自只能单独出现；不得用空`diff_items`表示无差异或未完成比对。

双版本 JSON：

```json
{
  "mode": "dual",
  "online": {"metadata": {}, "knowledge_map": [], "review_items": []},
  "final": {"metadata": {}, "knowledge_map": [], "review_items": []},
  "diff_items": [{
    "order": 1,
    "module": "Let's talk!",
    "online_location": "在线文档第8页",
    "final_location": "定稿第9页",
    "online_content": "可核对原文或摘要",
    "final_content": "可核对原文或摘要",
    "change_types": ["内容修改", "位置移动"],
    "impact": "规则说明已变化。",
    "suggestion": "确认定稿改动是否为批准版本。"
  }]
}
```

`online`与`final`各自使用完整的单文件 JSON 结构，且`material_type`与`lesson`必须一致。

### 双版本：七张工作表

依次输出：`在线文档-审校概览`、`在线文档-知识点地图`、`在线文档-逐项审校`、`定稿-审校概览`、`定稿-知识点地图`、`定稿-逐项审校`、`版本差异`。两个概览表将完成度写入独立的“版本角色”行，教材类型仍只填写四种正式名称之一。`版本差异`列为：序号、教材模块、在线文档位置、定稿位置、在线文档内容、定稿内容、差异类型、对教学或审校的影响、处理建议。

## 2. 视觉示例

只查看本次教材对应联系表：

| 教材     | 资产                                              | 标签对应源行                                                                                      |
| -------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 学生用书 | `assets/review-list-examples/student-book.jpg`  | 01=SB07，02=SB16，03=SB03，04=SB13，05=SB05，06=SB14，07=SB08，08=SB06，09=SB09，10=SB15，11=SB12 |
| 练习册   | `assets/review-list-examples/workbook.jpg`      | 01=WB07，02=WB09，03=WB06，04=WB03，05=WB04，06=WB05，07=WB10，08=WB11，09=WB08                   |
| 小超市   | `assets/review-list-examples/vocab-builder.jpg` | 01=VS06，02=VS10，03=VS03，04=原表空白行11，05=VS04，06=VS08，07=VS09，08=VS05，09=VS07           |
| 知识清单 | `assets/review-list-examples/parents-book.jpg`  | 01=KL08，02=KL04，03=KL03，04=KL05，05=KL06，06=KL07                                              |

示例只解释同系列构图、位置、层级和体例，不证明语言正确，也不要求照搬主题、人物或颜色。文字要求优先；用户提供的新模板优先于旧示例。图片模糊时不猜字体、字号或色值，记录证据限制。

每一物理页均须完成三轮，逐页逐轮记录 evidence。判错与免责边界统一见 review-standards 第5节：

| round | 观察动作 | 最低证据 |
| --- | --- | --- |
| legibility | 逐页局部放大，查压字、遮挡、低对比、字形、空格、词内断裂、标点及最长答案作答区 | 具体页/题号/引文及观察，保留原始文本与原图对应，不能只记“看过” |
| semantics | 核对样式—语义双向矩阵：应强调的全强调、不应强调的无误标、同词内部无局部异常。核对图片主体、诊断性特征、人物细节与题文答案 | 实际粗斜体/颜色与教学角色、对照元素、图文依据；无可辨认样式或图片时不能判通过 |
| continuity | 同页相邻同角色对照，再逐对比较跨页题组，查背景、容器、编号、标题层级、字体、对齐、换行、孤行及异常留白 | 对照页/元素及是否同一角色，单页也检查内部一致性并说明无跨页部分 |

高风险位置追加高分辨率图检查，不能取代三轮全覆盖。正常自动折行、答案留白、合法不换行空格、标题层级或合理示例区差异不因“离群”自动判错。若原图无法读取或样式信息不足，对应页轮和依赖元素均记录材料不足，不能伪造视觉通过。Cambridge 任务另比较官方题面层级、示例、关键词、题量、动作、答案区和分页，美术模板不能降低官方标准。

## 3. 来源登记

| 内容                             | 依据与性质                                                                         | 用途                                               |
| -------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------- |
| `review-list.md`               | 项目正式 review list；内部规则                                                     | 结构、题型、数量、格式、复现和原子核查覆盖         |
| `review-standards.md` 的 CEFR  | Council of Europe*CEFR Companion Volume* (2020)；官方描述的操作化摘要            | B1/B2 接收、产出、语言和语篇边界                   |
| Cambridge 格式                   | Cambridge 当前格式页、B2 handbook、成绩页；官方事实摘要                            | Part、题数、动作、字数、时间及成绩等级与 CEFR 定位 |
| 难度校准                         | CEFR 描述语与 B1/B2 官方样题；项目规则                                             | 多维任务负荷映射到六类结果                         |
| `data/b1-vocabulary-index.tsv` | Cambridge*B1 Preliminary Vocabulary List*（2023）；离线索引                      | B1 词汇辅助复核，不作白名单                        |
| 英式英语                         | Cambridge Dictionary/Grammar、Oxford Learner's Dictionaries、B2 handbook；项目加严 | 严格英式英语与有效变体判断                         |
| 事实与时效                       | 审校当日的官方/第一方来源；必要时两个独立权威来源                                  | 全部背景知识、现实状态、数值、纪录、图像事实与时效 |
| `grammar-review.md`              | *English Grammar in Use* 5th ed.（Cambridge UP, 2019）；《新版剑桥PET考试语法必备》（2020）；《朗文英语语法》（原版 1988，外研社版）；《外研社英语语法大全》（2016/2021重印）；当前 Cambridge 官方材料 | 语法正确性、教学逻辑、B1/B2考点映射和报告证据索引 |
| 答案唯一性                       | 项目硬约束与命题验证                                                               | 标准答案题逐题对抗性验证                           |
| 视觉资产                         | 原 review list D列；内部证据                                                       | 同系列版式参考，不作语言证据                       |
| 教研员与专业审校反馈             | 维护阶段的内部经验样本，包括 Lesson 9–12 多思路漏检反馈                              | 发现任务闭环、干扰项、视觉语义、交叉引用和微排版漏检机制；具体改法不自动覆盖上位标准 |
| L5-5A 沉淀文档 | 2026-08-31 完整读取正文、4个表格及2张嵌入图的维护输入 | 提炼逐词义项/星标派生、体例角色及微排版规则。时间误写不采纳，样例数量/日程不直接覆盖正式规则，不作为运行时依赖 |
| 2026-10-08 专家审校报告组 | 练习册 3.0、知识清单 3.0、学生用书 2.0 集体审校、学生用书 4.0 反馈及 suggestion.docx；完整读取文本并抽核批注原图 | 校准反馈裁决、替换稿复核、任务语义链、图像诊断性/比例和微排版角色；具体建议按证据裁决，不作为运行时依赖 |
| XLSX 规范                        | 用户确认的交付规则                                                                 | 工作表、字段、顺序和视觉规范                       |

边界：CEFR 没有封闭的级别语法清单或词汇白名单；Grade B 和 Grade C 均为整套 B2 First 考试的 CEFR B2 档位，Grade A 映射 C1，均不是单题难度标签；样题是任务负荷锚点，不是课程大纲或单题等级证明；在线词典是语言核查入口，不等于教学范围。

权威入口：

- CEFR descriptors：https://www.coe.int/en/web/common-european-framework-reference-languages/cefr-descriptors
- Cambridge B1 format：https://www.cambridgeenglish.org/exams-and-tests/qualifications/preliminary/format/
- Cambridge B2 format：https://www.cambridgeenglish.org/exams-and-tests/qualifications/first/format/
- Cambridge results：https://www.cambridgeenglish.org/exams-and-tests/qualifications/results/
- Cambridge Dictionary：https://dictionary.cambridge.org/
- Cambridge Grammar：https://dictionary.cambridge.org/grammar/british-grammar/
- Oxford Learner's Dictionaries：https://www.oxfordlearnersdictionaries.com/

外部来源最后核对：2026-08-20；教研员反馈规则提炼：2026-08-21；专业审校漏检反馈规则提炼：2026-08-27；新增专家报告机制提炼：2026-10-08（不表示外部来源重查）。Cambridge 格式、CEFR 正式版本、项目 review list、英式体例、唯一答案规则或 B1 词表更新时，修改本文件和 `review-standards.md` 并重跑验证。

2026-08-31 定向复核（不表示全部外部来源重查）：

- B1 现行 handbook 的 Reading Part3、Part5 均为四选一，分别5题、6题：[官方 handbook](https://www.cambridgeenglish.org/fr/Images/168150-b1-preliminary-teachers-handbook.pdf)。修正旧摘要中的“三选一”。
- B2 First for Schools Writing Part2 为三个任务中选一，不含 set-text：[更新版 handbook 第26、30印刷页](https://www.cambridgeenglish.org/pl/Images/167792-b2-first-for-schools-handbook.pdf)。部分[官方 format 页面](https://www.cambridgeenglish.org/exams-and-tests/qualifications/first/format/)仍残留“四选一”，本轮按更新 handbook 的任务表、说明和样题相互印证后裁决并保留冲突，不因网页抓取较新就优先。旧变更页已重定向，历史移除日期未作为本次结论依据。
- 情感形容词的 -ed/-ing 区分不是人/物区分：[Cambridge Grammar](https://dictionary.cambridge.org/uk/grammar/british-grammar/-ing-and-ed-adjectives)。
- 英式机构写法可用9am、4.30pm：[Oxford Gazette 格式指南](https://www.ox.ac.uk/about/how-we-are-run/gazette/content-submissions/formats-and-deadlines)。这是机构体例支持，不是全体英式唯一形式；沉淀文档的10.am不采纳。

原子覆盖版本：precision-v2 保留38个源行，2026-08-31 为学生用书134、练习册60、小超市38、知识清单44个源行原子（不含两项全局门控）。维护源和安装副本采用统一规则。旧报告不自动重审或替换；复现旧载荷须使用对应规则快照，不能把旧 ID 无语义校验地映射到新文本。

## 4. 可移植性

Skill 运行时只依赖本目录的四份 Markdown、`data/`（含机器规则目录及结构 schema）、`assets/`、`scripts/` 及用户输入。语法审校按需读取 `grammar-review.md`，不依赖原始语法书。专家反馈原件只在维护阶段提炼规则，不作为运行时依赖或安装包内容。除用户要求外不得读取项目外资料库、原始 review list 工作簿或固定磁盘路径；不得要求 Microsoft Excel、COM 或 PowerShell。每次维护后运行静态验证，并在不含外部资料库的隔离目录生成一次 XLSX。
