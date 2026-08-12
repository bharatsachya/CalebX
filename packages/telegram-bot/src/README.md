# Telegram Bot Source Directory

Contains the bot implementation files:

- `telegram.ts`: Primary entry point for starting the Telegram bot, registering command handlers (e.g. /start), and setting up polling.
- `user.repository.ts`: In-memory `IUserRepository` mock (was `@calebx/db`'s
  `HelixUserRepository`, moved here since `whatsapp-bot` no longer shares it).
