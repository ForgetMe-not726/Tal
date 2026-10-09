/**
 * 词卡表的结构约定：生成骨架、工作台渲染和 DOCX 导出都按这里的定义识别词卡。
 *
 * 同一个区块里除了词卡，还有 FCE 派生词表、语法表等普通表格，
 * 它们不能被当成词卡处理，所以识别必须逐表进行，而不是按模块整体判断。
 */

/** 词卡表头字段，顺序固定。换模板时改这里。 */
export const VOCAB_CARD_HEADER = ["难度", "词汇", "音标", "词性和含义"] as const;

/**
 * 表头第一列是词卡字段名、且列数与模板一致，才算词卡表。
 * 只看第一列是有意放宽：模板微调表头用词时词卡仍然成立，
 * 而派生词表（表头是 Noun 名词 / 动词 / 形容词 / 副词）不会命中。
 */
export function isWordCardHeader(cells: string[]): boolean {
  return cells.length === VOCAB_CARD_HEADER.length && cells[0]?.trim() === VOCAB_CARD_HEADER[0];
}

/**
 * 是不是词卡的字段行：列数够、且后两列为空。
 * 取值行（难度/词汇/音标/词性和含义四列都有内容）不算。
 */
export function isWordCardFieldRow(row: string[]): boolean {
  return row.length >= VOCAB_CARD_HEADER.length && row.slice(2).every((cell) => !cell.trim());
}

/**
 * 拆「字段名：取值」。
 *
 * 用于兼容早期往返损坏的数据：合并单元格在 DOM 里只有一个单元格，
 * 失焦回写时会被 turndown 还原成 `| 释义：xxx | | | |`，
 * 而不是原来的 `| 释义 | xxx | | |`。两种形状都要能认出来。
 */
export function splitMergedField(text: string): { label: string; value: string } | null {
  const match = /^(.+?)：(.+)$/.exec(text.trim());
  if (!match) return null;
  const label = match[1].trim();
  const value = match[2].trim();
  return label && value ? { label, value } : null;
}

/**
 * 把词卡的字段行读成「字段名 + 取值」；不是字段行返回 null。
 * 两种形状都认，渲染、导出和测试都以这个函数为准。
 */
export function readWordCardField(row: string[]): { label: string; value: string } | null {
  if (!isWordCardFieldRow(row)) return null;
  const label = (row[0] ?? "").trim();
  const value = (row[1] ?? "").trim();
  if (label && value) return { label, value };
  // 取值被并回第一列的老数据。
  return splitMergedField(label);
}
