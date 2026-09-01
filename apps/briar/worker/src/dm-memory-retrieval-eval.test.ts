import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

type Dataset = {
  positive: Array<{ split: "dev" | "final"; direction: string }>;
  negative: Array<{ split: "dev" | "final" }>;
};
type Report = {
  model: string;
  candidateCount: number;
  dev: { hitAt5: number; falsePositiveRate: number };
  final: { hitAt5: number; falsePositiveRate: number };
  directions: Record<string, { count: number; hitAt5: number }>;
  latencyMs: { p95: number; max: number };
};

const fixture = (name: string) => new URL(`../../evals/dm-memory-retrieval-v1/${name}`, import.meta.url);
const readJson = async <T>(name: string) => JSON.parse(await readFile(fixture(name), "utf8")) as T;

describe("DM memory retrieval rollout evidence", () => {
  it("keeps separate bilingual development and final labels", async () => {
    const dataset = await readJson<Dataset>("dataset.json");

    expect(dataset.positive).toHaveLength(40);
    expect(dataset.negative).toHaveLength(20);
    expect(dataset.positive.filter((row) => row.split === "dev")).toHaveLength(20);
    expect(dataset.positive.filter((row) => row.split === "final")).toHaveLength(20);
    expect(dataset.negative.filter((row) => row.split === "dev")).toHaveLength(10);
    expect(dataset.negative.filter((row) => row.split === "final")).toHaveLength(10);
    expect(dataset.positive.filter((row) => row.direction === "ko_to_en")).toHaveLength(10);
    expect(dataset.positive.filter((row) => row.direction === "en_to_ko")).toHaveLength(10);
  });

  it("records the release thresholds for the bounded semantic verifier", async () => {
    const report = await readJson<Report>("semantic-report.json");

    expect(report.model).toBe("@cf/meta/llama-3.3-70b-instruct-fp8-fast");
    expect(report.candidateCount).toBe(10);
    for (const split of [report.dev, report.final]) {
      expect(split.hitAt5).toBeGreaterThanOrEqual(0.9);
      expect(split.falsePositiveRate).toBeLessThanOrEqual(0.1);
    }
    expect(report.directions.ko_to_en).toMatchObject({ count: 10, hitAt5: 1 });
    expect(report.directions.en_to_ko).toMatchObject({ count: 10, hitAt5: 1 });
    expect(report.latencyMs.p95).toBeLessThanOrEqual(2_000);
    expect(report.latencyMs.max).toBeLessThan(5_000);
  });
});
