/** @vitest-environment jsdom */

import { useEffect, useState, type ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import {
  AppKeyboardCommandProvider,
  useAppKeyboardCommandScope,
} from "../../hooks/appKeyboardCommands";
import { createReactTestRoot, flush } from "../../test/react";
import { createRenderCounter } from "../../test/render-count";
import { KeepAliveSlot } from "./KeepAliveSlot";

/*
  What a slot does with the answer the policy gives it.

  The mechanism is `<Activity>`, so most of these assert React's contract rather
  than ours — but they are the contract the whole feature stands on, and a React
  upgrade that changed any of them would otherwise show up as a ghost keyboard
  shortcut or a focus trap in a page nobody can see.
*/

const dispatchPaletteKey = (): KeyboardEvent => {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    code: "KeyK",
    key: "k",
    metaKey: true,
  });
  document.body.dispatchEvent(event);
  return event;
};

const hiddenSlot = (container: HTMLElement, key: string) =>
  container.querySelector<HTMLElement>(`[data-page-slot="${key}"][inert]`);

const slotOf = (container: HTMLElement, key: string) =>
  container.querySelector<HTMLElement>(`[data-page-slot="${key}"]`);

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.localStorage.clear();
});

describe("KeepAliveSlot", () => {
  it("keeps a hidden page's component, its state and its DOM", async () => {
    let instances = 0;
    const effects: string[] = [];
    const view = createReactTestRoot({ attachToDocument: true });

    function Page() {
      // A lazy initializer runs once per component instance, so this counts
      // exactly what a remount would restart.
      const [instance] = useState(() => {
        instances += 1;
        return instances;
      });
      useEffect(() => {
        effects.push("mounted");
        return () => {
          effects.push("unmounted");
        };
      }, []);
      return <output>{`instance ${instance}`}</output>;
    }

    const render = (visible: boolean) =>
      view.render(
        <KeepAliveSlot pageKey="board:team-1" visible={visible}>
          <Page />
        </KeepAliveSlot>,
      );

    await render(true);
    const node = slotOf(view.container, "board:team-1")?.firstElementChild;
    expect(node).toBeTruthy();
    expect(view.container.textContent).toBe("instance 1");

    await render(false);
    await render(true);

    // The same component instance, holding the same state, in the same DOM
    // node — a return is a reveal, not a rebuild.
    expect(instances).toBe(1);
    expect(view.container.textContent).toBe("instance 1");
    expect(slotOf(view.container, "board:team-1")?.firstElementChild).toBe(node);
    /*
      Its effects, on the other hand, ran again — `<Activity>` tears them down
      on the way out and sets them up on the way back. That is the half that
      makes keeping a page alive safe rather than haunted: a hidden page holds
      no subscription, no timer and no keyboard scope, and a revealed one
      re-reads whatever it needs.
    */
    expect(effects).toEqual(["mounted", "unmounted", "mounted"]);

    await view.cleanup();
  });

  it("takes a hidden page out of the layout and out of reach of focus", async () => {
    const view = createReactTestRoot({ attachToDocument: true });
    const render = (visible: boolean) =>
      view.render(
        <KeepAliveSlot pageKey="inbox:org-1" visible={visible}>
          <button type="button">Open</button>
        </KeepAliveSlot>,
      );

    await render(true);
    expect(hiddenSlot(view.container, "inbox:org-1")).toBeNull();
    expect(slotOf(view.container, "inbox:org-1")?.style.display).toBe("");

    await render(false);
    const hidden = hiddenSlot(view.container, "inbox:org-1");
    // `display:none` is what removes the box, and with it the page's place in
    // the focus order; `inert` says the same thing to anything that walks the
    // tree instead of the layout.
    expect(hidden).not.toBeNull();
    expect(hidden?.style.display).toBe("none");
    expect(hidden?.hasAttribute("inert")).toBe(true);

    await render(true);
    expect(slotOf(view.container, "inbox:org-1")?.style.display).toBe("");
    expect(slotOf(view.container, "inbox:org-1")?.hasAttribute("inert")).toBe(
      false,
    );

    await view.cleanup();
  });

  it("stops a hidden page's keyboard scope from answering", async () => {
    const handled: string[] = [];
    const view = createReactTestRoot({ attachToDocument: true });

    function Page() {
      useAppKeyboardCommandScope({
        fallthrough: true,
        handlers: {
          openCommandPalette: {
            run: () => {
              handled.push("page");
              return "handled";
            },
          },
        },
        id: "kept-page",
        priority: 100,
      });
      return <div>page</div>;
    }

    const render = (visible: boolean) =>
      view.render(
        <AppKeyboardCommandProvider>
          <KeepAliveSlot pageKey="board:team-1" visible={visible}>
            <Page />
          </KeepAliveSlot>
        </AppKeyboardCommandProvider>,
      );

    await render(true);
    expect(dispatchPaletteKey()).toHaveProperty("defaultPrevented", true);
    expect(handled).toEqual(["page"]);

    await render(false);
    // The scope was registered by a layout effect, and `<Activity>` unmounts a
    // hidden page's effects: the command reaches nobody.
    expect(dispatchPaletteKey()).toHaveProperty("defaultPrevented", false);
    expect(handled).toEqual(["page"]);

    await render(true);
    expect(dispatchPaletteKey()).toHaveProperty("defaultPrevented", true);
    expect(handled).toEqual(["page", "page"]);

    await view.cleanup();
  });

  it("does not redraw a hidden page when the props above it change", async () => {
    const renders = createRenderCounter();
    const view = createReactTestRoot({ attachToDocument: true });

    function Page({ label }: { readonly label: string }) {
      renders.useRenderCount("page");
      return <output>{label}</output>;
    }

    const render = (label: string, visible: boolean) =>
      view.render(
        <KeepAliveSlot pageKey="board:team-1" visible={visible}>
          <Page label={label} />
        </KeepAliveSlot>,
      );

    await render("team one", true);
    await render("team one", false);
    renders.reset();

    // The shell moved to another team and re-rendered with its props. The kept
    // board is not that team's board and must not draw its rows.
    await render("team two", false);
    renders.expectRenderCounts({});
    expect(view.container.textContent).toBe("team one");

    // It picks the new props up the moment it is the page on screen again.
    await render("team two", true);
    expect(renders.count("page")).toBe(1);
    expect(view.container.textContent).toBe("team two");

    await view.cleanup();
  });

  it("puts a kept page's scroll position back", async () => {
    const view = createReactTestRoot({ attachToDocument: true });

    function Page({ children }: { readonly children: ReactNode }) {
      return (
        <div className="scroller" data-testid="scroller">
          {children}
        </div>
      );
    }

    const render = (visible: boolean) =>
      view.render(
        <KeepAliveSlot pageKey="board:team-1" visible={visible}>
          <Page>rows</Page>
        </KeepAliveSlot>,
      );

    await render(true);
    const scroller = view.container.querySelector<HTMLElement>(
      '[data-testid="scroller"]',
    )!;
    scroller.scrollTop = 640;
    scroller.scrollLeft = 12;
    scroller.dispatchEvent(new Event("scroll"));
    await flush(1);

    await render(false);
    /*
      Hiding sets `display:none`, which destroys the layout box and with it the
      scroll offset. jsdom has no layout, so the reset is done here — the point
      of the assertion below is that the slot puts the offset back, not that
      jsdom kept it.
    */
    scroller.scrollTop = 0;
    scroller.scrollLeft = 0;

    await render(true);
    expect(scroller.scrollTop).toBe(640);
    expect(scroller.scrollLeft).toBe(12);

    await view.cleanup();
  });
});
