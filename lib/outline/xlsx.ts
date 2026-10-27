import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { parseCellAnnotations, splitLessonCell } from "./annotations.ts";
import { firstExamSkill } from "./exam-skills.ts";
import type {
  OutlineCellLocator,
  OutlineLessonProfile,
  OutlineParseIssue,
  OutlineProfile,
  OutlineWorkbookCell,
  OutlineWorkbookRow,
  ParsedOutlineWorksheet,
} from "./types";

const MAX_FILE_BYTES = 12 * 1024 * 1024;
const MAX_ENTRY_BYTES = 16 * 1024 * 1024;
const MAX_ROWS = 1000;

function xmlDecode(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/giu, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/gu, (_, decimal: string) => String.fromCodePoint(Number(decimal)))
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&amp;/gu, "&");
}

function attr(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, "iu"));
  return match?.[1] == null ? null : xmlDecode(match[1]);
}

function normalizePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.replaceAll("\\", "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

function resolvePath(base: string, target: string): string {
  if (target.startsWith("/")) return normalizePath(target.slice(1));
  return normalizePath(`${base}/${target}`);
}

type ZipEntry = { compression: number; compressedSize: number; uncompressedSize: number; localOffset: number; name: string };

function readUInt32(data: Uint8Array, offset: number): number {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(offset, true);
}

function readUInt16(data: Uint8Array, offset: number): number {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint16(offset, true);
}

function findEndOfCentralDirectory(data: Uint8Array): number {
  const start = Math.max(0, data.length - 65_557);
  for (let offset = data.length - 22; offset >= start; offset -= 1) {
    if (readUInt32(data, offset) === 0x06054b50) return offset;
  }
  throw new Error("XLSX 压缩包缺少目录结束标记");
}

function readZipEntries(data: Uint8Array): Map<string, ZipEntry> {
  const end = findEndOfCentralDirectory(data);
  const count = readUInt16(data, end + 10);
  const directorySize = readUInt32(data, end + 12);
  const directoryOffset = readUInt32(data, end + 16);
  if (directoryOffset + directorySize > data.length) throw new Error("XLSX 压缩包目录越界");
  const entries = new Map<string, ZipEntry>();
  let offset = directoryOffset;
  for (let index = 0; index < count; index += 1) {
    if (readUInt32(data, offset) !== 0x02014b50) throw new Error("XLSX 压缩包目录损坏");
    const compression = readUInt16(data, offset + 10);
    const compressedSize = readUInt32(data, offset + 20);
    const uncompressedSize = readUInt32(data, offset + 24);
    if (uncompressedSize > MAX_ENTRY_BYTES) throw new Error("XLSX 内部文件过大");
    const nameLength = readUInt16(data, offset + 28);
    const extraLength = readUInt16(data, offset + 30);
    const commentLength = readUInt16(data, offset + 32);
    const localOffset = readUInt32(data, offset + 42);
    const name = new TextDecoder().decode(data.slice(offset + 46, offset + 46 + nameLength));
    entries.set(name, { compression, compressedSize, uncompressedSize, localOffset, name });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function readZipEntry(data: Uint8Array, entry: ZipEntry): string {
  if (entry.localOffset + 30 > data.length || readUInt32(data, entry.localOffset) !== 0x04034b50) {
    throw new Error(`XLSX 内部文件定位失败:${entry.name}`);
  }
  const nameLength = readUInt16(data, entry.localOffset + 26);
  const extraLength = readUInt16(data, entry.localOffset + 28);
  const start = entry.localOffset + 30 + nameLength + extraLength;
  const end = start + entry.compressedSize;
  if (end > data.length) throw new Error(`XLSX 内部文件越界:${entry.name}`);
  const compressed = data.slice(start, end);
  let bytes: Uint8Array;
  if (entry.compression === 0) bytes = compressed;
  else if (entry.compression === 8) bytes = inflateRawSync(compressed);
  else throw new Error(`XLSX 使用了不支持的压缩方式:${entry.compression}`);
  if (bytes.length > MAX_ENTRY_BYTES) throw new Error("XLSX 解压后文件过大");
  return new TextDecoder().decode(bytes);
}

function sharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/giu)].map((match) =>
    [...(match[1] ?? "").matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/giu)]
      .map((text) => xmlDecode(text[1] ?? ""))
      .join(""),
  );
}

