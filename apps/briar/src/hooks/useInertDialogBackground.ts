import { useEffect, type RefObject } from "react";

/*
  A hand-rolled modal dialog such as the New issue dialog renders inline in the
  app shell instead of through a portal. While it is open, every other control
  of the shell is still in the accessibility tree, still in the tab order, and
  still a hit target behind the backdrop, so accessibility-ref lookups match
  unrelated controls (the header "New issue" button, column add buttons, the
  sidebar) and clicks land on elements obscured by the backdrop.

  Setting `inert` on each sibling subtree between the dialog and the app frame
  removes exactly that background from assistive technology, keyboard focus,
  and pointer events, without moving the dialog in the DOM — companion CSS such
  as `.companion-shell .dialog-backdrop` keeps applying — and without touching
  body-level portals such as the toast viewport, whose live regions must stay
  announced.
*/
export function useInertDialogBackground(dialogRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    // The desktop frame also carries the status bar; the companion shell is its
    // own root. Bare test renders have neither, so stop at the dialog's parent.
    const boundary =
      dialog.closest(".desktop-app-frame") ??
      dialog.closest(".app-shell") ??
      dialog.parentElement;
    if (!boundary || boundary === dialog) return;
    const inerted: HTMLElement[] = [];
    for (let node: Element | null = dialog; node && node !== boundary; node = node.parentElement) {
      for (const sibling of Array.from(node.parentElement?.children ?? [])) {
        // Leave subtrees that are already inert (the collapsed sidebar) alone so
        // their own owner keeps controlling the attribute.
        if (sibling === node || !(sibling instanceof HTMLElement) || sibling.hasAttribute("inert")) continue;
        sibling.setAttribute("inert", "");
        inerted.push(sibling);
      }
    }
    return () => {
      for (const element of inerted) element.removeAttribute("inert");
    };
  }, [dialogRef]);
}
