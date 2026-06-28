export const logger = {
  info: (msg: string) => console.log(msg),
  error: (msg: string) => console.error(msg),
  warn: (msg: string) => console.warn(msg),
};

export async function shutdownLoggers(): Promise<void> {
  // No-op for this fallback logger
}
