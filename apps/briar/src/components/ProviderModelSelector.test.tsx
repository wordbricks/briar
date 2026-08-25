/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defaultAgentProviderModelCatalog } from "../lib/project-llm";
import { ProviderModelSelector } from "./ProviderModelSelector";

const catalog = {
  ...defaultAgentProviderModelCatalog,
  codex: {
    models: [
      { id: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
      { id: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
    ],
    defaultEfforts: [],
    allowCustomModels: false,
    error: null,
  },
  claude: {
    models: [{ id: "sonnet", label: "Claude Sonnet" }],
    defaultEfforts: [],
    allowCustomModels: true,
    error: null,
  },
};

describe("ProviderModelSelector", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    window.localStorage.clear();
    container = document.createElement("div");
    document.body.append(container);
  });

  afterEach(() => {
    container.remove();
    document.body.innerHTML = "";
  });

  it("combines provider filtering, model search, favorites, and shortcuts", async () => {
    const onModelChange = vi.fn();
    const onProviderChange = vi.fn();
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <ProviderModelSelector
          groupLabel="실행 프로바이더 · 선호 모델"
          modelLabel="선호 모델"
          modelSearchEmptyMessage="검색 결과 없음"
          modelSearchPlaceholder="모델 검색"
          modelValue="gpt-5.6-sol"
          onModelChange={onModelChange}
          onProviderChange={onProviderChange}
          providerDefaultModelLabel="프로바이더 기본 모델"
          providerLabel="실행 프로바이더"
          providerModels={catalog}
          providers={["codex", "claude"]}
          providerValue="codex"
        />,
      );
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        ".provider-model-selector-trigger",
      )?.click();
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    expect(document.activeElement).toBe(
      document.body.querySelector('input[aria-label="모델 검색"]'),
    );
    expect(
      document.body.querySelectorAll(
        ".provider-model-picker-provider[data-provider]",
      ),
    ).toHaveLength(2);

    await act(async () => {
      document.body.querySelector<HTMLButtonElement>(
        '.provider-model-picker-favorite[aria-label*="GPT-5.6 Sol"]',
      )?.click();
    });
    await act(async () => {
      document.body.querySelector<HTMLButtonElement>(
        '.provider-model-picker-provider[data-filter="favorites"]',
      )?.click();
    });
    expect(
      document.body.querySelector(
        '.provider-model-picker-option[data-value="gpt-5.6-sol"]',
      ),
    ).not.toBeNull();
    expect(
      document.body.querySelector(
        '.provider-model-picker-option[data-value="gpt-5.6-terra"]',
      ),
    ).toBeNull();

    await act(async () => {
      document.body.querySelector<HTMLButtonElement>(
        '.provider-model-picker-provider[data-provider="codex"]',
      )?.click();
      const search = document.body.querySelector<HTMLInputElement>(
        'input[aria-label="모델 검색"]',
      );
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(search, "terra");
      search?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(
      document.body.querySelector(
        '.provider-model-picker-option[data-value="gpt-5.6-terra"]',
      ),
    ).not.toBeNull();
    expect(
      document.body.querySelector(
        '.provider-model-picker-option[data-value="gpt-5.6-sol"]',
      ),
    ).toBeNull();

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", {
        bubbles: true,
        key: "1",
        metaKey: true,
      }));
    });
    expect(onProviderChange).not.toHaveBeenCalled();
    expect(onModelChange).toHaveBeenCalledWith("gpt-5.6-terra");

    await act(async () => root.unmount());
  });
});
