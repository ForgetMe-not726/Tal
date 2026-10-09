/**
 * AI Gateway(profile.md 二十九/三十):业务代码只面对 aiComplete(),不感知厂商与协议。
 *
 * 双模式:
 * - mock(默认):无任何 Key 也能跑通管线,返回占位文本,便于开发联调;
 * - anthropic-compatible:公司网关(Anthropic Messages 协议),同一 Key 下按任务
 *   路由不同模型 —— generation / review 用强文本模型,vision 用视觉模型。
 *
 * 换模型或换网关只改环境变量(.env.example),不改业务代码(工程原则 1)。
 */

export type AiTask = "generation" | "review" | "vision";

export interface AiMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AiRequest {
  task: AiTask;
  system?: string;
  messages: AiMessage[];
  maxTokens?: number;
}

export interface AiResult {
  text: string;
  model: string;
  provider: string;
  usage: { inputTokens: number; outputTokens: number };
  latencyMs: number;
  stopReason?: string;
}

export type AiDiagnostics = {
  provider: string;
  configured: boolean;
  baseUrl: string | null;
  models: string[];
  modelsEndpoint: "available" | "unsupported" | "error" | "not_applicable";
  error?: string;
};

export type AiProbeResult = {
  task: AiTask;
  model: string | null;
  status: "ok" | "skipped" | "http_error" | "network_error";
  httpStatus?: number;
  error?: string;
};

const MODEL_ENV: Record<AiTask, string> = {
  generation: "AI_MODEL_GENERATION",
  review: "AI_MODEL_REVIEW",
  vision: "AI_MODEL_VISION",
};

function resolveModel(task: AiTask): string {
  const model = process.env[MODEL_ENV[task]];
  if (!model) {
    throw new Error(`缺少模型路由配置:${MODEL_ENV[task]}(.env.local)`);
  }
  return model;
}

interface AiProvider {
  name: string;
  complete(req: AiRequest, model: string): Promise<AiResult>;
}

function promptSection(prompt: string, heading: string): string {
  const start = prompt.indexOf(heading);
  if (start < 0) return "";
  const body = prompt.slice(start + heading.length);
  const end = body.search(/\n【[^】]+】/);
  return body.slice(0, end < 0 ? body.length : end).trim();
}

function mockDraft(prompt: string): string {
  const target = prompt.match(/模块「([^」]+)」/)?.[1] ?? "演示模块";
  const source = promptSection(prompt, "【已确认结构化来源】");
  const plan = promptSection(prompt, "【Migration Plan】");
  const sourceBody = source && !source.startsWith("（无") ? source.slice(0, 6000) : "（没有已确认来源内容）";
  return `# ${target}\n\n> 演示模式草稿：以下内容仅用于联调，不代表正式教研成稿。\n\n## 已确认来源摘录\n\n${sourceBody}\n\n## 迁移计划\n\n${plan ? `计划已由流水线生成：${plan.slice(0, 1200)}` : "计划信息不可用，请人工确认。"}\n\n## 说明\n\n- Mock AI 不替代教研判断。\n- 请根据正式规则、版式和原 PDF 逐项审校后再发布。`;
}

const mockProvider: AiProvider = {
  name: "mock",
  async complete(req, model) {
    const prompt = req.messages.at(-1)?.content ?? "";
    return {
      text: req.task === "generation" ? mockDraft(prompt) : JSON.stringify({ suggestions: [] }),
      model,
      provider: "mock",
      usage: { inputTokens: 0, outputTokens: 0 },
      latencyMs: 0,
      stopReason: "end_turn",
    };
  },
};

