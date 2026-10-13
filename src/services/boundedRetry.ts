export interface BoundedRetryOptions {
  attempts: number;
  initialDelayMs: number;
  onRetry?: (error: unknown, nextAttempt: number, attempts: number) => void;
}

export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  { attempts, initialDelayMs, onRetry }: BoundedRetryOptions,
): Promise<T> {
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new RangeError('Retry attempts must be a positive integer.');
  }
  if (!Number.isFinite(initialDelayMs) || initialDelayMs < 0) {
    throw new RangeError('Initial retry delay must be a non-negative number.');
  }

  let delayMs = initialDelayMs;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= attempts) throw error;
      onRetry?.(error, attempt + 1, attempts);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      delayMs *= 2;
    }
  }
}
