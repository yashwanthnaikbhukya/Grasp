/** Typed errors. Never string-match an error message. */

export class GraspError extends Error {
  constructor(
    message: string,
    readonly meta: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** A provider returned 4xx we should not retry — this is our bug, surface it. */
export class ProviderRequestError extends GraspError {}

/** 429 / 5xx / timeout / connection — retryable, triggers failover. */
export class ProviderTransientError extends GraspError {}

/** Model output failed schema validation even after one repair attempt. */
export class SchemaValidationError extends GraspError {}

/** Every provider in the chain failed. The caller decides how to degrade. */
export class GatewayExhaustedError extends GraspError {}

/** The learner is over their daily token budget. */
export class BudgetExceededError extends GraspError {}

export function isTransient(e: unknown): boolean {
  return e instanceof ProviderTransientError || e instanceof SchemaValidationError;
}
