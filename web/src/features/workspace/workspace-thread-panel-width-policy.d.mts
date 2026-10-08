export const DEFAULT_THREAD_PANEL_WIDTH: number;
export const MIN_THREAD_PANEL_WIDTH: number;
export function threadPanelWidthLimit(viewportWidth: number): number;
export function clampThreadPanelWidth(
  width: number,
  viewportWidth: number,
): number;
export function readThreadPanelWidth(
  value: string | null,
  viewportWidth: number,
): number;
