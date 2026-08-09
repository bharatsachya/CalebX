import { User, IUserRepository } from "@calebx/core";

/**
 * In-memory mock UserRepository so the bot can start and run without a real
 * persona-store connection. Used to live in @calebx/db as "HelixUserRepository"
 * shared with whatsapp-bot; whatsapp-bot has since become the independent
 * matchmaking product (packages/db, Postgres), so this is telegram-bot's own
 * local stub now — it has no reason to live in a shared package with one
 * consumer. Replace with a real HelixDB client when that adapter is built.
 */
export class InMemoryUserRepository implements IUserRepository {
  private users = new Map<string, User>();

  async createUser(userId: string): Promise<User> {
    const newUser: User = {
      id: `mock-${userId}`,
      userId,
    };
    this.users.set(userId, newUser);
    console.log(`[telegram] Mock-created user with userId: ${userId}`);
    return newUser;
  }

  async getUser(userId: string): Promise<User | null> {
    const user = this.users.get(userId) || null;
    console.log(`[telegram] Mock-lookup user with userId ${userId}:`, user);
    return user;
  }
}
