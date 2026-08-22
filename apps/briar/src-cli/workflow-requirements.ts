import { spawnSync } from "node:child_process";
import type {
  AutoHuntRequirementKind,
  AutoHuntWorkflowRequirement,
} from "../src/lib/auto-hunt-contract";

export type WorkflowRequirementHealth = {
  id: string;
  label: string;
  kind: AutoHuntRequirementKind;
  tool: string;
  reason: string;
  healthy: boolean;
  detail: string;
};

export type WorkflowRequirementDependencies = {
  which: (tool: string) => string | null;
  run: (
    binary: string,
    args: string[],
  ) => { success: boolean; stdout: string; stderr: string };
};

const defaultWhich = (tool: string) => {
  const result = spawnSync("which", [tool], {
    encoding: "utf8",
    env: process.env,
    timeout: 5_000,
  });
  if (result.status !== 0 || result.error) return null;
  const path = result.stdout.trim().split("\n")[0]?.trim();
  return path || null;
};

const defaultRun = (binary: string, args: string[]) => {
  const result = spawnSync(binary, args, {
    encoding: "utf8",
    env: process.env,
    timeout: 15_000,
  });
  return {
    success: result.status === 0 && !result.error,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
};

const firstLine = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean) ?? text.trim();

const defaultDependencies: WorkflowRequirementDependencies = {
  which: defaultWhich,
  run: defaultRun,
};

function inspectOne(
  requirement: AutoHuntWorkflowRequirement,
  dependencies: WorkflowRequirementDependencies,
): WorkflowRequirementHealth {
  try {
    switch (requirement.kind) {
      case "executable": {
        const path = dependencies.which(requirement.tool);
        if (!path) {
          return {
            ...requirement,
            healthy: false,
            detail: `'${requirement.tool}' 실행 파일을 찾지 못했습니다.`,
          };
        }
        return { ...requirement, healthy: true, detail: path };
      }
      case "xcode": {
        const binary = dependencies.which("xcodebuild");
        if (!binary) {
          return {
            ...requirement,
            healthy: false,
            detail: "xcodebuild 실행 파일을 찾지 못했습니다.",
          };
        }
        const output = dependencies.run(binary, ["-version"]);
        return {
          ...requirement,
          healthy: output.success,
          detail: output.success
            ? firstLine(output.stdout) || binary
            : firstLine(output.stderr) || "Xcode 도구 확인에 실패했습니다.",
        };
      }
      case "ios_simulator": {
        const binary = dependencies.which("xcrun");
        if (!binary) {
          return {
            ...requirement,
            healthy: false,
            detail: "xcrun 실행 파일을 찾지 못했습니다.",
          };
        }
        const output = dependencies.run(binary, [
          "simctl",
          "list",
          "devices",
          "available",
          "--json",
        ]);
        if (!output.success) {
          return {
            ...requirement,
            healthy: false,
            detail:
              firstLine(output.stderr) ||
              "iOS 시뮬레이터 목록을 읽지 못했습니다.",
          };
        }
        let count = 0;
        try {
          const parsed = JSON.parse(output.stdout) as {
            devices?: Record<string, unknown[]>;
          };
          count = Object.values(parsed.devices ?? {}).reduce(
            (total, devices) => total + (Array.isArray(devices) ? devices.length : 0),
            0,
          );
        } catch {
          count = 0;
        }
        return {
          ...requirement,
          healthy: count > 0,
          detail:
            count > 0
              ? `사용 가능한 시뮬레이터 ${count}개`
              : "사용 가능한 iOS 시뮬레이터가 없습니다.",
        };
      }
      case "android_sdk": {
        const binary = dependencies.which("adb");
        if (!binary) {
          return {
            ...requirement,
            healthy: false,
            detail: "adb 실행 파일을 찾지 못했습니다.",
          };
        }
        const output = dependencies.run(binary, ["version"]);
        return {
          ...requirement,
          healthy: output.success,
          detail: output.success
            ? firstLine(output.stdout) || binary
            : firstLine(output.stderr) || "Android SDK 확인에 실패했습니다.",
        };
      }
      case "android_emulator": {
        const binary = dependencies.which("emulator");
        if (!binary) {
          return {
            ...requirement,
            healthy: false,
            detail: "emulator 실행 파일을 찾지 못했습니다.",
          };
        }
        const output = dependencies.run(binary, ["-list-avds"]);
        if (!output.success) {
          return {
            ...requirement,
            healthy: false,
            detail:
              firstLine(output.stderr) ||
              "Android 가상 기기 목록을 읽지 못했습니다.",
          };
        }
        const count = output.stdout
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean).length;
        return {
          ...requirement,
          healthy: count > 0,
          detail:
            count > 0
              ? `설치된 Android 가상 기기 ${count}개`
              : "설치된 Android 가상 기기(AVD)가 없습니다.",
        };
      }
      default: {
        const exhaustive: never = requirement.kind;
        return {
          ...requirement,
          healthy: false,
          detail: `지원하지 않는 도구 종류입니다: ${String(exhaustive)}`,
        };
      }
    }
  } catch (error) {
    return {
      ...requirement,
      healthy: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Probe each shared workflow requirement on this worker machine. */
export function inspectWorkflowRequirements(
  requirements: AutoHuntWorkflowRequirement[] | undefined | null,
  dependencies: WorkflowRequirementDependencies = defaultDependencies,
): WorkflowRequirementHealth[] {
  return (requirements ?? []).map((requirement) =>
    inspectOne(requirement, dependencies),
  );
}

export function workflowRequirementReadinessDetail(
  requirements: WorkflowRequirementHealth[],
  maxLength = 500,
): string | null {
  const unhealthy = requirements.filter((requirement) => !requirement.healthy);
  if (unhealthy.length === 0) return null;
  const detail = unhealthy
    .map((requirement) => `${requirement.label}: ${requirement.detail}`)
    .join("; ");
  return detail.length <= maxLength
    ? detail
    : `${detail.slice(0, Math.max(0, maxLength - 1))}…`;
}
