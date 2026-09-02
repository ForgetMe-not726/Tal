# 移交手册(Handover)

> 目标:任何人按本手册可在自己的账号与电脑上完整重建并接管本项目。
> 核心原则:**代码与数据库结构活在 git 仓库里,数据活在 Supabase 云上**——两者移交路径不同,缺一不可。

## 一、资产清单与移交方式

| 资产 | 位置 | 移交方式 |
| --- | --- | --- |
| 代码 / 文档 / 数据库迁移 | GitHub · https://github.com/ForgetMe-not726/Tal | 添加协作者或转移仓库所有权 |
| 数据库(表结构 + 数据) | Supabase 项目(云) | 邀请进 Organization / 转移 Owner;或 `pg_dump` 导出交付 |
| 文件(PDF、图片、DOCX) | Supabase Storage | Storage 单独导出(**不在 pg_dump 范围内**) |
| 密钥(Supabase Key、AI 网关 Key 等) | `.env.local` / Vercel 环境变量 | 密码管理器等安全渠道交付;**移交后轮换全部旧 Key** |
| 部署 | Vercel | Transfer Project 至对方团队,或对方拿代码自行重新部署 |

## 二、新维护者接手步骤

1. 克隆仓库,执行 `npm install`。
2. 复制 `.env.example` 为 `.env.local`,向原维护者索取真实值并填入。
3. 数据库重建(二选一):
   - **接管现有项目**:`npx supabase init`(仅首次,生成 config.toml)→ `npx supabase link --project-ref <项目ref>` → `npx supabase db push` 按 `supabase/migrations/` 顺序建表;
   - **全新项目**:同上;或直接在 Supabase SQL Editor 中按文件名顺序执行 `supabase/migrations/*.sql`,再执行 `supabase/seed.sql`(示例数据,可选)。
4. `npm run dev` 启动,验证首页与工作台可用。
5. 接管 Supabase Organization 与 Vercel 项目所有权(见上表)。

## 三、数据库维护红线

- **所有表结构变更必须通过 `supabase/migrations/` 下的 SQL 迁移文件进入 git**,禁止只在 Supabase 控制台手工改表——否则数据库将无法从仓库重建,移交即断链。
- 全新环境 = `supabase db push` + `seed.sql`,应当能一键得到完整可用的数据库。
- 规则库初始内容见 `seed.sql`(由前端原型中的示例规则迁移而来),真实教研规则由老师通过系统界面录入并版本化。

## 四、密钥清单

见根目录 `.env.example`,各条目含义已注释。真实值通过安全渠道移交,**任何密钥不得提交进 git**(`.gitignore` 已拦截)。

## 五、移交后的安全动作

1. 轮换:Supabase `service_role` key、AI 网关 API Key、Vercel Token。
2. 按需移除原维护者对 Supabase Organization、Vercel、git 仓库的访问。
3. 在 git 仓库更新 `AGENTS.md` 工作记录,注明接管日期与接管人。
