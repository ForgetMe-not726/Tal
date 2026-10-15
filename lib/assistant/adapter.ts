/**
 * 检索 adapter（`docs/AI-ASSISTANT-RETRIEVAL.md` §4）。
 *
 * **这一层就是为了将来被换掉**：本地检索工具代码到位后，写一个新的 `RetrievalAdapter` 实现
 * 替换 `activeAdapter()` 即可，业务层、界面和数据格式都不用动——
 * 不把任何检索实现的索引格式、类名或数据库扩散到业务层。
 *
 * 现在挂的是内置的字面检索（`local-search.ts`）。它**只是**字面匹配，
 * 不冒充语义能力（§4 明令"不虚构其具体能力和性能"）。
 */

import { searchAssistant } from "./local-search.ts";
import type { AssistantQuery, AssistantResult } from "./types.ts";

export interface RetrievalAdapter {
  /** 实现名。换实现后写进结果，老师能看出这次用的是哪一套。 */
  readonly name: string;
  readonly description: string;
  search(query: AssistantQuery): Promise<AssistantResult>;
}

export const localKeywordAdapter: RetrievalAdapter = {
  name: "local-keyword",
  description: "内置字面检索：在已确认来源、规则、当前项目正文与参考资料里做关键词匹配。",
  search: searchAssistant,
};

/** 当前生效的 adapter。换实现时只改这里。 */
export function activeAdapter(): RetrievalAdapter {
  return localKeywordAdapter;
}
