'use client';

/** The one place a file reaches the user's disk (docs/13-EXPORT-MANAGER.md §1). */
export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // give the browser a moment to start the download before the URL disappears
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
