export const DEFAULT_SIDEBAR_WIDTH: number;
export const MIN_SIDEBAR_WIDTH: number;
export function sidebarWidthLimit(viewportWidth: number): number;
export function clampSidebarWidth(width: number, viewportWidth: number): number;
export function readSidebarWidth(
  value: string | null,
  viewportWidth: number,
): number;
