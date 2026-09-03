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

/**
 * @deprecated HelixDB was removed on 2026-08-09 and never ran against a real
 * instance. Kept only so nothing that still imports it breaks; use
 * `PostgresError` or `Neo4jError`.
 */
export class HelixDBError extends InfrastructureError {
  constructor(
    message: string,
    public readonly details?: unknown,
  ) {
    super(message, "ERR_HELIX_DB");
  }
}

export class PostgresError extends InfrastructureError {
  constructor(
    message: string,
    public readonly details?: unknown,
  ) {
    super(message, "ERR_POSTGRES");
  }
}

export class Neo4jError extends InfrastructureError {
  constructor(
    message: string,
    public readonly details?: unknown,
  ) {
    super(message, "ERR_NEO4J");
  }
}

export class EmbeddingError extends InfrastructureError {
  constructor(
    message: string,
    public readonly details?: unknown,
  ) {
    super(message, "ERR_EMBEDDING");
  }
}

export class QueueError extends InfrastructureError {
  constructor(
    message: string,
    public readonly details?: unknown,
  ) {
    super(message, "ERR_QUEUE");
  }
}

export class ExternalApiError extends InfrastructureError {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message, "ERR_EXTERNAL_API");
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
  constructor(userId: number | string) {
    super(
      `Consent is required for user ${userId} before storing data.`,
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

/**
 * Authorization denial. Carries a machine-readable `reason` so tests can assert
 * *why* access was refused, and so a handler can tell "you do not own this" apart
 * from "that belongs to your other mode".
 *
 * The message deliberately never includes the resource owner's id — a denial
 * message is user-visible in the worst case, and leaking the id of the person you
 * were not allowed to see defeats the point.
 */
export class ForbiddenError extends DomainError {
  constructor(
    public readonly reason: string,
    public readonly action?: string,
  ) {
    super(
      `Access denied${action ? ` for action "${action}"` : ""}: ${reason}`,
      "ERR_FORBIDDEN",
    );
  }
}

/** A user tried to use a mode they have no profile/consent for. */
export class ModeNotEnrolledError extends DomainError {
  constructor(public readonly mode: string) {
    super(`Not enrolled in mode "${mode}".`, "ERR_MODE_NOT_ENROLLED");
  }
}

/** A request is waiting on a human coordinator; the caller should not retry. */
export class ReviewPendingError extends DomainError {
  constructor(public readonly taskId: string) {
    super(`Review task ${taskId} is still open.`, "ERR_REVIEW_PENDING");
  }
}

/** A recommendation was requested before there was anything to recommend from. */
export class NoRecommendationsError extends DomainError {
  constructor(public readonly detail: string) {
    super(`No recommendations available: ${detail}`, "ERR_NO_RECOMMENDATIONS");
  }
}
