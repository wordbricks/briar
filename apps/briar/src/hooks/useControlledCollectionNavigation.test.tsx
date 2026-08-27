/** @vitest-environment jsdom */

import { act, useState } from "react";
import { createReactTestRoot, renderReactTestRoot } from "../test/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";

import {
  useControlledCollectionNavigation,
  type CollectionNavigationChange,
  type CollectionNavigationResolverContext,
  type ControlledCollectionNavigation,
  type ControlledCollectionNavigationOptions,
} from "./useControlledCollectionNavigation";

type ItemId = "a" | "b" | "c" | "d" | "removed";

describe("useControlledCollectionNavigation", () => {
  let cleanup: () => Promise<void>;
  let container: HTMLDivElement;
  let root: ReturnType<typeof createReactTestRoot>["root"];
  let navigation: ControlledCollectionNavigation<ItemId, HTMLButtonElement>;
  let onActivate: Mock<(
    id: ItemId,
    change: CollectionNavigationChange<ItemId>,
  ) => void>;
  let onCursorIdChange: Mock<(
    id: ItemId,
    change: CollectionNavigationChange<ItemId>,
  ) => void>;
  let onSelectedIdChange: Mock<(
    id: ItemId,
    change: CollectionNavigationChange<ItemId>,
  ) => void>;
  let scrollSpies: Map<ItemId, Mock<(options?: ScrollIntoViewOptions) => void>>;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    ({ cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    }));
    onActivate = vi.fn();
    onCursorIdChange = vi.fn();
    onSelectedIdChange = vi.fn();
    scrollSpies = new Map();
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  function Harness({
    initialCursorId = "a",
    initialSelectedId = "a",
    itemIds = ["a", "b", "c"],
    orientation = "vertical",
    projectDomFocus = true,
    renderIds = itemIds,
    resolveNextId,
    selectionBehavior = "follow-cursor",
  }: {
    initialCursorId?: ItemId | null;
    initialSelectedId?: ItemId | null;
    itemIds?: readonly ItemId[];
    orientation?: "vertical" | "horizontal" | "both";
    projectDomFocus?: boolean;
    renderIds?: readonly ItemId[];
    resolveNextId?: (
      context: CollectionNavigationResolverContext<ItemId>,
    ) => ItemId | null;
    selectionBehavior?: "follow-cursor" | "manual";
  }) {
    const [cursorId, setCursorId] = useState<ItemId | null>(initialCursorId);
    const [selectedId, setSelectedId] = useState<ItemId | null>(
      initialSelectedId,
    );
    const commonOptions = {
      cursorId,
      itemIds,
      onActivate,
      onCursorIdChange: (
        id: ItemId,
        change: CollectionNavigationChange<ItemId>,
      ) => {
        onCursorIdChange(id, change);
        setCursorId(id);
      },
      onSelectedIdChange: (
        id: ItemId,
        change: CollectionNavigationChange<ItemId>,
      ) => {
        onSelectedIdChange(id, change);
        setSelectedId(id);
      },
      projectDomFocus,
      selectedId,
      selectionBehavior,
    } as const;
    let navigationOptions: ControlledCollectionNavigationOptions<ItemId>;
    if (orientation === "both") {
      if (resolveNextId === undefined) {
        throw new Error("A two-dimensional test harness requires a resolver");
      }
      navigationOptions = {
        ...commonOptions,
        orientation,
        resolveNextId,
      };
    } else {
      navigationOptions = {
        ...commonOptions,
        orientation,
        ...(resolveNextId === undefined ? {} : { resolveNextId }),
      };
    }
    navigation = useControlledCollectionNavigation<ItemId, HTMLButtonElement>(
      navigationOptions,
    );

    return (
      <>
        <button data-testid="outside" type="button">Outside</button>
        <output data-testid="cursor">{cursorId ?? "none"}</output>
        <output data-testid="selected">{selectedId ?? "none"}</output>
        {renderIds.map((id) => (
          <button
            data-item-id={id}
            key={id}
            onClick={vi.fn()}
            ref={(element) => {
              if (element && !scrollSpies.has(id)) {
                const scroll = vi.fn();
                scrollSpies.set(id, scroll);
                element.scrollIntoView = scroll;
              }
              navigation.getItemRef(id)(element);
            }}
            type="button"
          >
            {id}
          </button>
        ))}
      </>
    );
  }

  function item(id: ItemId) {
    return container.querySelector<HTMLButtonElement>(`[data-item-id="${id}"]`)!;
  }

  it("moves a vertical cursor, follows selection, and projects DOM focus", async () => {
    await renderReactTestRoot(root, <Harness />);
    const click = vi.spyOn(item("b"), "click");

    let result!: ReturnType<typeof navigation.move>;
    await act(async () => {
      result = navigation.move("down");
    });

    expect(result).toEqual({ handled: true, id: "b", status: "moved" });
    expect(container.querySelector('[data-testid="cursor"]')?.textContent)
      .toBe("b");
    expect(container.querySelector('[data-testid="selected"]')?.textContent)
      .toBe("b");
    expect(document.activeElement).toBe(item("b"));
    expect(scrollSpies.get("b")).toHaveBeenCalledWith({
      block: "nearest",
      inline: "nearest",
    });
    expect(onCursorIdChange).toHaveBeenCalledWith(
      "b",
      expect.objectContaining({ direction: "down", reason: "move" }),
    );
    expect(onSelectedIdChange).toHaveBeenCalledWith(
      "b",
      expect.objectContaining({ direction: "down", reason: "move" }),
    );
    expect(click).not.toHaveBeenCalled();
  });

  it("keeps selection manual until activation", async () => {
    await renderReactTestRoot(root, <Harness selectionBehavior="manual" />);

    await act(async () => {
      navigation.move("next");
    });
    expect(container.querySelector('[data-testid="cursor"]')?.textContent)
      .toBe("b");
    expect(container.querySelector('[data-testid="selected"]')?.textContent)
      .toBe("a");
    expect(onSelectedIdChange).not.toHaveBeenCalled();
    expect(onActivate).not.toHaveBeenCalled();

    await act(async () => {
      navigation.activate();
    });
    expect(container.querySelector('[data-testid="selected"]')?.textContent)
      .toBe("b");
    expect(onSelectedIdChange).toHaveBeenCalledWith(
      "b",
      expect.objectContaining({ direction: null, reason: "activate" }),
    );
    expect(onActivate).toHaveBeenCalledWith(
      "b",
      expect.objectContaining({ direction: null, reason: "activate" }),
    );
  });

  it("uses the controlled cursor after DOM focus leaves the collection", async () => {
    await renderReactTestRoot(root, <Harness initialCursorId="b" initialSelectedId="b" />);
    const outside = container.querySelector<HTMLButtonElement>(
      '[data-testid="outside"]',
    )!;
    outside.focus();

    await act(async () => {
      navigation.move("down");
    });

    expect(document.activeElement).toBe(item("c"));
    expect(container.querySelector('[data-testid="cursor"]')?.textContent)
      .toBe("c");
  });

  it("falls back to a visible selected ID when the cursor ID disappeared", async () => {
    await renderReactTestRoot(root, <Harness initialCursorId="removed" initialSelectedId="b" />);

    await act(async () => {
      navigation.move("down");
    });

    expect(document.activeElement).toBe(item("c"));
    expect(container.querySelector('[data-testid="cursor"]')?.textContent)
      .toBe("c");
  });

  it("clamps and refocuses without reselecting or activating", async () => {
    await renderReactTestRoot(root, <Harness initialCursorId="c" initialSelectedId="c" />);
    container.querySelector<HTMLButtonElement>('[data-testid="outside"]')!
      .focus();
    onCursorIdChange.mockClear();
    onSelectedIdChange.mockClear();

    let result!: ReturnType<typeof navigation.move>;
    await act(async () => {
      result = navigation.move("down", { repeat: true });
    });

    expect(result).toEqual({ handled: true, id: "c", status: "clamped" });
    expect(document.activeElement).toBe(item("c"));
    expect(onCursorIdChange).not.toHaveBeenCalled();
    expect(onSelectedIdChange).not.toHaveBeenCalled();
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("accepts repeated commands before a controlled rerender completes", async () => {
    await renderReactTestRoot(root, <Harness />);

    await act(async () => {
      expect(navigation.move("down", { repeat: true }).id).toBe("b");
      expect(navigation.move("down", { repeat: true }).id).toBe("c");
    });

    expect(container.querySelector('[data-testid="cursor"]')?.textContent)
      .toBe("c");
    expect(container.querySelector('[data-testid="selected"]')?.textContent)
      .toBe("c");
    expect(onCursorIdChange.mock.calls.map(([id]) => id)).toEqual(["b", "c"]);
    expect(onSelectedIdChange.mock.calls.map(([id]) => id)).toEqual([
      "b",
      "c",
    ]);
    expect(onCursorIdChange.mock.calls[0]?.[1].repeat).toBe(true);
    expect(document.activeElement).toBe(item("c"));
  });

  it("maps horizontal directions and leaves unsupported directions alone", async () => {
    await renderReactTestRoot(root, <Harness orientation="horizontal" />);

    await act(async () => {
      expect(navigation.move("right").id).toBe("b");
    });
    expect(document.activeElement).toBe(item("b"));

    onCursorIdChange.mockClear();
    expect(navigation.move("up")).toEqual({
      handled: false,
      id: null,
      status: "unsupported",
    });
    expect(onCursorIdChange).not.toHaveBeenCalled();

    await act(async () => {
      expect(navigation.move("left").id).toBe("a");
    });
    expect(document.activeElement).toBe(item("a"));
  });

  it("supports a custom two-dimensional strategy", async () => {
    const gridNext = (
      currentId: ItemId | null,
      direction: CollectionNavigationResolverContext<ItemId>["direction"],
    ): ItemId | null => {
      const transitions = new Map([
        ["a:down", "c"],
        ["c:right", "d"],
      ] as const);
      return transitions.get(`${currentId}:${direction}` as "a:down" | "c:right") ??
        currentId;
    };
    await renderReactTestRoot(
      root,
      <Harness
        itemIds={["a", "b", "c", "d"]}
        orientation="both"
        resolveNextId={({ currentId, direction }) => gridNext(currentId, direction)}
      />,
    );

    await act(async () => {
      expect(navigation.move("down").id).toBe("c");
      expect(navigation.move("right").id).toBe("d");
    });

    expect(document.activeElement).toBe(item("d"));
    expect(container.querySelector('[data-testid="selected"]')?.textContent)
      .toBe("d");
  });

  it("projects a pending focus request when its item ref mounts later", async () => {
    await renderReactTestRoot(root, <Harness itemIds={["a", "b"]} renderIds={["a"]} />);

    await act(async () => {
      expect(navigation.move("down").id).toBe("b");
    });
    expect(document.activeElement).not.toBe(item("a"));

    await renderReactTestRoot(root, <Harness itemIds={["a", "b"]} renderIds={["a", "b"]} />);

    expect(document.activeElement).toBe(item("b"));
    expect(scrollSpies.get("b")).toHaveBeenCalled();
  });

  it("cancels deferred DOM focus when projection becomes virtual", async () => {
    await renderReactTestRoot(root, <Harness itemIds={["a", "b"]} renderIds={["a"]} />);
    const outside = container.querySelector<HTMLButtonElement>(
      '[data-testid="outside"]',
    )!;
    outside.focus();

    await act(async () => {
      expect(navigation.move("down").id).toBe("b");
    });
    await renderReactTestRoot(
      root,
      <Harness
        itemIds={["a", "b"]}
        projectDomFocus={false}
        renderIds={["a", "b"]}
      />,
    );

    expect(document.activeElement).toBe(outside);
    expect(scrollSpies.get("b")).not.toHaveBeenCalled();
  });

  it("uses stable IDs against the consumer's latest reordered item list", async () => {
    await renderReactTestRoot(
      root,
      <Harness
        initialCursorId="b"
        initialSelectedId="b"
        itemIds={["a", "b", "c"]}
      />,
    );
    await renderReactTestRoot(
      root,
      <Harness
        initialCursorId="b"
        initialSelectedId="b"
        itemIds={["c", "b", "a"]}
      />,
    );

    await act(async () => {
      expect(navigation.move("down").id).toBe("a");
    });
    expect(document.activeElement).toBe(item("a"));
  });

  it("can keep DOM focus virtual while still updating controlled state", async () => {
    await renderReactTestRoot(root, <Harness projectDomFocus={false} />);
    const outside = container.querySelector<HTMLButtonElement>(
      '[data-testid="outside"]',
    )!;
    outside.focus();

    await act(async () => {
      navigation.move("down");
    });

    expect(document.activeElement).toBe(outside);
    expect(container.querySelector('[data-testid="cursor"]')?.textContent)
      .toBe("b");
    expect(container.querySelector('[data-testid="selected"]')?.textContent)
      .toBe("b");
  });

  it("reports empty collections without changing state", async () => {
    await renderReactTestRoot(
      root,
      <Harness
        initialCursorId={null}
        initialSelectedId={null}
        itemIds={[]}
      />,
    );

    expect(navigation.move("down")).toEqual({
      handled: false,
      id: null,
      status: "empty",
    });
    expect(navigation.activate()).toEqual({
      handled: false,
      id: null,
      status: "empty",
    });
    expect(navigation.focusCursor()).toBe(false);
    expect(onCursorIdChange).not.toHaveBeenCalled();
    expect(onSelectedIdChange).not.toHaveBeenCalled();
    expect(onActivate).not.toHaveBeenCalled();
  });
});
