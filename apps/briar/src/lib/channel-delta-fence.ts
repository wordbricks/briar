export function channelDeltaResponseIsCurrent(input: {
  stopped: boolean;
  requestedCursor: number;
  currentCursor: number;
  requestedDataVersion: number;
  currentDataVersion: number;
  authoritativeLoadPending: boolean;
}) {
  return !input.stopped &&
    input.requestedCursor === input.currentCursor &&
    input.requestedDataVersion === input.currentDataVersion &&
    !input.authoritativeLoadPending;
}

export function companionDeltaResponseIsCurrent(input: {
  stopped: boolean;
  requestedSelectionVersion: number;
  currentSelectionVersion: number;
}) {
  return !input.stopped &&
    input.requestedSelectionVersion === input.currentSelectionVersion;
}
