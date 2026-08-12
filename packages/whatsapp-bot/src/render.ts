import { copy, type ChoiceOption, type Prompt } from "@calebx/channel";

/**
 * Renders a channel-agnostic `Prompt` as a Cloud API message payload.
 *
 * WhatsApp caps interactive reply buttons at 3, and both onboarding choice
 * steps offer 4 options — so anything over 3 becomes an interactive list. The
 * list costs the user an extra tap (button opens a sheet, then a row), which is
 * why every choice prompt also spells the options out as a numbered list in the
 * body: typing "2" always works, whatever the client renders.
 */

/** Cloud API field caps. Exceeding any of them is a 400 from Graph. */
const ROW_TITLE_MAX = 24;
const BUTTON_TITLE_MAX = 20;
const LIST_BUTTON_MAX = 20;

export function renderPrompt(
  to: string,
  prompt: Prompt,
  nudge?: string,
): object {
  const body = nudge ? `${nudge}\n\n${prompt.text}` : prompt.text;

  if (prompt.kind === "text") return textPayload(to, body);

  const numbered = `${body}\n\n${copy.numberedOptions(prompt.options.map((option) => option.label))}`;

  return prompt.options.length <= 3
    ? buttonsPayload(to, numbered, prompt.options)
    : listPayload(to, numbered, prompt.options);
}

export function textPayload(to: string, body: string): object {
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    // Link previews would render the URLs users paste at us; keep replies clean.
    text: { preview_url: false, body },
  };
}

export function buttonsPayload(
  to: string,
  body: string,
  options: readonly ChoiceOption[],
): object {
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: body },
      action: {
        buttons: options.slice(0, 3).map((option) => ({
          type: "reply",
          reply: {
            id: option.id,
            title: truncate(option.label, BUTTON_TITLE_MAX),
          },
        })),
      },
    },
  };
}

export function listPayload(
  to: string,
  body: string,
  options: readonly ChoiceOption[],
): object {
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      // `body` is required for a list; omitting it is a 400.
      body: { text: body },
      action: {
        button: truncate("Choose one", LIST_BUTTON_MAX),
        sections: [
          {
            title: "Options",
            rows: options.slice(0, 10).map((option) => ({
              id: option.id,
              title: truncate(option.label, ROW_TITLE_MAX),
            })),
          },
        ],
      },
    },
  };
}

/**
 * Trims to a hard character budget. Our labels all fit comfortably today; this
 * is here so a future copy edit degrades into a shortened button rather than a
 * rejected send.
 */
function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
