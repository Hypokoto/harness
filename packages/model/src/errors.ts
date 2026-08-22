export type ModelErrorKind =
  | 'authentication'
  | 'rate_limit'
  | 'invalid_request'
  | 'provider'
  | 'network'
  | 'unknown';

export interface ModelErrorOptions extends ErrorOptions {
  kind: ModelErrorKind;
  statusCode?: number;
  provider?: string;
  retryable?: boolean;
  rawError?: unknown;
}

export class ModelError extends Error {
  public readonly kind: ModelErrorKind;
  public readonly statusCode?: number;
  public readonly provider: string;
  public readonly retryable: boolean;
  public readonly rawError?: unknown;

  constructor(message: string, options: ModelErrorOptions) {
    super(message, { cause: options.cause });
    this.name = 'ModelError';
    this.kind = options.kind;
    this.statusCode = options.statusCode;
    this.provider = options.provider ?? 'unknown';
    this.retryable = options.retryable ?? false;
    this.rawError = options.rawError;
  }
}

export class AuthenticationError extends ModelError {
  constructor(message: string, options?: Omit<Partial<ModelErrorOptions>, 'kind'>) {
    super(message, {
      kind: 'authentication',
      statusCode: options?.statusCode ?? 401,
      retryable: false,
      ...options,
    });
    this.name = 'AuthenticationError';
  }
}

export class RateLimitError extends ModelError {
  public readonly retryAfterMs?: number;

  constructor(
    message: string,
    options?: Omit<Partial<ModelErrorOptions>, 'kind'> & { retryAfterMs?: number }
  ) {
    super(message, {
      kind: 'rate_limit',
      statusCode: options?.statusCode ?? 429,
      retryable: true,
      ...options,
    });
    this.name = 'RateLimitError';
    this.retryAfterMs = options?.retryAfterMs;
  }
}

export class InvalidRequestError extends ModelError {
  constructor(message: string, options?: Omit<Partial<ModelErrorOptions>, 'kind'>) {
    super(message, {
      kind: 'invalid_request',
      statusCode: options?.statusCode ?? 400,
      retryable: false,
      ...options,
    });
    this.name = 'InvalidRequestError';
  }
}

export class ProviderError extends ModelError {
  constructor(message: string, options?: Omit<Partial<ModelErrorOptions>, 'kind'>) {
    super(message, {
      kind: 'provider',
      statusCode: options?.statusCode ?? 500,
      retryable: options?.retryable ?? true,
      ...options,
    });
    this.name = 'ProviderError';
  }
}

export class NetworkError extends ModelError {
  constructor(message: string, options?: Omit<Partial<ModelErrorOptions>, 'kind'>) {
    super(message, {
      kind: 'network',
      retryable: true,
      ...options,
    });
    this.name = 'NetworkError';
  }
}

export class UnknownModelError extends ModelError {
  constructor(message: string, options?: Omit<Partial<ModelErrorOptions>, 'kind'>) {
    super(message, {
      kind: 'unknown',
      retryable: false,
      ...options,
    });
    this.name = 'UnknownModelError';
  }
}
