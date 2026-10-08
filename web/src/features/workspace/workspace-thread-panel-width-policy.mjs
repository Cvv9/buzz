export const DEFAULT_THREAD_PANEL_WIDTH = 384;
export const MIN_THREAD_PANEL_WIDTH = 320;
export function threadPanelWidthLimit(viewportWidth) {
  return Math.max(MIN_THREAD_PANEL_WIDTH, Math.min(720, viewportWidth - 560));
}
export function clampThreadPanelWidth(width, viewportWidth) {
  return Math.round(
    Math.max(
      MIN_THREAD_PANEL_WIDTH,
      Math.min(
        threadPanelWidthLimit(viewportWidth),
        Number.isFinite(width) ? width : DEFAULT_THREAD_PANEL_WIDTH,
      ),
    ),
  );
}
export function readThreadPanelWidth(value, viewportWidth) {
  return clampThreadPanelWidth(
    value === null || value.trim() === ""
      ? DEFAULT_THREAD_PANEL_WIDTH
      : Number(value),
    viewportWidth,
  );
}
