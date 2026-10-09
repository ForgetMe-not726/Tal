/**
 * 把 OCR 引擎的**结构化块**重建为带页码与课边界的 Markdown。
 *
 * 为什么需要：MinerU 输出的 `<name>.md` 会**丢掉页眉页脚**，而旧版教材的课号
 * （`Unit 1`、`Unit 2`…）恰恰印在那里。实测旧版练习册的 Markdown 里没有任何课级标题，
 * 整本 7 个单元连成一片，按课切分无从下手；而 `<name>_content_list.json` 里
 * 既有 `page_idx`，也有 `header`/`footer` 块——课号在那里。
 *
 * **课边界按「页」判定，不按块的出现位置判定。** 这一点很关键：
 * 页脚 `Unit N` 出现在页面**末尾**，而该单元的内容从页面**开头**就开始了。
 * 若按块的出现位置插入课标题，新单元的第一块会被算进上一个单元
 * （实测：Unit 6 的 `Hello Vocabulary` 因此丢失）。所以先扫出每页属于哪个单元，
 * 再在**单元切换的那一页开头**插入标题。
 *
 * 重建规则：
 * - 每个块按原顺序输出；`text` 块按 `text_level` 转成对应级别的 Markdown 标题；
 * - `table` 块输出它的 HTML（引擎已给 `<table>` 片段）；
 * - `header` / `footer` / `page_number` **不进正文**——它们是版式信息，
 *   只用来判定页码与课号；
 * - 每次换页插入 `<!-- page N -->`，保留页码溯源（profile 要求检索结果能回到原页）；
 * - 图片输出为 `<!-- image: 路径 -->` 注释，保住 provenance 又不污染正文。
 *
 * 本模块只做「结构化块 → Markdown」的转换，不认识任何具体书种；
 * 书种差异由各自的解析器（`legacy-*.ts`）负责。
 */

export type ContentListBlock = {
  type: string;
  page_idx: number;
  text?: string;
  text_level?: number | null;
  table_body?: string;
  img_path?: string;
  /**
   * 引擎把一部分正文区域误判成 `code`（实测旧版知识清单的语法例句块就是这种），
   * 内容在 `code_body` 里。不输出就会**整块丢内容**。
   */
  code_body?: string;
};

export type BuildPagedOptions = {
  /** 是否插入 `<!-- page N -->` 标记。默认插。 */
  pageMarkers?: boolean;
  /**
   * 从页眉/页脚文字里取出课号。默认认 `Unit 1`、`Lesson 1`、`第1讲`；
   * 也接受页脚常见的「页码.课号」粘连写法（`44.Unit 5`）。
   * 返回 null 表示这块不指示课号。
   */
  lessonNumberOf?: (text: string) => number | null;
};

const DEFAULT_LESSON_NUMBER = (text: string): number | null => {
  const match = /(?:unit|lesson)\s*(\d+)|第\s*(\d+)\s*讲/i.exec(text);
  if (!match) return null;
  const digits = match[1] ?? match[2];
  return digits ? Number(digits) : null;
};

function headingPrefix(level: number | null | undefined): string {
  if (typeof level !== "number" || level < 1) return "";
  return `${"#".repeat(Math.min(level, 6))} `;
}

/** 每页属于哪个课：从该页的页眉/页脚里找课号。 */
function pageLessonMap(
  blocks: ContentListBlock[],
  lessonNumberOf: (text: string) => number | null,
): Map<number, number> {
  const map = new Map<number, number>();
  for (const block of blocks) {
    if (block.type !== "header" && block.type !== "footer") continue;
    const number = lessonNumberOf(block.text ?? "");
    if (number != null) map.set(block.page_idx, number);
  }
  return map;
}

export function buildPagedMarkdown(
  blocks: ContentListBlock[],
  options: BuildPagedOptions = {},
): string {
  const pageMarkers = options.pageMarkers ?? true;
  const lessonNumberOf = options.lessonNumberOf ?? DEFAULT_LESSON_NUMBER;
  const lessons = pageLessonMap(blocks, lessonNumberOf);

  const lines: string[] = [];
  let currentPage = -1;
  let currentLesson: number | null = null;

  // 正文**自己**用标题声明课号的页：`课号 → 最早出现的页`。
  //
  // 页脚上的课号是"补救"用的，而有的册次正文里本来就写着 `# UNIT1 Fond memories`。
  // 两者都认就会同一讲出现两个课边界、被切成两个包，取来源时只拿到前半截
  // （实测学生用书因此变成 13 个包而不是 7 个）。
  //
  // 判据是**位置**而不是"有没有"：只有当正文的声明出现在页脚指示的开头**之前或同一页**时，
  // 才认为它就是这一讲的标题、不必再补。实测练习册的 `Unit 7 Revision unt / Revision`
  // 是一行残缺的版式文字、出现在**最后**一页，若按"有没有"判断就会把整讲的边界推到文末。
  //
  // 只认**标题**（`text_level >= 1`）：正文段落里提到 "Unit 1" 不算声明。
  const declaredPage = new Map<number, number>();
  for (const block of blocks) {
    if (block.type !== "text" || !block.text) continue;
    if (typeof block.text_level !== "number" || block.text_level < 1) continue;
    const number = lessonNumberOf(block.text);
    if (number == null) continue;
    const seen = declaredPage.get(number);
    if (seen == null || block.page_idx < seen) declaredPage.set(number, block.page_idx);
  }

  for (const block of blocks) {
    if (block.page_idx !== currentPage) {
      currentPage = block.page_idx;
      if (pageMarkers) lines.push(`<!-- page ${currentPage} -->`);
      // 单元切换时在**这一页的开头**插课标题——页脚上的课号指的是本页，不是上一页。
      const lesson = lessons.get(currentPage);
      const declared = lesson != null && (declaredPage.get(lesson) ?? Number.POSITIVE_INFINITY) <= currentPage;
      if (lesson != null && lesson !== currentLesson && !declared) {
        currentLesson = lesson;
        lines.push(`# Unit ${lesson}`);
      }
    }

    // 页眉页脚是版式信息，已用于判定页码与课号，不进正文。
    if (block.type === "header" || block.type === "footer" || block.type === "page_number") continue;

    const text = (block.text ?? "").trim();

    if (block.type === "image" || block.type === "chart") {
      if (block.img_path) lines.push(`<!-- image: ${block.img_path} -->`);
      continue;
    }

    if (block.type === "table") {
      if (block.table_body?.trim()) lines.push(block.table_body.trim());
      continue;
    }

    if (block.type === "text" && text) {
      lines.push(`${headingPrefix(block.text_level)}${text}`);
      continue;
    }

    // `code` 是引擎的误判：实测旧版知识清单的语法例句区域被标成 `code`，
    // 内容在 `code_body` 里。按普通正文输出，否则整块例句会消失。
    if (block.type === "code") {
      const body = (block.code_body ?? block.text ?? "").trim();
      if (body) lines.push(body);
    }
  }

  return `${lines.join("\n\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}
