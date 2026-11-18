/**
 * What the person sees a second after sending the message, when the server's
 * own choice has not already landed on it. The server picks a contextual emoji
 * from the message itself at receipt; this Worker only covers the cases where
 * that failed, so it publishes the placeholder and nothing else.
 */
export const DM_ACKNOWLEDGEMENT_PLACEHOLDER = "👀";

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;

/** A reaction is owed only on a person's own message in a direct message. */
export function dmAcknowledgementOwed(
  snapshot: Record<string, unknown>,
  triggerId: string,
) {
  if (record(snapshot.channel)?.kind !== "dm" || !Array.isArray(snapshot.messages)) return false;
  const trigger = snapshot.messages.map(record)
    .find((message) => message?.id === triggerId);
  return record(trigger?.author)?.type === "user";
}

/**
 * Publishes the placeholder without gating the body: the publication is
 * bounded on its own, a failure is reported and dropped, and stopping the
 * reply cancels a publication still in flight.
 */
export function startDmAcknowledgement(input: {
  publish: (emoji: string, signal: AbortSignal) => Promise<unknown>;
  signal: AbortSignal;
  /**
   * The placeholder reached the server. This is the reply's only account of
   * when the person actually saw that Briar had read the message, so the
   * timeline can report it rather than the moment the publish was started.
   */
  onPlaceholderPublished?: () => void;
  onError?: (error: unknown) => void;
}) {
  const publication = new AbortController();
  void Promise.resolve()
    .then(() => input.publish(DM_ACKNOWLEDGEMENT_PLACEHOLDER, AbortSignal.any([
      input.signal, publication.signal, AbortSignal.timeout(3000),
    ])))
    .then(
      () => { input.onPlaceholderPublished?.(); },
      (error: unknown) => { input.onError?.(error); },
    );
  return () => { publication.abort(); };
}