function cellText(cellXml: string, shared: string[], type: string | null = attr(cellXml, "t")): string {
  if (type === "inlineStr") {
    return [...cellXml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/giu)]
      .map((match) => xmlDecode(match[1] ?? ""))
      .join("");
  }
  const value = cellXml.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/iu)?.[1];
  if (value == null) return "";
  const decoded = xmlDecode(value);
  if (type === "s") {
    const index = Number(decoded);
    return Number.isInteger(index) ? shared[index] ?? "" : "";
  }
  return decoded;
}

function columnNumber(address: string): number {
  const letters = address.match(/^[A-Z]+/iu)?.[0]?.toUpperCase() ?? "";
  let result = 0;
  for (const letter of letters) result = result * 26 + letter.charCodeAt(0) - 64;
  return result;
}

function parseWorksheetXml(xml: string, name: string, shared: string[]): ParsedOutlineWorksheet {
  const rows: OutlineWorkbookRow[] = [];
  for (const rowMatch of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/giu)) {
    const rowTag = rowMatch[1] ?? "";
    const rowNumber = Number(attr(rowTag, "r") ?? rows.length + 1);
    if (!Number.isInteger(rowNumber) || rowNumber <= 0 || rowNumber > MAX_ROWS) continue;
    const cells: OutlineWorkbookCell[] = [];
    // 空单元格写成自闭合的 <c r="D7" s="1"/>；必须单独匹配，
    // 否则 `>…</c>` 会一路吞到下一个有内容的单元格，把它的值记到当前地址上。
    for (const cellMatch of (rowMatch[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/giu)) {
      const cellTag = cellMatch[1] ?? "";
      const body = cellMatch[2] ?? "";
      const address = (attr(cellTag, "r") ?? "").toUpperCase();
      if (!address) continue;
      cells.push({
        sheet: name,
        address,
        row: rowNumber,
        column: columnNumber(address),
        rawText: body ? cellText(body, shared, attr(cellTag, "t")) : "",
      });
    }
    if (cells.length > 0) rows.push({ row: rowNumber, cells });
  }
  return { name, rows };
}

function workbookSheetPath(workbookXml: string, relationshipsXml: string): { name: string; path: string } {
  const sheet = workbookXml.match(/<sheet\b([^>]*)\/>/iu)?.[1];
  if (!sheet) throw new Error("XLSX 没有可读取的工作表");
  const name = attr(sheet, "name") ?? "Sheet1";
  const relationshipId = attr(sheet, "r:id");
  if (!relationshipId) throw new Error("XLSX 工作表缺少关系引用");
  const relationship = [...relationshipsXml.matchAll(/<Relationship\b([^>]*)\/>/giu)]
    .map((match) => match[1] ?? "")
    .find((value) => attr(value, "Id") === relationshipId);
  const target = relationship ? attr(relationship, "Target") : null;
  if (!target) throw new Error("XLSX 工作表关系不存在");
  return { name, path: resolvePath("xl", target) };
}

function textAt(row: OutlineWorkbookRow, column: number): string {
  return row.cells.find((cell) => cell.column === column)?.rawText.trim() ?? "";
}

function headerKey(value: string): string {
  return value.replace(/[\s\n\r()（）]/gu, "").toLocaleLowerCase();
}

function columnMap(header: OutlineWorkbookRow): Map<string, number> {
  const map = new Map<string, number>();
  for (const cell of header.cells) {
    const key = headerKey(cell.rawText);
    if (key) map.set(key, cell.column);
  }
  return map;
}

function findColumn(map: Map<string, number>, candidates: string[]): number | null {
  for (const candidate of candidates) {
    const column = map.get(headerKey(candidate));
    if (column != null) return column;
  }
  return null;
}

