export const conversationBottomThreshold = 80;

type ConversationScrollMetrics = Pick<
  HTMLElement,
  "clientHeight" | "scrollHeight" | "scrollTop"
>;

export const conversationIsAwayFromBottom = (
  scroller: ConversationScrollMetrics,
) =>
  scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight >
    conversationBottomThreshold;

export const scrollConversationToBottom = (scroller: HTMLElement) => {
  if (typeof scroller.scrollTo === "function") {
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
    return;
  }
  scroller.scrollTop = scroller.scrollHeight;
};
