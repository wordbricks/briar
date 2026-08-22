const activeAttribute = "data-briar-remote-desktop-active";

export function setRemoteDesktopKeyboardCapture(active: boolean) {
  if (active) {
    document.documentElement.setAttribute(activeAttribute, "true");
  } else {
    document.documentElement.removeAttribute(activeAttribute);
  }
}

export function remoteDesktopCapturesKeyboard() {
  return document.documentElement.getAttribute(activeAttribute) === "true";
}