function parseLessons(worksheet: ParsedOutlineWorksheet): { headers: string[]; lessons: OutlineLessonProfile[]; issues: OutlineParseIssue[] } {
  const headerRow = worksheet.rows[0];
  if (!headerRow) throw new Error("大纲工作表为空");
  const headers = headerRow.cells.sort((a, b) => a.column - b.column).map((cell) => cell.rawText.trim());
  const columns = columnMap(headerRow);
  const lessonColumn = headerRow.cells[0]?.column ?? 1;
  const issues: OutlineParseIssue[] = [];
  const lessons: OutlineLessonProfile[] = [];
  for (const row of worksheet.rows.slice(1)) {
    const lessonCell = row.cells.find((cell) => cell.column === lessonColumn);
    if (!lessonCell || !lessonCell.rawText.trim()) continue;
    const parsed = splitLessonCell(lessonCell.rawText);
    if (!parsed) continue;
    const locator: OutlineCellLocator = {
      sheet: worksheet.name,
      address: lessonCell.address,
      row: lessonCell.row,
      column: lessonCell.column,
    };
    const rowAnnotations = row.cells.map((cell) => {
      const cellLocator: OutlineCellLocator = {
        sheet: worksheet.name,
        address: cell.address,
        row: cell.row,
        column: cell.column,
      };
      return parseCellAnnotations(cell.rawText, cellLocator);
    });
    const annotations = rowAnnotations.flatMap((result) => result.annotations);
    const mappings = rowAnnotations.flatMap((result) => result.mappings);
    issues.push(...rowAnnotations.flatMap((result) => result.issues));
    const rawValues: Record<string, string> = {};
    for (const cell of row.cells) {
      const header = headers[cell.column - 1] || cell.address;
      rawValues[header] = cell.rawText.trim();
    }
    const value = (keys: string[]) => {
      const column = findColumn(columns, keys);
      return column == null ? null : textAt(row, column) || null;
    };
    const examSkills = value(["考试技能", "技能"]);
    lessons.push({
      lessonNumber: parsed.lessonNumber,
      lessonKey: `lesson_${parsed.lessonNumber}`,
      title: parsed.title,
      targetTitle: parsed.targetTitle,
      sourceCell: locator,
      sourceCellText: lessonCell.rawText,
      rawValues,
      theme: value(["Hello World", "主题", "学习目标"]),
      coreVocabulary: value(["核心词汇", "词汇"]),
      reading: value(["阅读"]),
      useOfEnglish: value(["Use of English", "UseOfEnglish"]),
      readingExamType: value(["阅读考试题型", "阅读题型"]),
      grammar: value(["语法知识点", "语法"]),
      examSkills,
      primaryExamSkill: firstExamSkill(examSkills),
      listening: value(["听力", "Listening"]),
      speaking: value(["口语", "Speaking"]),
      writing: value(["写作", "Writing"]),
      annotations,
      mappings,
    });
  }
  if (lessons.length === 0) {
    issues.push({
      kind: "unsupported_structure",
      message: "没有识别到 Lesson 行，请确认第一列包含 Unit/Lesson 编号和标题",
      sheet: worksheet.name,
      cell: `${worksheet.name}!${headerRow.cells[0]?.address ?? "A1"}`,
      rawText: headerRow.cells[0]?.rawText ?? "",
    });
  }
  return { headers, lessons, issues };
}

export function parseOutlineWorkbook(bytes: Uint8Array, fileName: string, mediaType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"): OutlineProfile {
  if (bytes.byteLength === 0) throw new Error("大纲文件为空");
  if (bytes.byteLength > MAX_FILE_BYTES) throw new Error("大纲文件超过 12 MB 限制");
  const entries = readZipEntries(bytes);
  const workbookXml = readZipEntry(bytes, entries.get("xl/workbook.xml") ?? (() => { throw new Error("XLSX 缺少 workbook.xml"); })());
  const relationshipsXml = readZipEntry(bytes, entries.get("xl/_rels/workbook.xml.rels") ?? (() => { throw new Error("XLSX 缺少 workbook relationships"); })());
  const shared = entries.has("xl/sharedStrings.xml") ? sharedStrings(readZipEntry(bytes, entries.get("xl/sharedStrings.xml")!)) : [];
  const sheet = workbookSheetPath(workbookXml, relationshipsXml);
  const worksheet = parseWorksheetXml(readZipEntry(bytes, entries.get(sheet.path) ?? (() => { throw new Error("XLSX 工作表文件不存在"); })()), sheet.name, shared);
  const parsed = parseLessons(worksheet);
  const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  return {
    source: {
      fileName,
      fileSize: bytes.byteLength,
      mediaType,
      worksheet: worksheet.name,
      outlineVersion: `xlsx:${digest}`,
    },
    headers: parsed.headers,
    lessons: parsed.lessons,
    issues: parsed.issues,
  };
}

export function parseOutlineWorkbookBuffer(buffer: ArrayBuffer, fileName: string, mediaType?: string): OutlineProfile {
  return parseOutlineWorkbook(new Uint8Array(buffer), fileName, mediaType);
}

export const outlineLimits = { maxFileBytes: MAX_FILE_BYTES, maxRows: MAX_ROWS };
