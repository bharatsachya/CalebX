import { Bot } from "gramio";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { HelixUserRepository } from "@calebx/db";

// Resolve paths to find .env at the monorepo root
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

// Ensure BOT_TOKEN is loaded
const botToken = process.env.TELEGRAM_BOT_TOKEN;
if (!botToken || botToken === "YOUR_TELEGRAM_BOT_TOKEN_HERE") {
  console.error("❌ Error: TELEGRAM_BOT_TOKEN is not set in your .env file!");
  process.exit(1);
}

// Instantiate our plug-and-play UserRepository adapter (HelixDB backend under the hood)
const userRepo = new HelixUserRepository();

const bot = new Bot(botToken)
  .command("start", async (context) => {
    const telegramId = context.from?.id;
    if (!telegramId) {
      return context.send("Hello! I couldn't identify your Telegram user ID.");
    }

    try {
      // Plug-and-play: check if user exists, if not create them using our Repository interface
      let user = await userRepo.getUserByTelegramId(telegramId);
      let isNew = false;
      if (!user) {
        user = await userRepo.createUser(telegramId);
        isNew = true;
      }

      const greeting = isNew
        ? `Hello! Welcome to CalebX. A new user profile has been created for your Telegram ID: ${telegramId}.`
        : `Welcome back to CalebX! Your profile is active (Telegram ID: ${telegramId}).`;

      return context.send(greeting);
    } catch (error) {
      console.error("Error checking or creating user:", error);
      return context.send(
        "Hello! There was an error loading or creating your user profile.",
      );
    }
  })
  .onStart(({ info }) =>
    console.log(`✨ Bot @${info.username} is starting up and polling...`),
  );

bot.start();
export default bot;
