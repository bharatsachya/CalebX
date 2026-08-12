import { User, IUserRepository } from "@calebx/core";

/**
 * Mock UserRepository to allow the bots to start and run without requiring a
 * running HelixDB instance. In the next steps, we will implement the actual
 * HelixDB client.
 *
 * Keys are channel-namespaced user ids ("tg:123", "wa:4477..."), so one
 * repository serves every chat platform.
 */
export class HelixUserRepository implements IUserRepository {
  private users = new Map<string, User>();

  async createUser(userId: string): Promise<User> {
    const newUser: User = {
      id: `helix-mock-${userId}`,
      userId,
    };
    this.users.set(userId, newUser);
    console.log(
      `[DB] Mock-created user in HelixDB adapter with userId: ${userId}`,
    );
    return newUser;
  }

  async getUser(userId: string): Promise<User | null> {
    const user = this.users.get(userId) || null;
    console.log(
      `[DB] Mock-lookup user in HelixDB adapter with userId ${userId}:`,
      user,
    );
    return user;
  }
}
