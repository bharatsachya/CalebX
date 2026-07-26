/** A tappable option — the id round-trips through Meta's interactive reply. */
export interface ChoiceOption {
  id: string;
  label: string;
}

/** Cloud API field caps. Exceeding any of them is a 400 from Graph. */
const ROW_TITLE_MAX = 24;
const BUTTON_TITLE_MAX = 20;
const LIST_BUTTON_MAX = 20;

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

/** WhatsApp caps reply buttons at 3 — callers with more options need listPayload. */
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
