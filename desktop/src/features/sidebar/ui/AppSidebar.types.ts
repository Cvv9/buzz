// Group keys mirror the web workspace's channel grouping (favorites /
// workspace / projects) rather than upstream's starred / channels split.
export type CollapsibleSidebarGroup =
  | "favorites"
  | "workspace"
  | "projects"
  | "forums"
  | "directMessages";

export type CreateChannelKind = "stream" | "forum";
