/**
 * HTML 审校报告：**固定模板**，模型不能自由编写整页 HTML
 * （`docs/REVIEW-SKILL-INTEGRATION.md` §6）。
 *
 * 安全边界（同一节的硬要求）：教材片段、模型输出、老师备注一律**转义**；
 * 不引用远程资源、不含脚本、不加载外链字体或图片。报告是只读展示物，
 * 删掉可由 `manifest + findings + decisions` 重新生成——**事实源永远是那三份 JSON**。
 */

import { summarize } from "./pipeline.ts";
import type { ReviewFinding, ReviewManifest } from "./types.ts";

/** HTML 转义：报告里所有动态内容都必须过这一道。 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

const STATUS_LABEL: Record<string, string> = {
  pending: "待处理",
  adopt: "已采用",
  ignore: "已忽略",
  recheck: "待复查",
};

const STAGE_LABEL: Record<string, string> = {
  preprocessor: "输入整理",
  rule_checks: "规则检查",
  cross_book: "跨书与大纲检查",
  cambridge: "标准与剑桥依据核对",
  language: "语言检查",
  visual: "人工目视核对",
  llm_review: "模型审校",
  aggregate: "结果汇总",
};

const STAGE_STATUS_LABEL: Record<string, string> = {
  ok: "已执行",
  skipped: "未执行",
  failed: "失败",
};

function formatTime(value: string | undefined): string {
  if (!value) return "—";
  return value.replace("T", " ").slice(0, 16);
}

/**
 * 生成报告 HTML。
 *
 * 模板是写死的：任何字段都只作为**文本**插进预留的位置，不做字符串拼接式的结构生成，
 * 也不允许 Finding 内容影响标签结构。
 */
