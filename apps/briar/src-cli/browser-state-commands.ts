import { args, has } from "./command-support";
import {
  clearSharedState,
  ensureSharedState,
  mergeSharedState,
} from "./browser-state";

/**
 * Print the path and nothing else without --json: the browser guide captures
 * this output into a shell variable and passes it to \`agent-browser --state\`.
 */
async function browserStateEnsureCommand() {
  const summary = await ensureSharedState();
  if (has("--json")) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  console.log(summary.path);
}

async function browserStateMergeCommand() {
  const inputPath = args[2];
  if (!inputPath || inputPath.startsWith("-")) {
    throw new Error("Usage: briar browser-state merge <file> [--json]");
  }
  const summary = await mergeSharedState(inputPath);
  if (has("--json")) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  console.log(
    `${summary.path}: ${summary.cookies} cookies, ${summary.origins} origins ` +
      `(added ${summary.added}, replaced ${summary.replaced}, expired ${summary.expired})`,
  );
}

async function browserStateClearCommand() {
  const summary = await clearSharedState();
  if (has("--json")) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  console.log(`cleared ${summary.path}`);
}

export {
  browserStateEnsureCommand,
  browserStateMergeCommand,
  browserStateClearCommand,
};
