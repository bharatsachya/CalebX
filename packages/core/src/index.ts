export interface User {
  id?: string;
  telegramId: number;
}

export interface IUserRepository {
  createUser(telegramId: number): Promise<User>;
  getUserByTelegramId(telegramId: number): Promise<User | null>;
}
