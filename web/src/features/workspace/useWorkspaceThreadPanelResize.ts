import { useResizablePanelWidth } from "./useResizablePanelWidth";
import {
  clampThreadPanelWidth,
  DEFAULT_THREAD_PANEL_WIDTH,
  MIN_THREAD_PANEL_WIDTH,
  readThreadPanelWidth,
  threadPanelWidthLimit,
} from "./workspace-thread-panel-width-policy.mjs";

const THREAD_PANEL_POLICY = {
  defaultWidth: DEFAULT_THREAD_PANEL_WIDTH,
  minWidth: MIN_THREAD_PANEL_WIDTH,
  limit: threadPanelWidthLimit,
  clamp: clampThreadPanelWidth,
  read: readThreadPanelWidth,
};

/** The thread panel docks on the right, so its handle sits on its left edge. */
export function useWorkspaceThreadPanelResize(pubkey: string) {
  return useResizablePanelWidth({
    storageKey: `buzz-web:thread-panel-width:v1:${pubkey}`,
    policy: THREAD_PANEL_POLICY,
    cssVariable: "--workspace-thread-width",
    label: "Resize thread panel",
    edge: "left",
  });
}
