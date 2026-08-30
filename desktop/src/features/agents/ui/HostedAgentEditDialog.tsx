import * as React from "react";
import { ImagePlus } from "lucide-react";

import { publishHostedAgentConfig } from "@/features/agents/lib/hostedAgentConfig";
import { getHostedAgentRuntimePresentation } from "@/features/agents/lib/hostedAgentPresentation";
import { useAvatarUpload } from "@/features/profile/useAvatarUpload";
import type { RelayAgent } from "@/shared/api/types";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { UserAvatar } from "@/shared/ui/UserAvatar";

export function HostedAgentEditDialog({
  agent,
  onOpenChange,
  onSaved,
  open,
}: {
  agent: RelayAgent;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<void> | void;
  open: boolean;
}) {
  const runtime = getHostedAgentRuntimePresentation(agent);
  const [name, setName] = React.useState(agent.name);
  const [avatarUrl, setAvatarUrl] = React.useState(agent.avatarUrl ?? "");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const avatarUpload = useAvatarUpload({
    onUploadSuccess: setAvatarUrl,
  });

  React.useEffect(() => {
    if (!open) return;
    setName(agent.name);
    setAvatarUrl(agent.avatarUrl ?? "");
    setError(null);
  }, [agent, open]);

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent data-testid="hosted-agent-edit-dialog">
        <DialogHeader>
          <DialogTitle>Edit hosted agent</DialogTitle>
          <DialogDescription>
            Name and picture update everywhere in Buzz. Hosted runtime settings
            are shown here for compatibility and changed in the web app.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div className="flex items-center gap-4">
            <UserAvatar
              avatarUrl={avatarUrl || null}
              className="h-16 w-16 shrink-0"
              displayName={name || agent.name}
            />
            <div className="space-y-2">
              <Button
                disabled={avatarUpload.isUploading || saving}
                onClick={avatarUpload.openPicker}
                type="button"
                variant="outline"
              >
                <ImagePlus />
                {avatarUpload.isUploading ? "Uploading…" : "Choose picture"}
              </Button>
              <input
                accept="image/gif,image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={avatarUpload.handleFileChange}
                ref={avatarUpload.inputRef}
                type="file"
              />
              {avatarUpload.errorMessage ? (
                <p className="text-xs text-destructive">
                  {avatarUpload.errorMessage}
                </p>
              ) : avatarUrl !== (agent.avatarUrl ?? "") ? (
                <p className="text-xs text-muted-foreground" role="status">
                  Picture ready. Save the agent to apply it everywhere.
                </p>
              ) : null}
              {avatarUrl ? (
                <Button
                  disabled={avatarUpload.isUploading || saving}
                  onClick={() => setAvatarUrl("")}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  Remove picture
                </Button>
              ) : null}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="hosted-agent-name">
              Agent name
            </label>
            <Input
              data-testid="hosted-agent-name"
              id="hosted-agent-name"
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
              value={name}
            />
            <p className="text-xs text-muted-foreground">
              Mentions, channel messages, member lists, and this profile use the
              same name.
            </p>
          </div>

          <div className="space-y-3" data-testid="hosted-agent-runtime">
            <p className="text-sm font-medium">Current runtime</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Model</dt>
              <dd>{runtime.modelName ?? "—"}</dd>
              <dt className="text-muted-foreground">Reasoning effort</dt>
              <dd>{runtime.effort ?? "—"}</dd>
            </dl>
            <p className="text-xs text-muted-foreground">
              Runtime settings are managed in Buzz on the web. Desktop never
              writes a second model or effort preference.
            </p>
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button
            disabled={saving}
            onClick={() => onOpenChange(false)}
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
          <Button
            data-testid="hosted-agent-save"
            disabled={saving || avatarUpload.isUploading || !name.trim()}
            onClick={async () => {
              setSaving(true);
              setError(null);
              try {
                await publishHostedAgentConfig({
                  pubkey: agent.pubkey,
                  name,
                  avatarUrl: avatarUrl || null,
                  model: agent.model ?? null,
                });
                await onSaved();
                onOpenChange(false);
              } catch (caught) {
                setError(
                  caught instanceof Error
                    ? caught.message
                    : "Could not save the hosted agent.",
                );
              } finally {
                setSaving(false);
              }
            }}
            type="button"
          >
            {saving ? "Saving…" : "Save agent"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
