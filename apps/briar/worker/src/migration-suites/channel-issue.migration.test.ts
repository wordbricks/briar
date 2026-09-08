import "../channel-text-attachments.migration.test";
import "../agent-message-relays.migration.test";
import "../agent-message-reactions.migration.test";
import "../dm-public-message.migration.test";
import { isolateD1MigrationTests } from "./isolate-d1";

isolateD1MigrationTests();
