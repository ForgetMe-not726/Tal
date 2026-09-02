-- ============================================================================
-- 0002 · 规则系统:rules + rule_versions + rule_bindings
-- 依据 profile.md 第十、十一、十二节:
--   规则 = 人类可读说明(instruction)+ 机器可读约束(constraints)
--   版本化 Draft / Published / Deprecated,旧版本永久保留
--   作用域 Global / Project / Grade / Book / Module / Lesson Override
-- Hard Rule 不可被下级覆盖的判定在应用层 Rule Resolver 执行(见 lib/rules)。
-- ============================================================================

create table rules (
  id uuid primary key default gen_random_uuid(),
  rule_key text not null unique,          -- 稳定标识,如 lets_read_word_count
  display_name text not null,
  rule_type text not null check (rule_type in ('generation', 'review')),
  is_hard boolean not null default false, -- Hard Rule:内容红线,不可覆盖
  description text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table rule_versions (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references rules (id) on delete cascade,
  version_number int not null,
  instruction text not null,              -- 人类可读说明(Markdown),拼入 Prompt
  constraints jsonb not null default '{}', -- 机器可读约束,交 Validator 确定性执行
  status text not null default 'draft' check (status in ('draft', 'published', 'deprecated')),
  created_by text not null default 'system',
  change_note text not null default '',
  created_at timestamptz not null default now(),
  published_at timestamptz,
  unique (rule_id, version_number)
);
create index rule_versions_lookup_idx on rule_versions (rule_id, status);

-- 作用域绑定:一条规则内容可绑定到多个作用域,解析时按
-- lesson > module > book > grade > project > global 的就近优先合并
create table rule_bindings (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references rules (id) on delete cascade,
  scope text not null check (scope in ('global', 'project', 'grade', 'book', 'module', 'lesson')),
  project_id uuid references projects (id) on delete cascade,
  grade text,
  book_type text,
  module_key text,
  lesson_id uuid references lessons (id) on delete cascade,
  created_at timestamptz not null default now(),
  check (
    (scope = 'global')
    or (scope = 'project' and project_id is not null)
    or (scope = 'grade' and grade is not null)
    or (scope = 'book' and book_type is not null)
    or (scope = 'module' and module_key is not null)
    or (scope = 'lesson' and lesson_id is not null)
  )
);
create index rule_bindings_rule_idx on rule_bindings (rule_id);
create index rule_bindings_scope_idx on rule_bindings (scope, grade, book_type, module_key, lesson_id);

alter table rules enable row level security;
alter table rule_versions enable row level security;
alter table rule_bindings enable row level security;
