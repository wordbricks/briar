import { join } from "node:path";
import {
  inspectMergeQueueDoctor,
} from "./merge-queue";
import {
  fetchMergeQueueProfile,
  updateRemoteMergeQueueProfile,
} from "./app-connect-client";
import {
  configureBrowserSkillGuide,
  getSkillGuide,
  skillGuides,
} from "./skill-guides";
import { type Config } from "./config-contract";
import {
  cliVersion,
  args,
  value,
  has,
  loadConfig,
  login,
  currentProject,
} from "./command-support";

const skillsUsage = `Briar bundled skill guides

  briar skills list [--json]
  briar skills get <topic> [--json]
`;

function listSkillGuides() {
  const topics = skillGuides.map(({ name, description }) => ({ name, description }));
  if (has("--json")) {
    console.log(JSON.stringify({ version: cliVersion, topics }, null, 2));
    return;
  }
  process.stdout.write(
    `${topics.map((topic) => `${topic.name}: ${topic.description}`).join("\n")}\n`,
  );
}

async function showSkillGuide() {
  const topic = args[2];
  if (!topic || topic === "--help") {
    console.log("Usage: briar skills get <topic> [--json]");
    return;
  }
  const guide = getSkillGuide(topic);
  if (!guide) {
    throw new Error(
      `Unknown skill topic "${topic}". Available topics: ${skillGuides
        .map((candidate) => candidate.name)
        .join(", ")}`,
    );
  }
  const markdown = topic === "browser"
    ? configureBrowserSkillGuide(
        guide.markdown,
        (await loadConfig()).appSettings.browserAutomationProvider,
      )
    : guide.markdown;
  if (has("--json")) {
    console.log(
      JSON.stringify(
        {
          name: guide.name,
          version: cliVersion,
          markdown,
        },
        null,
        2,
      ),
    );
    return;
  }
  process.stdout.write(
    markdown.endsWith("\n") ? markdown : `${markdown}\n`,
  );
}

async function mergeQueueCommandProject(config: Config) {
  const projectId = value("--team");
  const project = projectId
    ? config.teams.find((candidate) => candidate.id === projectId)
    : await currentProject(config);
  if (!project) {
    throw new Error("이 컴퓨터에 연결된 팀을 찾지 못했습니다.");
  }
  if (!config.userToken) {
    throw new Error("`briar login`으로 먼저 로그인하세요.");
  }
  return { project, userToken: config.userToken };
}

function mergeQueueIntegerOption(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const raw = value(name);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return parsed;
}

async function configureMergeQueueCommand() {
  if (has("--enable") === has("--disable")) {
    throw new Error("Choose exactly one of --enable or --disable");
  }
  if (
    has("--disable") &&
    (value("--quiet-window-ms") !== undefined ||
      value("--max-batch-size") !== undefined)
  ) {
    throw new Error("Queue sizing options are only valid with --enable");
  }
  const config = await loadConfig();
  const { project, userToken } = await mergeQueueCommandProject(config);
  const current = await fetchMergeQueueProfile(
    config.apiUrl,
    userToken,
    project.id,
  );
  const readinessStageId = value("--readiness-stage") ??
    current?.readinessStageId;
  if (has("--enable") && !readinessStageId) {
    throw new Error(
      "--readiness-stage is required when enabling a new merge queue profile",
    );
  }
  if (has("--disable") && !current && !readinessStageId) {
    console.log(JSON.stringify({ profile: null }, null, 2));
    return;
  }
  const quietWindowMs = mergeQueueIntegerOption(
    "--quiet-window-ms",
    current?.quietWindowMs ?? 300_000,
    1_000,
    300_000,
  );
  const maxBatchSize = mergeQueueIntegerOption(
    "--max-batch-size",
    current?.maxBatchSize ?? 5,
    2,
    5,
  );
  const profile = await updateRemoteMergeQueueProfile(
    config.apiUrl,
    userToken,
    {
      projectId: project.id,
      enabled: has("--enable"),
      ...(readinessStageId ? { readinessStageId } : {}),
      quietWindowMs,
      maxBatchSize,
    },
  );
  console.log(JSON.stringify({ profile }, null, 2));
}

async function mergeQueueDoctorCommand() {
  const config = await loadConfig();
  const { project, userToken } = await mergeQueueCommandProject(config);
  const profile = await fetchMergeQueueProfile(
    config.apiUrl,
    userToken,
    project.id,
  );
  const result = inspectMergeQueueDoctor({
    profile,
    repositoryPath: project.repositoryPath,
  });
  if (has("--json")) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    for (const check of result.checks) {
      console.log(`${check.ok ? "ok" : "fail"} ${check.name}: ${check.detail}`);
    }
  }
  if (!result.ok) {
    throw new Error("Merge queue doctor found a fail-closed readiness problem");
  }
}

export {
  skillsUsage,
  listSkillGuides,
  showSkillGuide,
  mergeQueueCommandProject,
  mergeQueueIntegerOption,
  configureMergeQueueCommand,
  mergeQueueDoctorCommand,
};
