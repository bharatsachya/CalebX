export class BaseCalebxError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

// 1. Infrastructure Errors
export class InfrastructureError extends BaseCalebxError {}

export class HelixDBError extends InfrastructureError {
  constructor(
    message: string,
    public readonly details?: any,
  ) {
    super(message, "ERR_HELIX_DB");
  }
}

export class RedisError extends InfrastructureError {
  constructor(message: string) {
    super(message, "ERR_REDIS");
  }
}

export class TelegramApiError extends InfrastructureError {
  constructor(
    message: string,
    public readonly retryAfter?: number,
  ) {
    super(message, "ERR_TELEGRAM_API");
  }
}

// 2. Domain Errors
export class DomainError extends BaseCalebxError {}

export class ConsentRequiredError extends DomainError {
  constructor(telegramId: number) {
    super(
      `Consent is required for user ${telegramId} before storing data.`,
      "ERR_CONSENT_REQUIRED",
    );
  }
}

export class PersonaNotFoundError extends DomainError {
  constructor(telegramId: number) {
    super(`Persona not found for user ${telegramId}.`, "ERR_PERSONA_NOT_FOUND");
  }
}

export class InsufficientContextError extends DomainError {
  constructor() {
    super(
      "Not enough persona context to surface recommendations.",
      "ERR_INSUFFICIENT_CONTEXT",
    );
  }
}

// 3. Validation Errors
export class ValidationError extends BaseCalebxError {
  constructor(
    message: string,
    public readonly details?: any,
  ) {
    super(message, "ERR_VALIDATION");
  }
}
