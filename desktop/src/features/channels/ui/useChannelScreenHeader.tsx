import * as React from "react";

import { ChannelScreenHeader } from "@/features/channels/ui/ChannelScreenHeader";

type ChannelScreenHeaderProps = React.ComponentProps<
  typeof ChannelScreenHeader
>;

export function useChannelScreenHeader({
  activeChannel,
  activeChannelEphemeralDisplay,
  activeChannelTitle,
  actionsVariant,
  activeDmAvatarUrl,
  activeDmHeaderParticipants,
  activeDmPresenceStatus,
  chromeWrapperRef,
  currentPubkey,
  headerEndActions,
  isAddBotOpen,
  isJoining,
  onAddBotOpenChange,
  onJoinChannel,
  onManageChannel,
  onToggleMembers,
  showHeaderContent,
  transparentChrome,
}: ChannelScreenHeaderProps) {
  return React.useMemo(
    () => (
      <ChannelScreenHeader
        activeChannel={activeChannel}
        activeChannelEphemeralDisplay={activeChannelEphemeralDisplay}
        activeChannelTitle={activeChannelTitle}
        actionsVariant={actionsVariant}
        activeDmAvatarUrl={activeDmAvatarUrl}
        activeDmHeaderParticipants={activeDmHeaderParticipants}
        activeDmPresenceStatus={activeDmPresenceStatus}
        chromeWrapperRef={chromeWrapperRef}
        currentPubkey={currentPubkey}
        headerEndActions={headerEndActions}
        isAddBotOpen={isAddBotOpen}
        isJoining={isJoining}
        onAddBotOpenChange={onAddBotOpenChange}
        onJoinChannel={onJoinChannel}
        onManageChannel={onManageChannel}
        onToggleMembers={onToggleMembers}
        showHeaderContent={showHeaderContent}
        transparentChrome={transparentChrome}
      />
    ),
    [
      activeChannel,
      activeChannelEphemeralDisplay,
      activeChannelTitle,
      actionsVariant,
      activeDmAvatarUrl,
      activeDmHeaderParticipants,
      activeDmPresenceStatus,
      chromeWrapperRef,
      currentPubkey,
      headerEndActions,
      isAddBotOpen,
      isJoining,
      onAddBotOpenChange,
      onJoinChannel,
      onManageChannel,
      onToggleMembers,
      showHeaderContent,
      transparentChrome,
    ],
  );
}
