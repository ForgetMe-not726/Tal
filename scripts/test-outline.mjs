import assert from "node:assert/strict";
import { parseCellAnnotations } from "../lib/outline/annotations.ts";
import { parseOutlineWorkbook } from "../lib/outline/xlsx.ts";

const encoder = new TextEncoder();

function xmlEscape(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function inlineCell(address, value) {
  return `<c r="${address}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`;
}

function sharedCell(address, index) {
  return `<c r="${address}" t="s"><v>${index}</v></c>`;
}

function storedZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, value] of entries) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(value);
    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(8, 0, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    locals.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centrals.push(central);
    offset += local.length;
  }
  const directory = concat(centrals);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, directory.length, true);
  endView.setUint32(16, offset, true);
  return concat([...locals, directory, end]);
}

function concat(parts) {
  const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

const workbook = `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" r:id="rId1"/></sheets></workbook>`;
const relationships = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`;
const shared = `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>单元-2.0版本</t></si><si><t>核心词汇</t></si></sst>`;
const worksheet = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
  <row r="1">${sharedCell("A1", 0)}${sharedCell("B1", 1)}${inlineCell("C1", "阅读")} ${inlineCell("D1", "语法知识点")} ${inlineCell("E1", "考试技能")}</row>
  <row r="2">${inlineCell("A2", "Unit 1\nHome truths （变更：source=旧版语法；target=lets_talk；action=ADAPT；status=confirmed；reason=模板调整）")}${inlineCell("B2", "theme")}${inlineCell("C2", "核心词汇数量：14个")}${inlineCell("D2", "被动语态")}${inlineCell("E2", "Reading Part 5")}</row>
  <row r="3">${inlineCell("A3", "Unit 2\nShopping （原Unit 5）")}${inlineCell("B3", "market")}${inlineCell("C3", "核心词汇数量：15个")}</row>
  <row r="4">${inlineCell("A4", "Unit 3\nHome truths")}<c r="B4" s="1"/><c r="C4" s="2"/>${inlineCell("D4", "被动语态")}${inlineCell("E4", "Reading Part 5")}</row>
</sheetData></worksheet>`;

const workbookBytes = storedZip([
  ["xl/workbook.xml", workbook],
  ["xl/_rels/workbook.xml.rels", relationships],
  ["xl/sharedStrings.xml", shared],
  ["xl/worksheets/sheet1.xml", worksheet],
]);

const profile = parseOutlineWorkbook(workbookBytes, "outline.xlsx");
assert.equal(profile.source.fileName, "outline.xlsx");
assert.equal(profile.lessons.length, 3);
// 自闭合空单元格不能吞掉后面单元格的值：B/C 为空时，D 仍应取到 D4 的语法。
const emptyCells = profile.lessons[2];
assert.equal(emptyCells.lessonNumber, 3);
assert.equal(emptyCells.grammar, "被动语态");
assert.equal(emptyCells.examSkills, "Reading Part 5");
assert.equal(emptyCells.coreVocabulary, null);
assert.equal(profile.lessons[0].title, "Home truths");
assert.equal(profile.lessons[0].targetTitle.startsWith("Home truths"), true);
assert.equal(profile.lessons[0].sourceCellText.includes("Unit 1"), true);
assert.equal(profile.lessons[0].grammar, "被动语态");
assert.equal(profile.lessons[0].mappings[0].action, "ADAPT");
assert.equal(profile.lessons[0].mappings[0].status, "confirmed");
assert.equal(profile.lessons[1].mappings[0].status, "pending");
assert.equal(profile.lessons[1].mappings[0].source, "Unit 5");
assert.equal(profile.issues.length, 1);

const malformed = parseCellAnnotations("语法（变更：source=old；target=lets_talk）", {
  sheet: "Sheet1",
  address: "A2",
  row: 2,
  column: 1,
});
assert.equal(malformed.issues.length, 1);
assert.equal(malformed.mappings[0].action, null);

console.log("✓ xlsx outline profile and provenance");
console.log("✓ annotation validation and pending legacy mapping");
console.log("✓ self-closing empty cells do not swallow the next cell");
console.log("大纲导入测试通过:3 项");
