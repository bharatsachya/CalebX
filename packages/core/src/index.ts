/**
 * A CALEBX user, identified by a channel-namespaced id ("tg:123", "wa:4477...").
 *
 * The domain deliberately knows nothing about which chat platform a user came
 * from beyond that namespace — adding a platform must not change anything here.
 */
export interface User {
  id?: string;
  userId: string;
}

export interface IUserRepository {
  createUser(userId: string): Promise<User>;
  getUser(userId: string): Promise<User | null>;
}