function gatewayRoot(raw: string): string {
  return raw
    .trim()
    .replace(/[?#].*$/, "")
    .replace(/\/v1\/(?:messages|chat\/completions)\/?$/, "")
    .replace(/\/v1\/?$/, "")
    .replace(/\/+$/, "");
}

function apiKeyHeaders(provider: "anthropic-compatible" | "openai-compatible", apiKey: string): Record<string, string> {
  const mode = process.env.AI_AUTH_MODE?.trim().toLowerCase();
  const useApiKey = mode === "x-api-key" || (!mode && provider === "anthropic-compatible");
  return useApiKey ? { "x-api-key": apiKey } : { authorization: `Bearer ${apiKey}` };
}

/**
 * 部分模型/网关会以 400 拒绝 temperature。默认不发送该参数；
 * 只有显式配置 AI_TEMPERATURE=<数字> 时才随请求带上。
 */
function temperatureParam(): Record<string, number> {
  const configured = process.env.AI_TEMPERATURE?.trim();
  if (!configured) return {};
  const value = Number(configured);
  return Number.isFinite(value) ? { temperature: value } : {};
}

function anthropicProvider(baseUrl: string, apiKey: string): AiProvider {
  return {
    name: "anthropic-compatible",
    async complete(req, model) {
      const started = Date.now();
      const res = await fetch(`${gatewayRoot(baseUrl)}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...apiKeyHeaders("anthropic-compatible", apiKey),
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: req.maxTokens ?? 4096,
          ...temperatureParam(),
          ...(req.system ? { system: req.system } : {}),
          messages: req.messages,
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`AI 网关请求失败(HTTP ${res.status}):${body.slice(0, 300)}`);
      }

      const data = (await res.json()) as {
        content?: { type: string; text?: string }[];
        usage?: { input_tokens?: number; output_tokens?: number };
        stop_reason?: string;
      };

      return {
        text: (data.content ?? [])
          .filter((c) => c.type === "text")
          .map((c) => c.text ?? "")
          .join(""),
        model,
        provider: "anthropic-compatible",
        usage: {
          inputTokens: data.usage?.input_tokens ?? 0,
          outputTokens: data.usage?.output_tokens ?? 0,
        },
        latencyMs: Date.now() - started,
        stopReason: data.stop_reason,
      };
    },
  };
}

function normalizeFinishReason(reason: string | undefined): string | undefined {
  // OpenAI 协议用 "length" 表示截断；统一成内部的 max_tokens，避免截断结果被当成完稿保存。
  return reason === "length" ? "max_tokens" : reason;
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item) =>
      item && typeof item === "object" && typeof (item as { text?: unknown }).text === "string"
        ? (item as { text: string }).text
        : "",
    )
    .join("");
}

type OpenAiStreamResult = {
  text: string;
  stopReason?: string;
  usage: { inputTokens: number; outputTokens: number };
};

/** 逐块读取 SSE；流式响应头立即返回，不会撞上非流式请求的 headers 超时。 */
async function readOpenAiStream(res: Response): Promise<OpenAiStreamResult> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("AI 网关未返回可读流");
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let stopReason: string | undefined;
  let usage = { inputTokens: 0, outputTokens: 0 };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const payload = line.trim();
      if (!payload.startsWith("data:")) continue;
      const body = payload.slice(5).trim();
      if (!body || body === "[DONE]") continue;
      let chunk: {
        choices?: { delta?: { content?: unknown }; finish_reason?: string }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      try {
        chunk = JSON.parse(body) as typeof chunk;
      } catch {
        continue;
      }
      text += contentToText(chunk.choices?.[0]?.delta?.content);
      const reason = chunk.choices?.[0]?.finish_reason;
      if (reason) stopReason = normalizeFinishReason(reason);
      if (chunk.usage) {
        usage = {
          inputTokens: chunk.usage.prompt_tokens ?? 0,
          outputTokens: chunk.usage.completion_tokens ?? 0,
        };
      }
    }
  }
  return { text, stopReason, usage };
}

function openAiProvider(baseUrl: string, apiKey: string): AiProvider {
  return {
    name: "openai-compatible",
    async complete(req, model) {
      const started = Date.now();
      const messages = [
        ...(req.system ? [{ role: "system", content: req.system }] : []),
        ...req.messages,
      ];
      const res = await fetch(`${gatewayRoot(baseUrl)}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...apiKeyHeaders("openai-compatible", apiKey),
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: req.maxTokens ?? 4096,
          stream: true,
          ...temperatureParam(),
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`AI 网关请求失败(HTTP ${res.status}):${body.slice(0, 300)}`);
      }

      const isStream = (res.headers.get("content-type") ?? "").includes("text/event-stream");
      if (isStream) {
        const streamed = await readOpenAiStream(res);
        if (!streamed.text.trim()) throw new Error("AI 网关返回了空内容");
        return {
          text: streamed.text,
          model,
          provider: "openai-compatible",
          usage: streamed.usage,
          latencyMs: Date.now() - started,
          stopReason: streamed.stopReason,
        };
      }

      // 网关不支持流式时退回一次性响应
      const data = (await res.json()) as {
        choices?: { message?: { content?: unknown }; finish_reason?: string }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      return {
        text: contentToText(data.choices?.[0]?.message?.content),
        model,
        provider: "openai-compatible",
        usage: {
          inputTokens: data.usage?.prompt_tokens ?? 0,
          outputTokens: data.usage?.completion_tokens ?? 0,
        },
        latencyMs: Date.now() - started,
        stopReason: normalizeFinishReason(data.choices?.[0]?.finish_reason),
      };
    },
  };
}

function safeBaseUrl(raw: string | undefined): string | null {
  if (!raw?.trim()) return null;
  const root = gatewayRoot(raw);
  try {
    const url = new URL(root);
    return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
  } catch {
    return root || null;
  }
}

function modelIds(payload: unknown): string[] {
  const items = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object"
      ? ((payload as { data?: unknown; models?: unknown }).data ??
        (payload as { data?: unknown; models?: unknown }).models)
      : [];
  if (!Array.isArray(items)) return [];
  return [...new Set(items
    .map((item) => {
      if (typeof item === "string") return item;
      if (!item || typeof item !== "object") return null;
      const value = item as { id?: unknown; model?: unknown; name?: unknown };
      return typeof value.id === "string"
        ? value.id
        : typeof value.model === "string"
          ? value.model
          : typeof value.name === "string"
            ? value.name
            : null;
    })
    .filter((id): id is string => Boolean(id?.trim()))
    .map((id) => id.trim()))];
}

export async function discoverAiModels(): Promise<AiDiagnostics> {
  const provider = (process.env.AI_PROVIDER ?? "mock").trim() || "mock";
  const baseUrl = safeBaseUrl(process.env.AI_BASE_URL);
  if (provider === "mock") {
    const configured = Object.values(MODEL_ENV)
      .map((key) => process.env[key]?.trim())
      .filter((model): model is string => Boolean(model));
    return {
      provider,
      configured: true,
      baseUrl,
      models: [...new Set(configured.length > 0 ? configured : ["mock-model"])],
      modelsEndpoint: "not_applicable",
    };
  }
  if (provider !== "anthropic-compatible" && provider !== "openai-compatible") {
    return {
      provider,
      configured: false,
      baseUrl,
      models: [],
      modelsEndpoint: "error",
      error: `不支持的 provider:${provider}`,
    };
  }
  const apiKey = process.env.AI_API_KEY?.trim();
  if (!baseUrl || !apiKey) {
    return {
      provider,
      configured: false,
      baseUrl,
      models: [],
      modelsEndpoint: "error",
      error: "缺少 AI_BASE_URL 或 AI_API_KEY",
    };
  }
  try {
    const response = await fetch(`${baseUrl}/v1/models`, {
      method: "GET",
      headers: provider === "openai-compatible"
        ? apiKeyHeaders("openai-compatible", apiKey)
        : { ...apiKeyHeaders("anthropic-compatible", apiKey), "anthropic-version": "2023-06-01" },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      return {
        provider,
        configured: true,
        baseUrl,
        models: [],
        modelsEndpoint: response.status === 404 || response.status === 405 || response.status === 501 ? "unsupported" : "error",
        error: `模型目录接口返回 HTTP ${response.status}`,
      };
    }
    const payload = (await response.json()) as unknown;
    return {
      provider,
      configured: true,
      baseUrl,
      models: modelIds(payload),
      modelsEndpoint: "available",
    };
  } catch (error) {
    return {
      provider,
      configured: true,
      baseUrl,
      models: [],
      modelsEndpoint: "error",
      error: error instanceof Error && error.name === "TimeoutError" ? "模型目录请求超时" : "模型目录请求失败",
    };
  }
}

export async function probeConfiguredModels(): Promise<AiProbeResult[]> {
  const provider = (process.env.AI_PROVIDER ?? "mock").trim() || "mock";
  const tasks: AiTask[] = ["generation", "review", "vision"];
  if (provider === "mock") {
    return tasks.map((task) => ({ task, model: process.env[MODEL_ENV[task]]?.trim() || "mock-model", status: "ok" }));
  }
  if (provider !== "anthropic-compatible" && provider !== "openai-compatible") {
    return tasks.map((task) => ({ task, model: process.env[MODEL_ENV[task]]?.trim() || null, status: "network_error", error: `不支持的 provider:${provider}` }));
  }
  const rawBaseUrl = process.env.AI_BASE_URL?.trim();
  const apiKey = process.env.AI_API_KEY?.trim();
  if (!rawBaseUrl || !apiKey) {
    return tasks.map((task) => ({ task, model: process.env[MODEL_ENV[task]]?.trim() || null, status: "network_error", error: "缺少 AI_BASE_URL 或 AI_API_KEY" }));
  }
  const endpoint = provider === "openai-compatible"
    ? `${gatewayRoot(rawBaseUrl)}/v1/chat/completions`
    : `${gatewayRoot(rawBaseUrl)}/v1/messages`;
  return Promise.all(tasks.map(async (task): Promise<AiProbeResult> => {
    const model = process.env[MODEL_ENV[task]]?.trim() || null;
    if (!model) return { task, model: null, status: "skipped", error: `缺少 ${MODEL_ENV[task]}` };
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: provider === "openai-compatible"
          ? { "content-type": "application/json", ...apiKeyHeaders("openai-compatible", apiKey) }
          : { "content-type": "application/json", ...apiKeyHeaders("anthropic-compatible", apiKey), "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model,
          max_tokens: 1,
          ...temperatureParam(),
          messages: [{ role: "user", content: "Reply with OK." }],
        }),
        signal: AbortSignal.timeout(10000),
      });
      return response.ok
        ? { task, model, status: "ok", httpStatus: response.status }
        : { task, model, status: "http_error", httpStatus: response.status, error: `网关返回 HTTP ${response.status}` };
    } catch (error) {
      return {
        task,
        model,
        status: "network_error",
        error: error instanceof Error && error.name === "TimeoutError" ? "请求超时" : "请求失败",
      };
    }
  }));
}

