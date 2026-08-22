/**
 * The vision-model reader: a card crop → `ParsedCard`, via OpenRouter.
 *
 * The alternative to `card.ts`, behind the same seam, so the CLI, the mapper and
 * the sheet writer cannot tell which engine produced a row.
 *
 * The two engines fail differently, and the difference drives the safeguards
 * here. Tesseract garbles — `= - बस` is visibly broken, and a reviewer skips
 * past it. A vision model is *fluent*: whatever it returns is well-formed, so
 * nothing about the output announces a mistake.
 *
 * Where the mistakes actually land was measured on a 12-card page, and it was
 * not where this file originally assumed. **Digits came back reliable** — dates,
 * entry numbers, incomes and phone numbers all matched the printed card, and the
 * entry numbers formed an unbroken sequence. **The Devanagari prose is where the
 * errors are**: `पवत` for `रावत`, `कसूरलगंज` for `नसरुल्लागंज`. Both are
 * plausible-looking words, and neither is caught by a digit check.
 *
 * So this reader:
 *
 *   - asks for transcription, never interpretation, and forbids inference;
 *   - confirms numerics with a genuinely independent second reading, not the
 *     same request twice (see `CONFIRM_PROMPT`);
 *   - puts the model's output through exactly the same validators as Tesseract's.
 *
 * The remaining gap is deliberate and worth knowing: **prose fields are not
 * cross-checked at all.** A closed vocabulary would catch the gotra errors the
 * way `../gotra.ts` does for the PDF pipeline; free text like an address has no
 * such backstop and relies on `needs_review`.
 */

import sharp from "sharp";
import { reconcile, validateCard } from "./validate.ts";
import type { CardRegion, CardRow, ParsedCard } from "./types.ts";
import {
  ENDPOINT,
  SCALE,
  JPEG_QUALITY,
  REQUEST_TIMEOUT_MS,
  PROMPT,
  CONFIRM_FIELDS,
  CONFIRM_PROMPT,
  CONFIRM_SCALE,
  type VisionOptions,
  parseReply,
  pick,
} from "./vision.config.ts";

export {
  type VisionOptions,
  DEFAULT_VISION_MODEL,
  DEFAULT_MIN_INTERVAL_MS,
  parseReply,
} from "./vision.config.ts";

interface ChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string; code?: number };
}

export class VisionReader {
  private lastCallAt = 0;

  constructor(private readonly options: VisionOptions) {}

  private async throttle(): Promise<void> {
    const wait = this.lastCallAt + this.options.minIntervalMs - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    this.lastCallAt = Date.now();
  }

  /** One call. Retries on timeout, 429 and 5xx, honouring Retry-After when given. */
  private async call(
    dataUrl: string,
    prompt: string,
    attempt = 0,
  ): Promise<string> {
    await this.throttle();

    let response: Response;
    try {
      response = await this.post(dataUrl, prompt);
    } catch (error: unknown) {
      // A timeout or a dropped connection is worth another go; anything else is
      // not this layer's to interpret.
      const timedOut =
        error instanceof Error &&
        (error.name === "TimeoutError" || error.name === "AbortError");
      if (!timedOut || attempt >= 2) throw error;
      return this.call(dataUrl, prompt, attempt + 1);
    }

    if ((response.status === 429 || response.status >= 500) && attempt < 4) {
      const header = Number(response.headers.get("retry-after"));
      const backoff = Number.isFinite(header)
        ? header * 1000
        : this.options.minIntervalMs * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, backoff));
      return this.call(dataUrl, prompt, attempt + 1);
    }

    const body = (await response.json()) as ChatResponse;
    if (body.error) {
      throw new Error(
        `OpenRouter ${body.error.code ?? response.status}: ${body.error.message ?? "unknown"}`,
      );
    }
    return body.choices?.[0]?.message?.content ?? "";
  }

  private post(dataUrl: string, prompt: string): Promise<Response> {
    return fetch(ENDPOINT, {
      method: "POST",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/calebx/calebx",
        "X-Title": "CALEBX directory-import",
      },
      body: JSON.stringify({
        model: this.options.model,
        // Transcription is not a creative task; any sampling is invention.
        temperature: 0,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
      }),
    });
  }

  private async readOnce(
    dataUrl: string,
    prompt: string,
    fields?: readonly (keyof CardRow)[],
  ): Promise<CardRow | null> {
    const parsed = parseReply(await this.call(dataUrl, prompt));
    return parsed === null ? null : pick(parsed, fields);
  }

  /** Renders the card at a given upscale, as JPEG, ready to send. */
  private async render(
    path: string,
    card: CardRegion,
    scale: number,
  ): Promise<string> {
    const jpeg = await sharp(path)
      .extract(card.box)
      .resize({ width: card.box.width * scale, kernel: "lanczos3" })
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer();
    return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  }

  async readCard(path: string, card: CardRegion): Promise<ParsedCard> {
    // The whole card is sent, portrait included: the entry-number badge sits in
    // the photo column, and it is the only stable id this format prints.
    const issues: string[] = [];
    const first = await this.readOnce(
      await this.render(path, card, SCALE),
      PROMPT,
    );

    if (first === null) {
      return {
        raw: {},
        sourceImage: path,
        page: card.page,
        index: card.index,
        issues: ["model returned no parseable JSON"],
        confidence: 0,
      };
    }

    let raw = first;
    let confirmed = false;

    if (this.options.consensus) {
      // A different rescale and a different question — see CONFIRM_PROMPT.
      const second = await this.readOnce(
        await this.render(path, card, CONFIRM_SCALE),
        CONFIRM_PROMPT,
        CONFIRM_FIELDS,
      );
      if (second === null) {
        issues.push("confirming pass returned no JSON — numerics dropped");
        for (const field of CONFIRM_FIELDS) delete raw[field];
      } else {
        raw = reconcile(first, second, issues);
        confirmed = true;
      }
    } else {
      issues.push("single pass — numeric fields unconfirmed");
    }

    validateCard(raw, issues);

    return {
      raw,
      sourceImage: path,
      page: card.page,
      index: card.index,
      issues,
      // Not a measurement — the API reports no per-field confidence. This says
      // only "two differently-framed readings agreed on every number", which is
      // evidence, not proof: both framings can still misread the same glyph.
      // Every row is written with needs_review = TRUE regardless.
      confidence: confirmed && issues.length === 0 ? 100 : 0,
    };
  }
}
