import {
  cloneAutoHuntWorkflow,
  normalizeAutoHuntWorkflow,
  type AutoHuntWorkflow,
} from "../../src/lib/auto-hunt-contract";

import { type HuntRunRow } from "./hunt-run-model";

export const stableJson = (value: unknown) => JSON.stringify(value);
export const parseWorkflow = (value: string | null | undefined) => {
  if (!value) return cloneAutoHuntWorkflow();
  return normalizeAutoHuntWorkflow(JSON.parse(value) as AutoHuntWorkflow);
};
export const normalizedUrls = (urls: string[]) => [...new Set(urls)].sort();
export const parseUrls = (value: string | null | undefined) => {
  if (!value) return [];
  const parsed: unknown = JSON.parse(value);
  return Array.isArray(parsed)
    ? parsed.filter((item): item is string => typeof item === "string")
    : [];
};

export const runIsFullAuto = (run: Pick<HuntRunRow, "full_auto">) =>
  run.full_auto === 1;
