/**
 * 板块表格的识别规则。
 *
 * 成稿对每张表的列宽、对齐、底色和合并方式都不一样，所以渲染和导出前必须先判断
 * “这张表是哪个板块”，而不是套一套统一样式。
 *
 * **判断必须先看表头形状，再看（书种 + 模块）。** 只按 module_key 判断会串味：
 * `lets_say` 在知识清单是词卡 + 派生词表，在学生用书是短文 + word box，表形完全不同。
 * 表头形状能分开的（词卡、学习目标表）本来就与书种无关，优先用形状。
 */

import { isWordCardHeader } from "./word-card.ts";

export type TableTemplate =
  | "word-card"
  | "objectives"
  | "derived"
  | "term-example"
  | "reading-skill"
  | "grammar"
  | "generic";

export type TableContext = {
  bookType?: string;
  moduleKey?: string;
};

export function resolveTableTemplate(context: TableContext, header: string[]): TableTemplate {
  // ---- 先按表头形状判断：这两种与书种无关 ----
  if (isWordCardHeader(header)) return "word-card";
  // 「学习目标」没有表头行，Markdown 里写成一行空单元格。**必须同时看模块**：
  // 旧版网格题转成 Markdown 后同样是空表头（练习册 ①a 是 14 行 4 列），
  // 只看"空表头"会把它当成学习目标表——首行被换成模块标题，第一列被压成 92px 蓝色。
  if (
    context.moduleKey === "learning_objectives" &&
    header.length > 0 &&
    header.every((cell) => !cell.trim())
  ) {
    return "objectives";
  }

  // ---- 形状分不开时，按（书种, 模块）判断 ----
  // 目前这套板块模板只描述知识清单的成稿版式。学生用书的表格（word box、练习题）
  // 形状不同，落到 generic 的等宽普通边框——这是安全默认，不是错误。
  if (context.bookType !== "knowledge") return "generic";

  if (context.moduleKey === "lets_say") return "derived";
  if (context.moduleKey === "lets_talk") return "grammar";
  // lets_read 的阅读词汇是两列（词汇 / 原句），阅读技能是三列。
  if (context.moduleKey === "lets_read") return header.length === 2 ? "term-example" : "reading-skill";
  return "generic";
}
