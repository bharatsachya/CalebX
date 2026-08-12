# @calebx/agent

Conversational agent pipeline for CALEBX. Provides a single entry point:

runAgent(userId: string, message: string, channel?: string): Promise<string>

Internally runs a two-stage LLM pipeline (extraction → response) over
OpenRouter and retrieves/stores per-user memories via mem0.ai.

`userId` is a namespaced id from `@calebx/channel` — `"tg:123456789"`,
`"wa:16505551234"`. mem0 has a single flat user_id space, so the namespace is
what stops a WhatsApp phone number from colliding with a Telegram id and
merging two strangers' personas. Never pass a bare platform id.

`channel` is the human-readable platform name ("Telegram", "WhatsApp") woven
into the system prompt so the bot never names the wrong one. Defaults to the
neutral "chat".

This package may import from @calebx/core for types only. No package
in core/ imports from here.
