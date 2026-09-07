/**
 * Telegram chat action ("typing...") loader helper.
 *
 * Shows Telegram's native typing indicator in the chat header while an
 * asynchronous task (e.g. saving to Google Sheets or fetching matches) is
 * running, renewing it every 4 seconds so it does not expire before the new
 * message is dispatched.
 */

export interface ChatActionable {
  sendChatAction?(
    action: string,
    params?: Record<string, unknown>,
  ): Promise<unknown>;
}

export async function withTyping<T>(
  context: unknown,
  fn: () => Promise<T>,
): Promise<T> {
  const candidate = context as ChatActionable | null | undefined;
  if (!candidate || typeof candidate.sendChatAction !== "function") {
    return fn();
  }

  const send = () => candidate.sendChatAction!("typing").catch(() => undefined);

  await send();
  const interval = setInterval(send, 4000);
  try {
    return await fn();
  } finally {
    clearInterval(interval);
  }
}
