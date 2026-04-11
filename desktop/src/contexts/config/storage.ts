export function normalizeSelectedDeviceName(
  deviceName: string | null
): string | null {
  if (!deviceName) {
    return null;
  }

  const trimmed = deviceName.trim();
  if (!trimmed || trimmed === 'default') {
    return null;
  }

  if (trimmed.endsWith(' (input)')) {
    return trimmed.slice(0, -8);
  }

  if (trimmed.endsWith(' (output)')) {
    return trimmed.slice(0, -9);
  }

  return trimmed;
}

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

export function readBooleanPreference(key: string, fallback: boolean): boolean {
  if (!isBrowser()) {
    return fallback;
  }

  const saved = localStorage.getItem(key);
  if (saved === null) {
    return fallback;
  }

  return saved === 'true';
}

export function writeBooleanPreference(key: string, value: boolean): void {
  if (!isBrowser()) {
    return;
  }

  localStorage.setItem(key, value.toString());
}

export function readStringPreference(key: string, fallback: string): string {
  if (!isBrowser()) {
    return fallback;
  }

  return localStorage.getItem(key) ?? fallback;
}

export function writeStringPreference(key: string, value: string): void {
  if (!isBrowser()) {
    return;
  }

  localStorage.setItem(key, value);
}

export function seedProviderModelMap(provider: string, model: string): void {
  if (!isBrowser() || !model) {
    return;
  }

  const map = JSON.parse(localStorage.getItem('providerModelMap') || '{}');
  map[provider] = model;
  localStorage.setItem('providerModelMap', JSON.stringify(map));
}
