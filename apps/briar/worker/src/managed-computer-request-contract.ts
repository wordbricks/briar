import * as Schema from "effect/Schema";
import {
  ManagedComputerEnrollmentProof,
} from "../../src/lib/managed-computer-enrollment-contract";
import { strictSchema, trimmedText, UuidString } from "./schema-codecs";
import { decodeRequestSync } from "./request-schema";

export const ManagedComputerPromotionValidation = strictSchema(Schema.Struct({
  code: trimmedText(1, 100),
}));

export const ManagedComputerApplication = strictSchema(Schema.Struct({
  code: trimmedText(1, 100),
  requestId: UuidString,
}));

export const ManagedComputerRetry = strictSchema(Schema.Struct({
  requestId: UuidString,
}));

export const ManagedComputerSetupSession = strictSchema(Schema.Struct({
  projectId: UuidString,
  requestId: UuidString,
}));

export const ManagedComputerRemoteSessionRequest = strictSchema(Schema.Struct({
  requestId: UuidString,
  reconnectSessionId: Schema.optional(UuidString),
}));

export const InstanceIdentityDocument = strictSchema(Schema.Struct({
  accountId: Schema.String.check(Schema.isPattern(/^\d{12}$/u)),
  architecture: trimmedText(1, 40),
  availabilityZone: trimmedText(1, 40),
  billingProducts: Schema.optional(
    Schema.NullOr(Schema.Array(Schema.String)),
  ),
  devpayProductCodes: Schema.optional(
    Schema.NullOr(Schema.Array(Schema.String)),
  ),
  imageId: Schema.String.check(Schema.isPattern(/^ami-[0-9a-f]+$/u)),
  instanceId: Schema.String.check(Schema.isPattern(/^i-[0-9a-f]+$/u)),
  instanceType: trimmedText(1, 80),
  kernelId: Schema.optional(Schema.NullOr(Schema.String)),
  marketplaceProductCodes: Schema.optional(
    Schema.NullOr(Schema.Array(Schema.String)),
  ),
  pendingTime: trimmedText(1, 80),
  privateIp: trimmedText(1, 80),
  ramdiskId: Schema.optional(Schema.NullOr(Schema.String)),
  region: trimmedText(1, 40),
  version: trimmedText(1, 20),
}));

export const decodeManagedComputerPromotionValidation = decodeRequestSync(
  ManagedComputerPromotionValidation,
);
export const decodeManagedComputerApplication = decodeRequestSync(
  ManagedComputerApplication,
);
export const decodeManagedComputerRetry = decodeRequestSync(
  ManagedComputerRetry,
);
export const decodeManagedComputerSetupSession = decodeRequestSync(
  ManagedComputerSetupSession,
);
export const decodeManagedComputerRemoteSessionRequest = decodeRequestSync(
  ManagedComputerRemoteSessionRequest,
);
export const decodeManagedComputerEnrollmentProof = decodeRequestSync(
  ManagedComputerEnrollmentProof,
);
export const decodeInstanceIdentityDocument = decodeRequestSync(
  InstanceIdentityDocument,
);
