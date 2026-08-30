import { createClient } from "@connectrpc/connect";
import {
  ManagedComputerSetupService,
} from "@briar/contracts/gen/briar/worker/v1/managed_computer_setup_pb";
import {
  workerConnectOptions,
  workerConnectTransport,
} from "./worker-control-client";

export function createManagedComputerSetupClient(
  apiUrl: string,
  workerToken: string,
) {
  return {
    client: createClient(
      ManagedComputerSetupService,
      workerConnectTransport(apiUrl),
    ),
    options: workerConnectOptions(workerToken),
  };
}
