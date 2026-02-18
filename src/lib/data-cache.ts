const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;

type CacheEnvelope<T> = {
  value: T;
  timestamp: number;
};

const getStorage = (): Storage | null => {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

const isEnvelope = <T>(value: unknown): value is CacheEnvelope<T> => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const item = value as Partial<CacheEnvelope<T>>;
  return typeof item.timestamp === "number" && "value" in item;
};

export const cacheKey = (...parts: Array<string | number | null | undefined>) =>
  parts
    .filter((part) => part !== null && part !== undefined && part !== "")
    .map((part) => String(part))
    .join(":");

export const readCachedValue = <T>(
  key: string,
  ttlMs = DEFAULT_CACHE_TTL_MS
): T | null => {
  const storage = getStorage();
  if (!storage) return null;

  try {
    const raw = storage.getItem(key);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as CacheEnvelope<T> | T;

    // Backward-compatible support for older caches that stored raw JSON values.
    if (!isEnvelope<T>(parsed)) {
      return parsed as T;
    }

    if (Date.now() - parsed.timestamp > ttlMs) {
      storage.removeItem(key);
      return null;
    }

    return parsed.value;
  } catch {
    return null;
  }
};

export const writeCachedValue = <T>(key: string, value: T): void => {
  const storage = getStorage();
  if (!storage) return;

  try {
    const payload: CacheEnvelope<T> = {
      value,
      timestamp: Date.now(),
    };
    storage.setItem(key, JSON.stringify(payload));
  } catch {
    // Ignore write failures (quota/private mode), app still works without cache.
  }
};

export const removeCachedValue = (key: string): void => {
  const storage = getStorage();
  if (!storage) return;

  try {
    storage.removeItem(key);
  } catch {
    // Ignore cache cleanup failures.
  }
};

export { DEFAULT_CACHE_TTL_MS };
