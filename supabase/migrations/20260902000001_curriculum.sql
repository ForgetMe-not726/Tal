-- ============================================================================
-- 0001 · 业务骨架:Project → Lesson → Book → Module → ModuleVersion
-- 依据 profile.md 第三、十九、二十、二十二节。
-- 所有表启用 RLS 但暂不建策略:MVP 服务端一律走 service_role(绕过 RLS),
-- 接入 Supabase Auth(Phase 3)时再补行级策略。
-- ============================================================================

create table projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  grade text not null check (grade in ('L1', 'L2', 'L3', 'L4', 'L5', 'L6')),
  term text not null,                    -- winter / summer / fullyear
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (name, grade, term)
);

create table lessons (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  lesson_number int not null check (lesson_number > 0),
  title text not null default '',
  -- 整课状态机(profile.md 二十三)
  status text not null default 'not_started' check (status in (
    'not_started', 'in_production', 'student_book_confirmed',
    'four_books_completed', 'reviewing', 'human_review', 'approved', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, lesson_number)
);

create table books (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references lessons (id) on delete cascade,
  book_type text not null check (book_type in ('student', 'workbook', 'knowledge', 'vocab')),
  created_at timestamptz not null default now(),
  unique (lesson_id, book_type)
);

create table modules (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references books (id) on delete cascade,
  module_key text not null,              -- 稳定标识,如 lets_explore;显示名可随项目版本配置
  display_name text not null,
  sort_order int not null default 0,
  -- 模块状态机(profile.md 二十):draft → editing → confirmed;confirmed 后再编辑进入 modified
  status text not null default 'draft' check (status in ('draft', 'editing', 'confirmed', 'modified')),
  created_at timestamptz not null default now(),
  unique (book_id, module_key)
);

create table module_versions (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references modules (id) on delete cascade,
  version_number int not null,
  -- 正文存 Editor JSON(profile.md 十八);迁移期允许 markdown,由 content_format 区分
  content jsonb not null,
  content_format text not null default 'editor_json' check (content_format in ('editor_json', 'markdown')),
  origin_kind text not null default 'ai_generated'
    check (origin_kind in ('ai_generated', 'teacher_edited', 'imported')),
  -- 来源块统计 COPY/ADAPT/GENERATE(profile.md 十六):{"copy":n,"adapt":n,"generate":n}
  origin_summary jsonb not null default '{"copy": 0, "adapt": 0, "generate": 0}',
  created_by text not null default 'system',
  created_at timestamptz not null default now(),
  unique (module_id, version_number)
);
create index module_versions_module_idx on module_versions (module_id, version_number desc);

-- 模块编辑锁(profile.md 二十二):MVP 用乐观锁式的到期锁,不做实时协同
create table module_locks (
  module_id uuid primary key references modules (id) on delete cascade,
  locked_by text not null,
  locked_at timestamptz not null default now(),
  lock_expire_at timestamptz not null
);

alter table projects enable row level security;
alter table lessons enable row level security;
alter table books enable row level security;
alter table modules enable row level security;
alter table module_versions enable row level security;
alter table module_locks enable row level security;
