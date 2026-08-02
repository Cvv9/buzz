import {
  KIND_DELETION,
  KIND_NIP29_DELETE,
  KIND_STREAM_MESSAGE,
  KIND_STREAM_MESSAGE_EDIT,
  KIND_STREAM_MESSAGE_V2,
  type WorkspaceMessage,
} from "./workspace-api";

export type TimelineMessage = WorkspaceMessage & {
  edited?: boolean;
};

function tagValue(event: WorkspaceMessage, name: string): string | undefined {
  return event.tags.find((tag) => tag[0] === name)?.[1];
}

export function materializeMessages(
  events: WorkspaceMessage[],
): TimelineMessage[] {
  const deleted = new Set(
    events
      .filter(
        (event) =>
          event.kind === KIND_DELETION || event.kind === KIND_NIP29_DELETE,
      )
      .map((event) => tagValue(event, "e"))
      .filter((value): value is string => Boolean(value)),
  );
  const edits = new Map<string, WorkspaceMessage>();
  for (const event of events) {
    if (event.kind !== KIND_STREAM_MESSAGE_EDIT) continue;
    const target = tagValue(event, "e");
    if (!target) continue;
    const current = edits.get(target);
    if (!current || event.created_at >= current.created_at) {
      edits.set(target, event);
    }
  }
  return events
    .filter(
      (event) =>
        event.kind === KIND_STREAM_MESSAGE ||
        event.kind === KIND_STREAM_MESSAGE_V2,
    )
    .filter((event) => !deleted.has(event.id))
    .map((event) => {
      const edit = edits.get(event.id);
      return edit ? { ...event, content: edit.content, edited: true } : event;
    });
}
