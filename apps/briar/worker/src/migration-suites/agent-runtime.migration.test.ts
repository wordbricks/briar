import "../agent-execution-metrics-storage.migration.test";
import "../structured-agent-result-storage.migration.test";
import "../worker-runtime-proto.migration.test";
import "../workflow-checkpoint-storage.migration.test";
import { isolateD1MigrationTests } from "./isolate-d1";

isolateD1MigrationTests();
