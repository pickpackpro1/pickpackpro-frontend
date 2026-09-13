const isTouchDevice = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(pointer: coarse)')?.matches || navigator.maxTouchPoints > 1);

const openInNewTab = (url) => {
  const opened = window.open(url, '_blank', 'noopener');
  return opened ? 'opened' : 'blocked';
};

// Opens the browser print window for a label PDF. Phones can't print a PDF from a hidden frame,
// so there the PDF opens in a new tab and staff print it with the browser's Share / Print.
export const printLabelUrl = async (url) => {
  if (!url) throw new Error('No label file to print.');
  if (isTouchDevice()) return openInNewTab(url);

  let blobUrl = '';
  try {
    // Same-origin blob so the frame's print() isn't blocked by the storage domain.
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Label download failed (${response.status})`);
    blobUrl = URL.createObjectURL(await response.blob());
  } catch {
    return openInNewTab(url);
  }

  return new Promise((resolve) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
    const cleanup = () => {
      frame.remove();
      URL.revokeObjectURL(blobUrl);
    };
    frame.onload = () => {
      try {
        frame.contentWindow.focus();
        frame.contentWindow.print();
        resolve('printed');
      } catch {
        resolve(openInNewTab(url));
      }
      // Keep the frame alive long enough for the print dialog to spool the document.
      setTimeout(cleanup, 60_000);
    };
    frame.src = blobUrl;
    document.body.appendChild(frame);
  });
};
