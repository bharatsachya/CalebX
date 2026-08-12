import type { Prompt } from "@calebx/channel";
import type { WhatsAppConfig } from "./config.ts";
import { renderPrompt, textPayload } from "./render.ts";

/** Cloud API text body cap is 4096; chunk below it with room for a boundary. */
const TEXT_CHUNK_LIMIT = 4000;

/**
 * Thin WhatsApp Cloud API client. Uses global fetch — no SDK, no runtime deps.
 *
 * Nothing here throws. Sends happen on a detached background chain (see
 * `UserQueue`), so an escaping error would be an unhandled rejection; failures
 * are logged with Meta's `code` and `fbtrace_id`, which are what support asks
 * for, and swallowed.
 */
export class WhatsAppClient {
  constructor(private readonly config: WhatsAppConfig) {}

  private get endpoint(): string {
    const { graphBase, graphVersion, phoneNumberId } = this.config;
    return `${graphBase}/${graphVersion}/${phoneNumberId}/messages`;
  }

  /** Sends text, split across messages if it exceeds the Cloud API cap. */
  async sendText(to: string, body: string): Promise<void> {
    for (const chunk of chunkText(body, TEXT_CHUNK_LIMIT)) {
      // Awaited in order: the Cloud API does not guarantee ordering across
      // concurrent requests, so parallel sends can arrive shuffled.
      await this.post(textPayload(to, chunk));
    }
  }

  /** Sends a prompt from the shared onboarding FSM. */
  async sendPrompt(to: string, prompt: Prompt, nudge?: string): Promise<void> {
    await this.post(renderPrompt(to, prompt, nudge));
  }

  /** Sends an already-built payload, for flows that render their own (consent). */
  async sendRaw(payload: object): Promise<void> {
    await this.post(payload);
  }

  /**
   * Marks the inbound message read and shows a typing indicator, in one call.
   *
   * Fire-and-forget at the call site — a ~100ms round trip should not delay the
   * reply. The indicator clears on our next message or after 25s, so only call
   * this when a reply is actually coming.
   */
  async markReadAndTyping(messageId: string): Promise<void> {
    await this.post({
      messaging_product: "whatsapp",
      status: "read",
      message_id: messageId,
      typing_indicator: { type: "text" },
    });
  }

  private async post(payload: object): Promise<void> {
    if (this.config.dryRun) {
      console.log("[whatsapp:dry-run] would POST", JSON.stringify(payload));
      return;
    }

    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.config.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => "<unreadable>");
        console.error(
          `[whatsapp] send failed (HTTP ${response.status}): ${detail}`,
        );
      }
    } catch (error) {
      console.error("[whatsapp] send threw:", error);
    }
  }
}

/**
 * Splits text into chunks under `limit`, preferring a paragraph break, then a
 * line break, then a space, so a long agent reply doesn't split mid-word.
 */
export function chunkText(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];

  const chunks: string[] = [];
  let rest = text;

  while (rest.length > limit) {
    const window = rest.slice(0, limit);
    const boundary = Math.max(
      window.lastIndexOf("\n\n"),
      window.lastIndexOf("\n"),
      window.lastIndexOf(" "),
    );
    // No boundary at all (one enormous token) → hard split at the limit.
    const cut = boundary > 0 ? boundary : limit;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }

  if (rest !== "") chunks.push(rest);
  return chunks;
}
