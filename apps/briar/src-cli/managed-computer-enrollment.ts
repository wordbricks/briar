import { randomUUID } from "node:crypto";
import {
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import type { Client } from "@connectrpc/connect";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import { codeToString } from "@connectrpc/connect/protocol-connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import {
  ApplicationErrorDetailSchema,
} from "@briar/contracts/gen/briar/types/v1/error_pb";
import {
  ManagedComputerEnrollmentService,
} from "@briar/contracts/gen/briar/worker/v1/managed_computer_setup_pb";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  ManagedComputerEnrollmentProof,
} from "../src/lib/managed-computer-enrollment-contract";
import { cliVersion } from "./command-support";
import {
  decodeManagedComputerCredential,
  defaultManagedComputerCredentialPath,
  type ManagedComputerCredential,
} from "./managed-computer-credential";

const defaultEnrollmentConfigPath =
  "/var/lib/briar/managed-enrollment.json";
const defaultIdentityDocumentPath =
  "/var/lib/briar/instance-identity.json";
const defaultIdentitySignaturePath =
  "/var/lib/briar/instance-identity-signature";

const strictParseOptions = {
  errors: "all",
  onExcessProperty: "error",
} as const;

const HttpsOrigin = Schema.URLFromString.check(
  Schema.makeFilter((url) =>
    (
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === ""
    ) || "Expected an HTTPS origin without credentials, path, query, or fragment"
  ),
);

const ManagedComputerEnrollmentBootstrapConfig = Schema.Struct({
  apiOrigin: HttpsOrigin,
  managedComputerId: Schema.String.check(Schema.isUUID()),
  nonce: Schema.String.check(
    Schema.isPattern(/^[A-Za-z0-9_-]{43}$/u),
  ),
}).annotate({ parseOptions: strictParseOptions });

const ManagedComputerEnrollmentBootstrapConfigJson = Schema.fromJsonString(
  ManagedComputerEnrollmentBootstrapConfig,
);

const decodeBootstrapConfig = Schema.decodeUnknownSync(
  ManagedComputerEnrollmentBootstrapConfigJson,
  strictParseOptions,
);
const decodeEnrollmentProof = Schema.decodeUnknownSync(
  ManagedComputerEnrollmentProof,
  strictParseOptions,
);
const decodeApplicationErrorCode = Schema.decodeUnknownOption(
  Schema.String.check(
    Schema.isPattern(/^[A-Z][A-Z0-9_]{0,127}$/u),
  ),
);

type ManagedComputerEnrollmentClient = Pick<
  Client<typeof ManagedComputerEnrollmentService>,
  "enrollManagedComputer"
>;

export type ManagedComputerEnrollmentPaths = {
  readonly config: string;
  readonly identityDocument: string;
  readonly identitySignature: string;
  readonly credential: string;
};

export type ManagedComputerEnrollmentDependencies = {
  readonly readText: (path: string) => Promise<string>;
  readonly createEnrollmentClient: (
    apiOrigin: string,
  ) => ManagedComputerEnrollmentClient;
  readonly persistCredential: (
    path: string,
    credential: ManagedComputerCredential,
  ) => Promise<void>;
  readonly version: string;
};

const defaultPaths: ManagedComputerEnrollmentPaths = {
  config: defaultEnrollmentConfigPath,
  identityDocument: defaultIdentityDocumentPath,
  identitySignature: defaultIdentitySignaturePath,
  credential: defaultManagedComputerCredentialPath,
};

const createEnrollmentClient = (
  apiOrigin: string,
): ManagedComputerEnrollmentClient => createClient(
  ManagedComputerEnrollmentService,
  createConnectTransport({
    baseUrl: apiOrigin,
    useBinaryFormat: true,
  }),
);

const persistCredential = async (
  path: string,
  credential: ManagedComputerCredential,
) => {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(credential)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
};

const defaultDependencies: ManagedComputerEnrollmentDependencies = {
  readText: (path) => readFile(path, "utf8"),
  createEnrollmentClient,
  persistCredential,
  version: cliVersion,
};

export async function enrollManagedComputerFromInstance(
  pathOverrides: Partial<ManagedComputerEnrollmentPaths> = {},
  dependencyOverrides: Partial<ManagedComputerEnrollmentDependencies> = {},
) {
  const paths = { ...defaultPaths, ...pathOverrides };
  const dependencies = { ...defaultDependencies, ...dependencyOverrides };
  const [encodedConfig, identityDocument, identitySignature] =
    await Promise.all([
      dependencies.readText(paths.config),
      dependencies.readText(paths.identityDocument),
      dependencies.readText(paths.identitySignature),
    ]);
  const config = decodeBootstrapConfig(encodedConfig);
  const proof = decodeEnrollmentProof({
    nonce: config.nonce,
    identityDocument,
    identitySignature,
    briarVersion: dependencies.version,
  });
  const response = await dependencies.createEnrollmentClient(
    config.apiOrigin.origin,
  ).enrollManagedComputer({
    managedComputerId: config.managedComputerId,
    ...proof,
  });
  const credential = decodeManagedComputerCredential({
    credential: response.credential,
    deviceId: response.deviceId,
    organizationId: response.organizationId,
    managedComputerId: response.managedComputerId,
    apiOrigin: config.apiOrigin.origin,
  });
  if (credential.managedComputerId !== config.managedComputerId) {
    throw new Error("Managed computer enrollment response did not match the request");
  }
  await dependencies.persistCredential(paths.credential, credential);
  return credential;
}

const permanentConnectCodes = new Set<Code>([
  Code.InvalidArgument,
  Code.NotFound,
  Code.AlreadyExists,
  Code.PermissionDenied,
  Code.OutOfRange,
  Code.Unimplemented,
  Code.Unauthenticated,
]);

export const managedComputerEnrollmentExitCode = (error: unknown) =>
  error instanceof ConnectError && !permanentConnectCodes.has(error.code)
    ? 75
    : 2;

export const managedComputerEnrollmentErrorCode = (error: unknown) => {
  if (!(error instanceof ConnectError)) return "LOCAL_ENROLLMENT_FAILED";
  for (const detail of error.findDetails(ApplicationErrorDetailSchema)) {
    const code = decodeApplicationErrorCode(detail.code);
    if (Option.isSome(code)) return code.value;
  }
  return `CONNECT_${codeToString(error.code).toUpperCase()}`;
};

export async function managedComputerEnrollCommand() {
  try {
    await enrollManagedComputerFromInstance();
  } catch (error) {
    const connectMessage = error instanceof ConnectError
      ? error.rawMessage
      : "Managed computer enrollment input or response is invalid";
    console.error(JSON.stringify({
      event: "managed_computer_enrollment_failed",
      errorCode: managedComputerEnrollmentErrorCode(error),
      message: connectMessage,
    }));
    process.exitCode = managedComputerEnrollmentExitCode(error);
  }
}
