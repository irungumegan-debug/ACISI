/**
 * Demo links: acisi.co.ke/patient?demo=<key> shows only that demo clinic in
 * the clinic picker (demo clinics are never listed otherwise). The key is
 * kept for the rest of this browser tab, so it survives the trip through
 * login.
 */
const STORAGE_KEY = 'acisi.demoKey';

export function rememberDemoKeyFromUrl(): void {
  const key = new URLSearchParams(window.location.search).get('demo');
  if (!key) return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, key);
  } catch {
    // Storage blocked: the key still works while it's in the URL.
  }
}

export function currentDemoKey(): string | null {
  const fromUrl = new URLSearchParams(window.location.search).get('demo');
  if (fromUrl) return fromUrl;
  try {
    return window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}
