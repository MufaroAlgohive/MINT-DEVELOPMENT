/**
 * Admin Preview Mode
 *
 * The Mint CRM signals admin preview in two ways:
 *   1. Appends ?admin_preview=1 to the magic-link redirect URL.
 *   2. Sends postMessage({ type: 'MINT_ADMIN_PREVIEW' }) into the iframe
 *      every 2 s for 30 s (Supabase's router.replace() strips query params
 *      before useEffect can read them, so the postMessage is the reliable path).
 *
 * initAdminPreview()             — call once on app load (checks URL param)
 * listenForAdminPreviewMessage() — call once on app load (listens for postMessage)
 * isAdminPreview()               — call anywhere to check the flag
 * clearAdminPreview()            — call on sign-out to reset the flag
 */

export function initAdminPreview() {
  if (typeof window === 'undefined') return;
  if (new URLSearchParams(window.location.search).has('admin_preview')) {
    localStorage.setItem('mint_admin_preview', '1');
  }
}

export function listenForAdminPreviewMessage() {
  if (typeof window === 'undefined') return () => {};
  const handler = (event) => {
    if (event.data?.type === 'MINT_ADMIN_PREVIEW') {
      localStorage.setItem('mint_admin_preview', '1');
    }
  };
  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}

export function isAdminPreview() {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem('mint_admin_preview') === '1';
}

export function clearAdminPreview() {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('mint_admin_preview');
  }
}
