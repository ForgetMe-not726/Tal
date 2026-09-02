-- ============================================================================
-- seed.sql · 开发用示例数据(可选执行)
-- 内容说明:规则与知识均为【示例内容】,仅供开发联调,不作为正式教研规则;
-- 正式内容由教研老师通过系统界面录入并版本化(工程原则 1/2)。
-- 固定 UUID 便于幂等重放(on conflict do nothing);界面录入的数据用随机 UUID。
-- 执行方式:Supabase SQL Editor,或 psql -f(需先跑完 migrations 0001-0003)。
-- ============================================================================

-- ---- 示例项目:L3 寒假 ----
insert into projects (id, name, grade, term)
values ('a0000000-0000-4000-8000-000000000001', '小学英语教材迁移试点', 'L3', 'winter')
on conflict do nothing;

insert into lessons (id, project_id, lesson_number, title) values
  ('a0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 1, 'Colours'),
  ('a0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001', 2, 'Animals')
on conflict do nothing;

-- Lesson 1 四书(主书学生用书)
insert into books (id, lesson_id, book_type) values
  ('a0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000002', 'student'),
  ('a0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000002', 'workbook'),
  ('a0000000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-000000000002', 'knowledge'),
  ('a0000000-0000-4000-8000-000000000007', 'a0000000-0000-4000-8000-000000000002', 'vocab')
on conflict do nothing;

-- 学生用书模块清单
insert into modules (id, book_id, module_key, display_name, sort_order) values
  ('a0000000-0000-4000-8000-000000000008', 'a0000000-0000-4000-8000-000000000004', 'lets_explore', 'Let''s explore!', 0),
  ('a0000000-0000-4000-8000-000000000009', 'a0000000-0000-4000-8000-000000000004', 'lets_say', 'Let''s say!', 1),
  ('a0000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-000000000004', 'lets_talk', 'Let''s talk!', 2),
  ('a0000000-0000-4000-8000-00000000000b', 'a0000000-0000-4000-8000-000000000004', 'lets_use', 'Let''s use!', 3)
on conflict do nothing;

-- ---- 示例规则(原型 lib/mock.ts 升格为 v1 Published)----
insert into rules (id, rule_key, display_name, rule_type, is_hard, description) values
  ('b0000000-0000-4000-8000-000000000001', 'structure_primary', '小学教材结构规范', 'generation', false, '定义课时构成与正文篇幅'),
  ('b0000000-0000-4000-8000-000000000002', 'review_noslang', '审校禁用口语化表达', 'review', true, '内容红线:口语缩略与网络用语(Hard Rule)'),
  ('b0000000-0000-4000-8000-000000000003', 'grammar_pacing', '语法点分布与难度梯度', 'generation', false, '每单元新语法点数量与复现间隔'),
  ('b0000000-0000-4000-8000-000000000004', 'knowledge_graph', '知识库召回与引用', 'generation', false, '检索优先级与引用标注要求')
on conflict do nothing;

insert into rule_versions (id, rule_id, version_number, instruction, constraints, status, published_at) values
  ('c0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 1,
   E'# 小学教材结构规范\n\n## 单元结构\n- 每单元含 3 个课时:A 词汇 / B 句型 / C 语篇\n- 每课时正文 60-120 词\n- 语篇须含「语篇结构」与「阅读任务」两节\n\n## 版式\n- 例句使用 > 引用块标注\n- 加粗仅用于重点词汇与核心句型',
   '{"lessons_per_unit": 3, "words_per_lesson_min": 60, "words_per_lesson_max": 120, "reading_sections_required": ["语篇结构", "阅读任务"]}',
   'published', now()),
  ('c0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000002', 1,
   E'# 审校禁用规则\n\n## 禁用表达\n- 口语缩略:gonna / wanna / kinda\n- 网络用语:哈哈 / 666 / 绝绝子\n- 过度主观:超级 / 无敌 / 爆赞\n\n## 替换建议\n- 口语 → 书面表达;缩写 → 全写(does not → doesn''t 除外)',
   '{"banned_words": ["gonna", "wanna", "kinda", "哈哈", "666", "绝绝子", "超级", "无敌", "爆赞"]}',
   'published', now()),
  ('c0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000003', 1,
   E'# 语法难度梯度\n\n## 分布原则\n- 每单元最多 1 个新语法点\n- 语法复现间隔不超过 2 个单元\n\n## 难度梯度\n1. 感知(情境导入)\n2. 归纳(句型表格)\n3. 应用(练习与语篇)',
   '{"max_new_grammar_per_unit": 1, "recurrence_gap_max_units": 2}',
   'published', now()),
  ('c0000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000004', 1,
   E'# 知识库召回策略\n\n## 召回\n- 优先命中同层级、同话题素材\n- 命中分数低于阈值时回退到通用语料\n\n## 引用\n- 引用素材须标注来源与版本号',
   '{"require_source_annotation": true}',
   'published', now())
on conflict do nothing;

-- 四条示例规则均绑定为全局作用域;更细作用域由老师在界面上追加绑定
insert into rule_bindings (rule_id, scope)
select id, 'global' from rules
on conflict do nothing;

-- ---- 示例知识条目(三层各一,内容为占位示例)----
insert into knowledge_entries (id, layer, entry_type, title, content, payload, grade, lesson_id, book_type, source_ref) values
  ('d0000000-0000-4000-8000-000000000001', 'production_source', 'vocab',
   '旧版 L3 寒假 Lesson 1 核心词汇',
   'red 红色的;blue 蓝色的;yellow 黄色的;green 绿色的;colour 颜色',
   '{"words": [{"word": "red", "phonetic": "/red/", "meaning": "红色的"}, {"word": "blue", "phonetic": "/bluː/", "meaning": "蓝色的"}, {"word": "yellow", "phonetic": "/ˈjeləʊ/", "meaning": "黄色的"}, {"word": "green", "phonetic": "/ɡriːn/", "meaning": "绿色的"}]}',
   'L3', 'a0000000-0000-4000-8000-000000000002', 'student', 'old_L3_W01_StudentBook_p2'),
  ('d0000000-0000-4000-8000-000000000002', 'production_source', 'grammar',
   '旧版 L3 寒假 Lesson 1 核心句型',
   'What colour is it? — It''s ...',
   '{"patterns": ["What colour is it?", "It''s + 颜色词."]}',
   'L3', 'a0000000-0000-4000-8000-000000000002', 'student', 'old_L3_W01_StudentBook_p3'),
  ('d0000000-0000-4000-8000-000000000003', 'authoritative_standards', 'syllabus',
   'CEFR Pre-A1 话题词汇:Colours(示例占位)',
   '颜色话题核心词与Can-do描述,正式词表待剑桥资料入库后替换。',
   '{"cefr": "pre-A1", "topic": "colours", "status": "placeholder"}',
   'L3', null, null, 'cambridge_wordlist_placeholder'),
  ('d0000000-0000-4000-8000-000000000004', 'reference_materials', 'text',
   '真题中颜色话题常见题型(示例占位)',
   '看图选择、听音涂色、连一连;正式真题素材待入库后替换。',
   '{"task_types": ["看图选择", "听音涂色", "连一连"], "status": "placeholder"}',
   'L3', null, null, 'company_reference_placeholder')
on conflict (id) do nothing;
