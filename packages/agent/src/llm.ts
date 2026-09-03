import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import { withSpan } from "@calebx/trace";
import { agentConfig } from "./config.ts";
import type {
  ChatCompletion,
  ChatMessage,
  ChatModel,
  ChatRequest,
} from "./chat.ts";

/**
 * OpenRouter-backed OpenAI client.
 * Drop-in for the OpenAI SDK — same interface, different baseURL.
 */
let client: OpenAI | null = null;

/** Built on first use, so importing this package needs no credentials. */
function openRouterClient(): OpenAI {
  if (!client) {
    client = new OpenAI({
      apiKey: agentConfig.openrouterApiKey,
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: {
        "HTTP-Referer": "https://github.com/calebx/calebx",
        "X-Title": "CALEBX",
      },
    });
  }
  return client;
}

function toOpenAiMessages(
  system: string,
  messages: ChatMessage[],
): ChatCompletionMessageParam[] {
  const out: ChatCompletionMessageParam[] = [
    { role: "system", content: system },
  ];

  for (const message of messages) {
    if (message.role === "tool") {
      out.push({
        role: "tool",
        tool_call_id: message.toolCallId ?? "",
        content: message.content,
      });
      continue;
    }
    if (message.role === "assistant" && message.toolCalls?.length) {
      out.push({
        role: "assistant",
        content: message.content || null,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: call.arguments },
        })),
      });
      continue;
    }
    out.push({
      role: message.role as "user" | "assistant",
      content: message.content,
    });
  }
  return out;
}

function toOpenAiTools(request: ChatRequest): ChatCompletionTool[] | undefined {
  if (request.tools.length === 0) return undefined;
  return request.tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

/**
 * The `ChatModel` the tool loop runs against.
 *
 * All the shape-shifting between our vocabulary and the SDK's lives here, so
 * everything upstream can be exercised with a scripted fake — which is the only
 * way to test what happens when a model hallucinates a tool name.
 */
export const openRouterModel: ChatModel = {
  async complete(request: ChatRequest): Promise<ChatCompletion> {
    return withSpan(
      "llm.complete",
      {
        kind: "llm",
        attributes: {
          "model.name": agentConfig.openrouterModel,
          temperature: request.temperature,
          toolCount: request.tools.length,
        },
      },
      async () => {
        const response = await openRouterClient().chat.completions.create({
          model: agentConfig.openrouterModel,
          temperature: request.temperature,
          messages: toOpenAiMessages(request.system, request.messages),
          tools: toOpenAiTools(request),
        });

        const choice = response.choices[0]?.message;
        return {
          content: choice?.content ?? "",
          toolCalls: (choice?.tool_calls ?? []).flatMap((call) =>
            call.type === "function"
              ? [
                  {
                    id: call.id,
                    name: call.function.name,
                    arguments: call.function.arguments,
                  },
                ]
              : [],
          ),
        };
      },
    );
  },
};

/**
 * Stage 1 — extraction. Low temperature for deterministic JSON.
 *
 * Still a separate call from the conversation, and still at a different
 * temperature. It now runs in the ingest worker after the reply has been sent,
 * so the user never waits on it.
 */
export async function extractionCall(
  systemPrompt: string,
  userContent: string,
): Promise<string> {
  return withSpan("llm.extraction", { kind: "llm" }, async () => {
    const response = await openRouterClient().chat.completions.create({
      model: agentConfig.openrouterModel,
      temperature: 0.1,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
    });
    return response.choices[0]?.message?.content ?? "";
  });
}
