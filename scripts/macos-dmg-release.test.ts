import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const tauriConfigPath = "apps/briar/src-tauri/tauri.conf.json";
const backgroundPath = "apps/briar/src-tauri/icons/dmg-background.png";

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
});
