export async function loadExecutionWorkerSettings<Remote, Local>({
  loadLocal,
  loadRemote,
  syncLabels,
}: {
  loadLocal: () => Promise<Local>;
  loadRemote: () => Promise<Remote>;
  syncLabels?: () => Promise<unknown>;
}): Promise<[Remote, Local]> {
  if (syncLabels) {
    void Promise.resolve().then(syncLabels).catch(() => {
      // Label maintenance must not block reading Worker status.
    });
  }
  return Promise.all([loadRemote(), loadLocal()]);
}
