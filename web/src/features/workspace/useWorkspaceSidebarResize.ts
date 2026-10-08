import { useResizablePanelWidth } from "./useResizablePanelWidth";
import {
  clampSidebarWidth,
  DEFAULT_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  readSidebarWidth,
  sidebarWidthLimit,
} from "./workspace-sidebar-width-policy.mjs";

const SIDEBAR_POLICY = {
  defaultWidth: DEFAULT_SIDEBAR_WIDTH,
  minWidth: MIN_SIDEBAR_WIDTH,
  limit: sidebarWidthLimit,
  clamp: clampSidebarWidth,
  read: readSidebarWidth,
};

/** Desktop width is device-local; channel sections and access stay relay-backed. */
export function useWorkspaceSidebarResize(pubkey: string) {
  return useResizablePanelWidth({
    storageKey: `buzz-web:sidebar-width:v1:${pubkey}`,
    policy: SIDEBAR_POLICY,
    cssVariable: "--workspace-sidebar-width",
    label: "Resize workspace sidebar",
    edge: "right",
  });
}
