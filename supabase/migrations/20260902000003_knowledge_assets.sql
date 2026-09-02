-- ============================================================================
-- 0003 · 知识库:knowledge_entries + assets
-- 依据 profile.md 第八(Asset)、二十七(三层知识库)节。
-- 设计要点(工程原则 1:库内容即插即用):
--   layer 三层分层,权重由应用层 Source Retriever / Cambridge Retriever 控制;
--   entry_type 开放枚举,新增内容形态(phonics、交际功能、文化点…)不改表;
--   payload jsonb 承接一切结构化扩展,正式内容敲定前不锁死字段。
-- ============================================================================

create table knowledge_entries (
  id uuid primary key default gen_random_uuid(),
  layer text not null check (layer in (
    'production_source',          -- 旧版公司教材:迁移用,权重最高
    'authoritative_standards',    -- Cambridge 官方大纲 / CEFR / 词表:规范判断
    'reference_materials')),      -- 真题 / 教辅:仅参考,不等权
  entry_type text not null default 'text', -- text / vocab / grammar / phonics / image / syllabus…
  title text not null default '',
  content text not null default '',     -- 正文(旧版原文、大纲条目等)
  payload jsonb not null default '{}',  -- 结构化扩展:词条、释义、CEFR 级别、交际功能等
  -- 可选归属维度:留空即"通用内容",随内容到位逐步填细
  project_id uuid references projects (id) on delete cascade,
  grade text,
  lesson_id uuid references lessons (id) on delete cascade,
  book_type text,
  module_key text,
  source_ref text not null default '',  -- 来源标识,如 old_L3_L01_StudentBook_p2 / cambridge_wordlist_v2026
  created_at timestamptz not null default now()
);
create index knowledge_lookup_idx
  on knowledge_entries (layer, grade, lesson_id, book_type, module_key);

-- 旧教材资产(图片等):OCR/Vision 加工后台(Phase 1)的落库对象(profile.md 八)
create table assets (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null,           -- Supabase Storage 内路径
  source_document text not null default '',
  page int,
  lesson_id uuid references lessons (id) on delete set null,
  module_key text,
  relation_to_text text not null default '',
  created_at timestamptz not null default now()
);
create index assets_lesson_idx on assets (lesson_id, module_key);

alter table knowledge_entries enable row level security;
alter table assets enable row level security;
