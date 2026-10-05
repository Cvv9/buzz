export const DEFAULT_SIDEBAR_WIDTH = 272;
export const MIN_SIDEBAR_WIDTH = 224;
export function sidebarWidthLimit(viewportWidth) {
  return Math.max(MIN_SIDEBAR_WIDTH, Math.min(480, viewportWidth - 360));
}
export function clampSidebarWidth(width, viewportWidth) {
  return Math.round(
    Math.max(
      MIN_SIDEBAR_WIDTH,
      Math.min(
        sidebarWidthLimit(viewportWidth),
        Number.isFinite(width) ? width : DEFAULT_SIDEBAR_WIDTH,
      ),
    ),
  );
}
export function readSidebarWidth(value, viewportWidth) {
  return clampSidebarWidth(
    value === null || value.trim() === ""
      ? DEFAULT_SIDEBAR_WIDTH
      : Number(value),
    viewportWidth,
  );
}
