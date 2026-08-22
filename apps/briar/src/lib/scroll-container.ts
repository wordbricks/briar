export function scrollContainerToEnd(container: HTMLElement | null) {
  if (!container) return;
  container.scrollTop = Math.max(
    0,
    container.scrollHeight - container.clientHeight,
  );
}

export function scrollElementToCenter(
  container: HTMLElement | null,
  element: HTMLElement | null,
) {
  if (!container || !element) return;

  const containerRect = container.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();
  const elementTop =
    container.scrollTop + elementRect.top - containerRect.top;
  const centeredTop =
    elementTop - (container.clientHeight - elementRect.height) / 2;
  const maxScrollTop = Math.max(
    0,
    container.scrollHeight - container.clientHeight,
  );

  container.scrollTop = Math.min(maxScrollTop, Math.max(0, centeredTop));
}
