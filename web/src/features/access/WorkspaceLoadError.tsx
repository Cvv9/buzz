import { Button } from "@/shared/ui/button";

/** A failed read must never masquerade as first-time account setup. */
export function WorkspaceLoadError({
  title,
  description,
  onRetry,
  onRecovery,
}: {
  title: string;
  description: string;
  onRetry: () => void;
  onRecovery?: () => void;
}) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-6 text-foreground">
      <div className="w-full max-w-md space-y-4" role="alert">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="text-sm leading-6 text-muted-foreground">{description}</p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={onRetry}>Try again</Button>
          {onRecovery ? (
            <Button variant="outline" onClick={onRecovery}>
              Use recovery key
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
