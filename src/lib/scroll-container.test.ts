/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";
import {
  scrollContainerToEnd,
  scrollElementToCenter,
} from "./scroll-container";

const setNumberProperty = (
  element: HTMLElement,
  property: "clientHeight" | "scrollHeight" | "scrollTop",
  value: number,
) => {
  Object.defineProperty(element, property, {
    configurable: true,
    value,
    writable: property === "scrollTop",
  });
};

describe("contained scrolling", () => {
  it("scrolls only the supplied container to its end", () => {
    const container = document.createElement("div");
    setNumberProperty(container, "clientHeight", 360);
    setNumberProperty(container, "scrollHeight", 960);
    setNumberProperty(container, "scrollTop", 120);

    scrollContainerToEnd(container);

    expect(container.scrollTop).toBe(600);
  });

  it("centers an element within the supplied container", () => {
    const container = document.createElement("div");
    const element = document.createElement("div");
    setNumberProperty(container, "clientHeight", 400);
    setNumberProperty(container, "scrollHeight", 1_200);
    setNumberProperty(container, "scrollTop", 100);
    container.getBoundingClientRect = () =>
      ({ top: 200 } as DOMRect);
    element.getBoundingClientRect = () =>
      ({ top: 700, height: 40 } as DOMRect);

    scrollElementToCenter(container, element);

    expect(container.scrollTop).toBe(420);
  });

  it("clamps centering to the container's scroll range", () => {
    const container = document.createElement("div");
    const element = document.createElement("div");
    setNumberProperty(container, "clientHeight", 400);
    setNumberProperty(container, "scrollHeight", 600);
    setNumberProperty(container, "scrollTop", 150);
    container.getBoundingClientRect = () =>
      ({ top: 100 } as DOMRect);
    element.getBoundingClientRect = () =>
      ({ top: 800, height: 40 } as DOMRect);

    scrollElementToCenter(container, element);

    expect(container.scrollTop).toBe(200);
  });
});
