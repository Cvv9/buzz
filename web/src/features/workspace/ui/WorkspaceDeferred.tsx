import { lazy, Suspense, type ComponentProps } from "react";

const LazyWorkspaceAgents = lazy(() =>
  import("./WorkspaceAgents").then((module) => ({
    default: module.WorkspaceAgents,
  })),
);

export function WorkspaceAgents(
  props: ComponentProps<typeof LazyWorkspaceAgents>,
) {
  return (
    <Suspense
      fallback={
        <p role="status" className="p-4 text-sm text-muted-foreground">
          Loading…
        </p>
      }
    >
      <LazyWorkspaceAgents {...props} />
    </Suspense>
  );
}

const LazyWorkspaceGuide = lazy(() =>
  import("./WorkspaceGuide").then((module) => ({
    default: module.WorkspaceGuide,
  })),
);

export function WorkspaceGuide(
  props: ComponentProps<typeof LazyWorkspaceGuide>,
) {
  return (
    <Suspense
      fallback={
        <p role="status" className="p-4 text-sm text-muted-foreground">
          Loading…
        </p>
      }
    >
      <LazyWorkspaceGuide {...props} />
    </Suspense>
  );
}

const LazyWorkspaceContentDialogs = lazy(() =>
  import("./WorkspaceContentDialogs").then((module) => ({
    default: module.WorkspaceContentDialogs,
  })),
);

export function WorkspaceContentDialogs(
  props: ComponentProps<typeof LazyWorkspaceContentDialogs>,
) {
  return (
    <Suspense
      fallback={
        <p role="status" className="p-4 text-sm text-muted-foreground">
          Loading…
        </p>
      }
    >
      <LazyWorkspaceContentDialogs {...props} />
    </Suspense>
  );
}

const LazyWorkspaceChannelSettings = lazy(() =>
  import("./WorkspaceChannelSettings").then((module) => ({
    default: module.WorkspaceChannelSettings,
  })),
);

export function WorkspaceChannelSettings(
  props: ComponentProps<typeof LazyWorkspaceChannelSettings>,
) {
  return (
    <Suspense
      fallback={
        <p role="status" className="p-4 text-sm text-muted-foreground">
          Loading…
        </p>
      }
    >
      <LazyWorkspaceChannelSettings {...props} />
    </Suspense>
  );
}

const LazyWorkspaceNewMessage = lazy(() =>
  import("./WorkspaceNewMessage").then((module) => ({
    default: module.WorkspaceNewMessage,
  })),
);

export function WorkspaceNewMessage(
  props: ComponentProps<typeof LazyWorkspaceNewMessage>,
) {
  return (
    <Suspense
      fallback={
        <p role="status" className="p-4 text-sm text-muted-foreground">
          Loading…
        </p>
      }
    >
      <LazyWorkspaceNewMessage {...props} />
    </Suspense>
  );
}
