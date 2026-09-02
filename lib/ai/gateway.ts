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
  temperature?: number;
  maxTokens?: number;
}

export interface AiResult {
  text: string;
  model: string;
  provider: string;
  usage: { inputTokens: number; outputTokens: number };
  latencyMs: number;
}

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

const mockProvider: AiProvider = {
  name: "mock",
  async complete(req, model) {
    const parts = [
      `[MOCK] task=${req.task} model=${model}`,
      req.system ? `[system] ${req.system.slice(0, 160)}…` : "",
      ...req.messages.map(
        (m) => `[${m.role}] ${m.content.slice(0, 240)}${m.content.length > 240 ? "…" : ""}`,
      ),
    ].filter(Boolean);
    return {
      text: parts.join("\n"),
      model,
      provider: "mock",
      usage: { inputTokens: 0, outputTokens: 0 },
      latencyMs: 0,
    };
  },
};

function anthropicProvider(baseUrl: string, apiKey: string): AiProvider {
  return {
    name: "anthropic-compatible",
    async complete(req, model) {
      const started = Date.now();
      const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: req.maxTokens ?? 4096,
          temperature: req.temperature ?? 0.7,
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
      };
    },
  };
}

export function getAiProvider(): AiProvider {
  const provider = process.env.AI_PROVIDER ?? "mock";
  if (provider === "mock") return mockProvider;
  if (provider === "anthropic-compatible") {
    const baseUrl = process.env.AI_BASE_URL;
    const apiKey = process.env.AI_API_KEY;
    if (!baseUrl || !apiKey) {
      throw new Error(
        "AI_PROVIDER=anthropic-compatible 时必须配置 AI_BASE_URL 与 AI_API_KEY",
      );
    }
    return anthropicProvider(baseUrl, apiKey);
  }
  throw new Error(`未知的 AI_PROVIDER:${provider}(支持 mock / anthropic-compatible)`);
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
