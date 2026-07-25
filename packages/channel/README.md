# @calebx/channel

Platform-agnostic conversation logic shared by every chat adapter
(`@calebx/telegram-bot`, `@calebx/whatsapp-bot`, and any future one).

This package owns everything about the consent and onboarding experience that is
_not_ specific to a messaging platform:

- **Namespaced user IDs** — `tg:123456789`, `wa:16505551234`. One address space
  across every channel, so per-user memory can never collide between platforms.
- **Ports** — `ConsentStore`, `OnboardingStore`.
- **File-backed implementations** — atomic JSON ledgers, plus a one-time
  migration of legacy bare-numeric (Telegram-only) keys.
- **Copy** — every user-facing string, in one place, so channels cannot drift.
- **Choice tables** — the age and purpose options, with the ids each platform
  round-trips through its own UI.
- **The onboarding FSM** — a pure `(state, input) -> (state, prompts, memory)`
  function with no I/O and no platform types.

## Design rule

This package has **zero runtime dependencies** and imports nothing from the rest
of the monorepo. It never talks to a network, a database, or an LLM. In
particular the FSM does not import `@calebx/agent`: when a step should write a
memory it _returns_ that write, and the adapter performs it. That is what keeps
this package trivially testable and free of platform coupling.

Adapters own all I/O and all rendering. A `Prompt` returned from the FSM says
_what_ to ask; each adapter decides whether that becomes a Telegram inline
keyboard or a WhatsApp interactive list.
