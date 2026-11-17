// Applies the stored theme before first paint. Served from /theme.js so the CSP needs no
// 'unsafe-inline' for scripts (docs/0-SECURITY.md §3).
(() => {
  try {
    const stored = localStorage.getItem('ri-theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const dark = stored === 'dark' || (stored !== 'light' && prefersDark);
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  } catch {
    // A blocked localStorage must not break the page.
  }
})();
