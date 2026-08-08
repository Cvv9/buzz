import type { WorkspaceChannel, WorkspaceChannelUpdate } from "./workspace-api";

export type WorkspaceChannelDraft = Pick<
  WorkspaceChannel,
  "name" | "about" | "catalogSection" | "visibility"
>;

/** Seed an editor from the relay projection after a successful refresh. */
export function workspaceChannelDraft(
  channel: WorkspaceChannel,
): WorkspaceChannelDraft {
  return {
    name: channel.name,
    about: channel.about,
    catalogSection: channel.catalogSection,
    visibility: channel.visibility,
  };
}

/**
 * Build an intentionally sparse metadata event. Editors can stay open while
 * other admins update a channel; sending every stale input would overwrite
 * those unrelated changes.
 */
export function changedWorkspaceChannelUpdate(
  channel: WorkspaceChannel,
  draft: WorkspaceChannelDraft,
): WorkspaceChannelUpdate {
  const update: WorkspaceChannelUpdate = {};
  const name = draft.name.trim();
  const about = draft.about.trim();
  const catalogSection = draft.catalogSection.trim() || null;
  const currentCatalogSection = channel.catalogSection.trim() || null;

  if (name !== channel.name.trim()) update.name = name;
  if (about !== channel.about.trim()) update.about = about;
  if (catalogSection !== currentCatalogSection) {
    update.catalogSection = catalogSection;
  }
  if (draft.visibility !== channel.visibility)
    update.visibility = draft.visibility;
  return update;
}
