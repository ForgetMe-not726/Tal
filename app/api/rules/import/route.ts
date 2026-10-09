import { NextResponse } from "next/server";
import { importPublishedRulesSafe, RuleServiceError } from "@/lib/rules/service";
import { parseRuleMarkdown, RuleMarkdownImportError } from "@/lib/rules/markdown-import";

export const runtime = "nodejs";
const MAX_RULE_FILE_BYTES = 4 * 1024 * 1024;

/** 上传已确认的规则 Markdown，解析后直接写入 Published。 */
export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new RuleMarkdownImportError("请选择规则 Markdown 文件");
    if (!/\.(md|markdown)$/iu.test(file.name)) throw new RuleMarkdownImportError("规则文件必须是 .md 或 .markdown");
    if (file.size <= 0) throw new RuleMarkdownImportError("规则文件为空");
    if (file.size > MAX_RULE_FILE_BYTES) throw new RuleMarkdownImportError("规则文件不能超过 4 MB");
    const definitions = parseRuleMarkdown(await file.text(), file.name);
    const results = await importPublishedRulesSafe(definitions, file.name);
    return NextResponse.json({
      imported: results.map(({ rule, version, created }) => ({
        ruleId: rule.id,
        ruleKey: rule.rule_key,
        displayName: rule.display_name,
        versionNumber: version.version_number,
        status: version.status,
        created,
      })),
      // 约束字段不认识时提示：这些规则不会拦住内容，别以为配上了就生效。
      warnings: [...new Set(results.flatMap((result) => result.warnings))],
      sourceFile: file.name,
      persistedMode: "current_app_store",
    }, { status: 201 });
  } catch (error) {
    const status = error instanceof RuleMarkdownImportError || error instanceof RuleServiceError ? 400 : 500;
    if (status === 500) console.error("[api/rules/import] POST failed:", error);
    return NextResponse.json({ error: (error as Error).message }, { status });
  }
}
