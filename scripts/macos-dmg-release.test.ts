import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const tauriConfigPath = "apps/briar/src-tauri/tauri.conf.json";
const backgroundPath = "apps/briar/src-tauri/icons/dmg-background.png";
const productionReleasePath = "scripts/release-macos-production.sh";
const updaterQaPath = "scripts/qa-production-updater-build.sh";

describe("macOS DMG release presentation", () => {
  it("keeps the designed background and icon layout in the Tauri bundle config", async () => {
    const config = JSON.parse(await readFile(tauriConfigPath, "utf8")) as {
      bundle: {
        macOS: {
          dmg: {
            background: string;
            windowSize: { width: number; height: number };
            appPosition: { x: number; y: number };
            applicationFolderPosition: { x: number; y: number };
          };
        };
      };
    };

    expect(config.bundle.macOS.dmg).toEqual({
      background: "icons/dmg-background.png",
      windowSize: { width: 720, height: 440 },
      appPosition: { x: 180, y: 226 },
      applicationFolderPosition: { x: 540, y: 226 },
    });

    const background = await readFile(backgroundPath);
    expect(background.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(background.readUInt32BE(16)).toBe(720);
    expect(background.readUInt32BE(20)).toBe(440);
  });

  it("enables Finder styling for production while keeping updater QA headless-safe", async () => {
    const [productionRelease, updaterQa] = await Promise.all([
      readFile(productionReleasePath, "utf8"),
      readFile(updaterQaPath, "utf8"),
    ]);

    expect(productionRelease).toContain(
      'env -u CI scripts/with-release-env.sh \\\n  bun --cwd apps/briar tauri build --config "$production_config"',
    );
    expect(productionRelease).not.toContain(
      'CI=true scripts/with-release-env.sh \\\n  bun --cwd apps/briar tauri build --config "$production_config"',
    );
    expect(updaterQa).toMatch(
      /CI=true \\\nTAURI_SIGNING_PRIVATE_KEY=.*?tauri build --config "\$production_config"/su,
    );
  });
});
