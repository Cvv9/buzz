import * as React from "react";
import { ImagePlus } from "lucide-react";

import { publishHostedAgentConfig } from "@/features/agents/lib/hostedAgentConfig";
import { hostedAgentModelGroups } from "@/features/agents/lib/hostedAgentModelCatalog";
import { switchManagedAgentModel } from "@/shared/api/agentControl";
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
  const modelGroups = React.useMemo(
    () => hostedAgentModelGroups(agent.models),
    [agent.models],
  );
  const knownModelIds = React.useMemo(
    () =>
      new Set(
        modelGroups.flatMap((group) => group.options.map(({ id }) => id)),
      ),
    [modelGroups],
  );
  const [name, setName] = React.useState(agent.name);
  const [avatarUrl, setAvatarUrl] = React.useState(agent.avatarUrl ?? "");
  const knownModel = agent.model ? knownModelIds.has(agent.model) : false;
  const [modelChoice, setModelChoice] = React.useState(
    agent.model ? (knownModel ? agent.model : "custom") : "runtime-default",
  );
  const [customModel, setCustomModel] = React.useState(
    agent.model && !knownModel ? agent.model : "",
  );
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const avatarUpload = useAvatarUpload({
    onUploadSuccess: setAvatarUrl,
  });

  React.useEffect(() => {
    if (!open) return;
    setName(agent.name);
    setAvatarUrl(agent.avatarUrl ?? "");
    const nextKnown = agent.model ? knownModelIds.has(agent.model) : false;
    setModelChoice(
      agent.model ? (nextKnown ? agent.model : "custom") : "runtime-default",
    );
    setCustomModel(agent.model && !nextKnown ? agent.model : "");
    setError(null);
  }, [agent, knownModelIds, open]);

  const selectedModel =
    modelChoice === "runtime-default"
      ? null
      : modelChoice === "custom"
        ? customModel.trim() || null
        : modelChoice;

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent data-testid="hosted-agent-edit-dialog">
        <DialogHeader>
          <DialogTitle>Edit hosted agent</DialogTitle>
          <DialogDescription>
            Name and picture update everywhere in Buzz. The model is saved for
            this agent instead of changing the global agent default.
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

          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="hosted-agent-model">
              Model
            </label>
            <select
              className="flex h-10 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-testid="hosted-agent-model"
              id="hosted-agent-model"
              onChange={(event) => setModelChoice(event.target.value)}
              value={modelChoice}
            >
              <option value="runtime-default">Runtime default</option>
              {modelGroups.map((group) => (
                <optgroup key={group.id} label={group.label}>
                  {group.options.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name?.trim() || option.id}
                    </option>
                  ))}
                </optgroup>
              ))}
              <option value="custom">Custom model…</option>
            </select>
            {modelChoice === "custom" ? (
              <Input
                aria-label="Custom model ID"
                onChange={(event) => setCustomModel(event.target.value)}
                placeholder="Provider model ID"
                value={customModel}
              />
            ) : null}
            <p className="text-xs text-muted-foreground">
              Claude Code and Codex choices remain available while older agents
              load their live catalog. Runtime default follows the agent&apos;s
              current provider configuration.
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
            disabled={
              saving ||
              avatarUpload.isUploading ||
              !name.trim() ||
              (modelChoice === "custom" && !customModel.trim())
            }
            onClick={async () => {
              setSaving(true);
              setError(null);
              try {
                await publishHostedAgentConfig({
                  pubkey: agent.pubkey,
                  name,
                  avatarUrl: avatarUrl || null,
                  model: selectedModel,
                });
                if (selectedModel && agent.channelIds.length > 0) {
                  await Promise.all(
                    agent.channelIds.map((channelId) =>
                      switchManagedAgentModel(
                        agent.pubkey,
                        channelId,
                        selectedModel,
                      ),
                    ),
                  );
                }
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
