export class ReconError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ReconError';
  }
}

export class AdapterError extends ReconError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'ADAPTER_ERROR', context);
    this.name = 'AdapterError';
  }
}

export class AdapterNotFoundError extends ReconError {
  constructor(resourceType: string, id: string, adapter: string) {
    super(`${resourceType} not found: ${id}`, 'NOT_FOUND', { resourceType, id, adapter });
    this.name = 'AdapterNotFoundError';
  }
}

export class AIProviderError extends ReconError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'AI_PROVIDER_ERROR', context);
    this.name = 'AIProviderError';
  }
}

export class ValidationError extends ReconError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', context);
    this.name = 'ValidationError';
  }
}

export class PipelineError extends ReconError {
  constructor(message: string, step: string, context?: Record<string, unknown>) {
    super(message, 'PIPELINE_ERROR', { step, ...context });
    this.name = 'PipelineError';
  }
}

export class NotImplementedError extends ReconError {
  constructor(feature: string) {
    super(`Not implemented: ${feature}`, 'NOT_IMPLEMENTED', { feature });
    this.name = 'NotImplementedError';
  }
}