export function buildReviewReport(manifest: ReviewManifest, findings: ReviewFinding[]): string {
  // 报告内部的数字**只从 findings 推**（人工决定也记在 findings 上），
  // 免得出现"统计表说 3 条、逐条只列出 2 条"这种自相矛盾。
  // `manifest.stats` 是给列表页筛选用的。
  const stats = summarize(findings);
  const byModule = new Map<string, ReviewFinding[]>();
  for (const finding of findings) {
    const key = `${finding.bookType}/${finding.moduleKey}`;
    byModule.set(key, [...(byModule.get(key) ?? []), finding]);
  }

  const findingsHtml = [...byModule.entries()]
    .map(([moduleName, items]) => {
      const rows = items
        .map((finding) => {
          const decision = finding.decision;
          return `<article class="finding">
  <header>
    <span class="rule">${escapeHtml(finding.ruleKey)}</span>
    <span class="stage">${escapeHtml(STAGE_LABEL[finding.stage] ?? finding.stage)}${finding.phase ? `（标准环节 ${escapeHtml(finding.phase)}）` : ""}</span>
    <span class="status">${escapeHtml(STATUS_LABEL[decision?.action ?? "pending"] ?? "待处理")}</span>
  </header>
  <p class="message">${escapeHtml(finding.message)}</p>
  ${finding.anchor.quote ? `<p class="quote">原文：<span>${escapeHtml(finding.anchor.quote)}</span></p>` : ""}
  ${finding.evidence ? `<p class="evidence">依据：${escapeHtml(finding.evidence)}</p>` : ""}
  ${finding.suggestion ? `<p class="suggestion">建议：${escapeHtml(finding.suggestion)}</p>` : ""}
  ${
    finding.insufficientEvidence
      ? `<p class="insufficient">资料不足，未能判定——需人工核对或补充资料。</p>`
      : ""
  }
  ${
    finding.unverified
      ? `<p class="insufficient">没有能在正文里定位到的依据，未经核实——请先核对。</p>`
      : ""
  }
  ${
    decision
      ? `<p class="decision">人工处理：${escapeHtml(STATUS_LABEL[decision.action] ?? decision.action)}${decision.note ? `（${escapeHtml(decision.note)}）` : ""} · ${escapeHtml(formatTime(decision.decidedAt))}</p>`
      : ""
  }
</article>`;
        })
        .join("\n");
      return `<section class="module">
  <h3>${escapeHtml(moduleName)}</h3>
  ${rows || '<p class="empty">没有发现问题。</p>'}
</section>`;
    })
    .join("\n");

  const insufficient = findings.filter((finding) => finding.insufficientEvidence);
  const unfinished = findings.filter((finding) => !finding.decision);

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>审校报告 · Lesson ${escapeHtml(String(manifest.lessonNumber))} ${escapeHtml(manifest.lessonTitle)}</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; padding: 32px 24px; background: #e9edf1; color: #161b20;
         font-family: "PingFang SC", "Microsoft YaHei", system-ui, sans-serif; font-size: 14px; line-height: 1.6; }
  .paper { max-width: 980px; margin: 0 auto; background: #fbf8f1; border-radius: 2px;
           box-shadow: 0 1px 1px rgba(22,27,32,.06), 0 8px 24px rgba(22,27,32,.08); padding: 40px 44px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 28px 0 8px; padding-bottom: 6px; border-bottom: 1px solid #e2e7ec; }
  h3 { font-size: 14px; margin: 20px 0 8px; }
  p { margin: 4px 0; }
  .meta { color: #46505a; font-size: 12px; }
  .notice { margin: 16px 0 0; padding: 10px 12px; border: 1px solid #f97316; border-radius: 6px;
            background: #feefe3; color: #161b20; font-size: 12px; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; }
  th, td { border: 1px solid #e2e7ec; padding: 6px 8px; text-align: left; }
  th { background: #f2f2f2; }
  .finding { border: 1px solid #e2e7ec; border-left-width: 3px; border-radius: 6px; padding: 10px 12px; margin: 10px 0; background: #ffffff; }
  .finding header { display: flex; gap: 8px; font-size: 11px; color: #46505a; }
  .finding .rule { font-weight: 600; }
  .finding .message { font-weight: 500; }
  .finding .quote span, .finding .evidence, .finding .suggestion { font-family: "Songti SC", SimSun, serif; }
  .finding .quote span { background: #fbf8f1; border-bottom: 1px solid #e2e7ec; }
  .finding .insufficient { color: #5b6773; font-size: 12px; }
  .finding .decision { color: #46505a; font-size: 12px; }
  .empty { color: #5b6773; font-size: 12px; }
</style>
</head>
<body>
<div class="paper">
  <h1>审校报告 · Lesson ${escapeHtml(String(manifest.lessonNumber))} ${escapeHtml(manifest.lessonTitle)}</h1>
  <p class="meta">项目 ${escapeHtml(manifest.projectId)} · 范围 ${escapeHtml(manifest.scope === "module" ? "单个模块" : "整本书")} · 生成时间 ${escapeHtml(formatTime(manifest.reportGeneratedAt ?? manifest.updatedAt))}</p>

  <p class="notice">本报告由 AI 辅助审校生成，<strong>必须人工复核</strong>后才能作为修改依据。报告只读；结论以 <code>findings.json</code> 与人工处理记录为准。</p>

  <h2>1. 审校范围与输入版本</h2>
  <table>
    <thead><tr><th>书种</th><th>模块</th><th>版本</th></tr></thead>
    <tbody>
      ${manifest.inputs
        .map(
          (item) =>
            `<tr><td>${escapeHtml(item.bookType)}</td><td>${escapeHtml(item.moduleLabel)}（${escapeHtml(item.moduleKey)}）</td><td>v${escapeHtml(String(item.versionNumber))}</td></tr>`,
        )
        .join("\n")}
    </tbody>
  </table>

  <h2>2. 规则、来源与执行情况</h2>
  <p class="meta">规则目录 ${escapeHtml(manifest.rules.rulesetId ? `${manifest.rules.rulesetId} v${manifest.rules.rulesetVersion}` : "（本项目规则）")} · 审校日期 ${escapeHtml(manifest.rules.reviewDate ?? "—")} · 生效规则 ${escapeHtml(String(manifest.rules.entries.length))} 条 · 解析时间 ${escapeHtml(formatTime(manifest.rules.resolvedAt))} · 模型 ${escapeHtml(manifest.engine ? `${manifest.engine.provider}/${manifest.engine.model}` : "未调用")}</p>
  <p class="meta">规则：${manifest.rules.entries.length > 0 ? escapeHtml(manifest.rules.entries.map((item) => `${item.ruleKey}${item.isHard ? "(红线)" : ""}`).join("、")) : "本次没有生效规则"}</p>
  ${
    manifest.rules.excluded && manifest.rules.excluded.length > 0
      ? `<p class="meta">未执行的约束：${escapeHtml(manifest.rules.excluded.map((item) => `${item.ruleKey}（${item.reason}）`).join("；"))}</p>`
      : ""
  }
  <p class="meta">已确认来源：${manifest.sources.length > 0 ? escapeHtml(manifest.sources.join("、")) : "未引用来源"}</p>
  <table>
    <thead><tr><th>阶段</th><th>状态</th><th>问题数</th><th>说明</th></tr></thead>
    <tbody>
      ${manifest.pipeline
        .map(
          (stage) =>
            `<tr><td>${escapeHtml(STAGE_LABEL[stage.name] ?? stage.name)}</td><td>${escapeHtml(STAGE_STATUS_LABEL[stage.status] ?? stage.status)}</td><td>${escapeHtml(String(stage.findingCount))}</td><td>${escapeHtml(stage.note ?? "—")}</td></tr>`,
        )
        .join("\n")}
    </tbody>
  </table>

  <h2>3. 问题汇总</h2>
  <p class="meta">共 ${escapeHtml(String(stats.total))} 条结论 · 按书种：${escapeHtml(
    Object.entries(stats.byBook)
      .map(([book, count]) => `${book} ${count}`)
      .join(" · ") || "—",
  )}</p>
  <p class="meta">处理状态：待处理 ${escapeHtml(String(stats.byStatus.pending))} · 已采用 ${escapeHtml(String(stats.byStatus.adopt))} · 已忽略 ${escapeHtml(String(stats.byStatus.ignore))} · 待复查 ${escapeHtml(String(stats.byStatus.recheck))}</p>
  <p class="meta">资料不足 ${escapeHtml(String(stats.insufficientEvidence))} 条（需补材料或人工核对，不是教材本身的问题）。</p>

  <h2>4. 逐条问题</h2>
  ${findingsHtml || '<p class="empty">本次审校没有发现问题。</p>'}

  <h2>5. 资料不足与未完成复核</h2>
  ${
    insufficient.length > 0
      ? `<ul>${insufficient.map((finding) => `<li>${escapeHtml(finding.ruleKey)}：${escapeHtml(finding.message)}</li>`).join("")}</ul>`
      : '<p class="empty">没有标记为资料不足的条目。</p>'
  }
  ${
    unfinished.length > 0
      ? `<p class="meta">还有 ${escapeHtml(String(unfinished.length))} 条问题没有人工处理。</p>`
      : '<p class="meta">所有问题都已人工处理。</p>'
  }
</div>
</body>
</html>
`;
}
