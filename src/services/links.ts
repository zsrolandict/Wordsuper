/**
 * Opens a page outside the task pane (a law on njt.hu, a search for a court decision). Desktop Word opens it in the
 * default browser (OpenBrowserWindowApi); elsewhere a new tab. Only the reference itself is in the address.
 */
export function openExternal(url: string) {
  try {
    if (typeof Office !== 'undefined' && Office.context?.requirements?.isSetSupported('OpenBrowserWindowApi', '1.1') && Office.context.ui?.openBrowserWindow) {
      Office.context.ui.openBrowserWindow(url);
      return;
    }
  } catch {
    // fall back to a new tab
  }
  window.open(url, '_blank', 'noopener');
}
