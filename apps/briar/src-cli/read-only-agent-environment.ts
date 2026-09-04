/**
 * Read-only provider isolation lives in the runner bundle so the desktop
 * sidecar can apply it too; the worker CLI keeps importing it from here.
 */
export {
  ensureReadOnlyAgentEnvironment,
  prepareReadOnlyAgentEnvironment,
  readOnlyAgentEnvironment,
  readOnlyStateRootEnvironmentKey,
  type PreparedReadOnlyAgentEnvironment,
} from "../src-agent/read-only-agent-environment";
