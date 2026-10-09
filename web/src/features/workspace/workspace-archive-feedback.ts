import { toast } from "sonner";

/** User feedback for relay-accepted and failed personal conversation archives. */
export const conversationArchiveFeedback = {
  success: () => toast.success("Conversation archived for you."),
  error: () =>
    toast.error(
      "Couldn't archive this conversation. Your chat is still available; try again.",
    ),
};
