import { User, IUserRepository } from "@calebx/core";

/**
 * Mock UserRepository to allow the bot to start polling and run
 * without requiring a running HelixDB instance in the first step.
 * In the next steps, we will implement the actual HelixDB client.
 */
export class HelixUserRepository implements IUserRepository {
  private users = new Map<number, User>();

  async createUser(telegramId: number): Promise<User> {
    const newUser: User = {
      id: `helix-mock-${telegramId}`,
      telegramId,
    };
    this.users.set(telegramId, newUser);
    console.log(
      `[DB] Mock-created user in HelixDB adapter with telegramId: ${telegramId}`,
    );
    return newUser;
  }

  async getUserByTelegramId(telegramId: number): Promise<User | null> {
    const user = this.users.get(telegramId) || null;
    console.log(
      `[DB] Mock-lookup user in HelixDB adapter with telegramId ${telegramId}:`,
      user,
    );
    return user;
  }
}