export function getAiProvider(): AiProvider {
  const provider = process.env.AI_PROVIDER ?? "mock";
  if (provider === "mock") return mockProvider;
  if (provider === "anthropic-compatible" || provider === "openai-compatible") {
    const baseUrl = process.env.AI_BASE_URL;
    const apiKey = process.env.AI_API_KEY;
    if (!baseUrl || !apiKey) {
      throw new Error(
        `AI_PROVIDER=${provider} 时必须配置 AI_BASE_URL 与 AI_API_KEY`,
      );
    }
    return provider === "openai-compatible"
      ? openAiProvider(baseUrl, apiKey)
      : anthropicProvider(baseUrl, apiKey);
  }
  throw new Error(`未知的 AI_PROVIDER:${provider}(支持 mock / anthropic-compatible / openai-compatible)`);
}

/** 统一入口。生产数据从第一天记录 usage/latency(profile.md 三十二),后续在此落库。 */
export async function aiComplete(req: AiRequest): Promise<AiResult> {
  const provider = getAiProvider();
  const model =
    provider.name === "mock" && !process.env[MODEL_ENV[req.task]]
      ? "mock-model"
      : resolveModel(req.task);
  const result = await provider.complete(req, model);
  console.info(
    `[ai] provider=${result.provider} task=${req.task} model=${result.model} ` +
      `in=${result.usage.inputTokens} out=${result.usage.outputTokens} ${result.latencyMs}ms`,
  );
  return result;
}
