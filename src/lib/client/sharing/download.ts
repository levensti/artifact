/**
 * Tiny download helper — creates a Blob, pokes an anchor, cleans up.
 * Kept separate so tests can avoid pulling in DOM APIs.
 */

export function triggerDownload(
  filename: string,
  contents: string,
  mimeType: string,
): void {
  if (typeof window === "undefined") {
    throw new Error("triggerDownload: only available in the browser");
  }
  const blob = new Blob([contents], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // Give the browser a tick to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
