/**
 * 把 OCR 的结构化块重建为带页码标记的 Markdown。
 *
 * 用法：node --experimental-strip-types scripts/build-paged-markdown.mjs <content_list.json> [输出路径]
 *
 * 背景见 `lib/knowledge/ocr-pages.ts`：引擎输出的 `.md` 丢了页眉页脚，
 * 而旧版教材的课号印在页眉里。这个脚本从 `_content_list.json` 重建一份带页码与课号的 Markdown。
 *
 * 这是 OCR 后处理步骤，将来应并入 OCR adapter；在 adapter 落地前先用脚本跑。
 */

import { readFileSync, writeFileSync } from "node:fs";
import { buildPagedMarkdown } from "../lib/knowledge/ocr-pages.ts";

const input = process.argv[2];
if (!input) {
  console.error("用法：build-paged-markdown.mjs <content_list.json> [输出路径]");
  process.exit(1);
}

const blocks = JSON.parse(readFileSync(input, "utf8"));
const markdown = buildPagedMarkdown(blocks);

const output = process.argv[3] ?? input.replace(/_content_list\.json$/, "_paged.md").replace(/\.json$/, "_paged.md");
writeFileSync(output, markdown, "utf8");

const pages = new Set(blocks.map((b) => b.page_idx)).size;
const lessons = [...markdown.matchAll(/^# (.+)$/gm)].map((m) => m[1]);
console.log(`已写出 ${output}`);
console.log(`  块 ${blocks.length} 个、页 ${pages} 页、${markdown.length} 字`);
console.log(`  识别出的课边界：${lessons.join(" | ") || "（无）"}`);
