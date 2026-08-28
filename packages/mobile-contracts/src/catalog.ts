import { listProjectsOperation } from "./list-projects";
import type { AnyMobileOperation } from "./operation";

/** Executable operations migrated to the shared mobile HTTP contract. */
export const mobileOperationCatalog = {
  [listProjectsOperation.id]: listProjectsOperation,
} as const satisfies Readonly<Record<string, AnyMobileOperation>>;
