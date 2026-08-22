const describeStartupError = (value: unknown): string => {
  if (value instanceof Error) {
    return `${value.name}: ${value.message}\n\n${value.stack ?? ""}`;
  }
  return String(value);
};

const revealStartupError = (value: unknown): void => {
  const root = document.getElementById("root");
  if (!root || root.childElementCount > 0) return;
  const error = document.createElement("pre");
  error.id = "briar-startup-error";
  error.style.cssText =
    "box-sizing:border-box;min-height:100vh;margin:0;padding:32px;" +
    "overflow:auto;white-space:pre-wrap;color:#6b2424;background:#f7f7f3;" +
    "font:13px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace";
  error.textContent = `BRIAR STARTUP ERROR\n\n${describeStartupError(value)}`;
  root.replaceChildren(error);
};

window.addEventListener("error", (event) => {
  revealStartupError(event.error ?? event.message);
});
window.addEventListener("unhandledrejection", (event) => {
  revealStartupError(event.reason);
});
window.setTimeout(() => {
  const root = document.getElementById("root");
  if (!root || root.childElementCount > 0) return;
  revealStartupError("The application bundle did not initialize within 5 seconds.");
}, 5_000);
