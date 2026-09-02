import { createAuthClient } from "better-auth/client";
import {
  deviceAuthorizationClient as betterAuthDeviceAuthorizationClient,
} from "better-auth/client/plugins";
import * as Schema from "effect/Schema";

const exhaustiveLiterals =
  <Expected extends string>() =>
  <const Actual extends readonly Expected[]>(
    values: Actual &
      ([Exclude<Expected, Actual[number]>] extends [never]
        ? unknown
        : { readonly missing: Exclude<Expected, Actual[number]> }),
  ) => values;

const deviceCodeErrorCodes =
  exhaustiveLiterals<OfficialDeviceCodeErrorCode>()([
    "invalid_request",
    "invalid_client",
  ]);

const deviceTokenErrorCodes =
  exhaustiveLiterals<OfficialDeviceTokenErrorCode>()([
    "authorization_pending",
    "slow_down",
    "expired_token",
    "access_denied",
    "invalid_request",
    "invalid_grant",
  ]);

const DeviceCodeResponse = Schema.Struct({
  device_code: Schema.NonEmptyString,
  user_code: Schema.NonEmptyString,
  verification_uri: Schema.NonEmptyString,
  verification_uri_complete: Schema.NonEmptyString,
  expires_in: Schema.Int.check(Schema.isGreaterThan(0)),
  interval: Schema.Int.check(Schema.isGreaterThan(0)),
});

const DeviceCodeError = Schema.Struct({
  error: Schema.Literals(deviceCodeErrorCodes),
  error_description: Schema.NonEmptyString,
});

const DeviceTokenResponse = Schema.Struct({
  access_token: Schema.NonEmptyString,
  token_type: Schema.NonEmptyString,
  expires_in: Schema.Int.check(Schema.isGreaterThan(0)),
  scope: Schema.String,
});

const DeviceTokenError = Schema.Struct({
  error: Schema.Literals(deviceTokenErrorCodes),
  error_description: Schema.NonEmptyString,
});

const deviceCodeOutput = Schema.toStandardSchemaV1(DeviceCodeResponse);
const deviceCodeError = Schema.toStandardSchemaV1(DeviceCodeError);
const deviceTokenOutput = Schema.toStandardSchemaV1(DeviceTokenResponse);
const deviceTokenError = Schema.toStandardSchemaV1(DeviceTokenError);

export type DeviceAuthorizationFetch = (
  input: Parameters<typeof globalThis.fetch>[0],
  init?: Parameters<typeof globalThis.fetch>[1],
) => ReturnType<typeof globalThis.fetch>;

const createOfficialClient = (
  apiUrl: string,
  fetch: DeviceAuthorizationFetch,
) => createAuthClient({
  baseURL: apiUrl,
  plugins: [betterAuthDeviceAuthorizationClient()],
  fetchOptions: { customFetchImpl: fetch },
});

type OfficialClient = ReturnType<typeof createOfficialClient>;
type OfficialDeviceCodeRequest = Parameters<
  OfficialClient["device"]["code"]
>[0];
type OfficialDeviceTokenRequest = Parameters<
  OfficialClient["device"]["token"]
>[0];
type OfficialDeviceCodeResponse = NonNullable<
  Awaited<ReturnType<OfficialClient["device"]["code"]>>["data"]
>;
type OfficialDeviceTokenResponse = NonNullable<
  Awaited<ReturnType<OfficialClient["device"]["token"]>>["data"]
>;
type StandardSchemaOutput<Schema extends {
  readonly "~standard": { readonly types?: unknown };
}> = NonNullable<Schema["~standard"]["types"]> extends {
  readonly output: infer Output;
}
  ? Output
  : never;
type OfficialDeviceAuthorizationPlugin = ReturnType<
  typeof betterAuthDeviceAuthorizationClient
>["$InferServerPlugin"];
type OfficialDeviceCodeErrorCode = StandardSchemaOutput<
  OfficialDeviceAuthorizationPlugin["endpoints"]["deviceCode"]["options"]["error"]
>["error"];
type OfficialDeviceTokenErrorCode = StandardSchemaOutput<
  OfficialDeviceAuthorizationPlugin["endpoints"]["deviceToken"]["options"]["error"]
>["error"];
type DeviceTokenPollingStatus = Extract<
  OfficialDeviceTokenErrorCode,
  | "authorization_pending"
  | "slow_down"
  | "expired_token"
  | "access_denied"
>;
type DeviceAuthorizationRequestErrorCode =
  | OfficialDeviceCodeErrorCode
  | Extract<
      OfficialDeviceTokenErrorCode,
      "invalid_request" | "invalid_grant"
    >;

export type DeviceAuthorizationClientId =
  | "briar-mobile"
  | "briar-android"
  | "briar-desktop"
  | "briar-web"
  | "briar-cli";

export type DeviceAuthorizationLaunchOptions = {
  method?: "email" | "google";
  locale?: "ko" | "en" | "zh";
  switchAccount?: boolean;
};

export const createDeviceVerificationUrl = (
  verificationUriComplete: string,
  clientId: Exclude<DeviceAuthorizationClientId, "briar-cli">,
  options: DeviceAuthorizationLaunchOptions = {},
) => {
  const verificationUrl = new URL(verificationUriComplete);
  if (clientId === "briar-mobile" || clientId === "briar-android") {
    verificationUrl.searchParams.set("client", "mobile");
  } else if (clientId === "briar-web") {
    verificationUrl.searchParams.set("client", "web");
  }
  if (options.method) {
    verificationUrl.searchParams.set("method", options.method);
  }
  if (options.locale) {
    verificationUrl.searchParams.set("locale", options.locale);
  }
  if (options.switchAccount) {
    verificationUrl.searchParams.set("switch_account", "1");
  }
  return verificationUrl.toString();
};

export type DeviceAuthorizationCode = {
  deviceCode: OfficialDeviceCodeResponse["device_code"];
  userCode: OfficialDeviceCodeResponse["user_code"];
  verificationUri: OfficialDeviceCodeResponse["verification_uri"];
  verificationUriComplete:
    OfficialDeviceCodeResponse["verification_uri_complete"];
  expiresIn: OfficialDeviceCodeResponse["expires_in"];
  interval: OfficialDeviceCodeResponse["interval"];
};

export type DeviceTokenPollResult =
  | {
    status: "authorized";
    accessToken: OfficialDeviceTokenResponse["access_token"];
    tokenType: OfficialDeviceTokenResponse["token_type"];
    expiresIn: OfficialDeviceTokenResponse["expires_in"];
    scope: OfficialDeviceTokenResponse["scope"];
  }
  | {
    status: DeviceTokenPollingStatus;
    description: string;
  };

export class DeviceAuthorizationProtocolError extends Error {
  constructor(endpoint: "device code" | "device token") {
    super(`Better Auth returned an invalid ${endpoint} response`);
    this.name = "DeviceAuthorizationProtocolError";
  }
}

export class DeviceAuthorizationRequestError extends Error {
  constructor(
    readonly code: DeviceAuthorizationRequestErrorCode,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "DeviceAuthorizationRequestError";
  }
}

const decodeDeviceCodeError = async (input: unknown) => {
  const result = await deviceCodeError["~standard"].validate(input);
  if (result.issues) {
    throw new DeviceAuthorizationProtocolError("device code");
  }
  return result.value;
};

const decodeDeviceTokenError = async (input: unknown) => {
  const result = await deviceTokenError["~standard"].validate(input);
  if (result.issues) {
    throw new DeviceAuthorizationProtocolError("device token");
  }
  return result.value;
};

export function createDeviceAuthorizationClient(
  apiUrl: string,
  dependencies: { fetch?: DeviceAuthorizationFetch } = {},
) {
  const client = createOfficialClient(
    apiUrl,
    dependencies.fetch ?? globalThis.fetch,
  );

  return {
    async requestCode(input: {
      clientId: DeviceAuthorizationClientId &
        OfficialDeviceCodeRequest["client_id"];
      scope?: OfficialDeviceCodeRequest["scope"];
    }): Promise<DeviceAuthorizationCode> {
      const response = await client.device.code({
        client_id: input.clientId,
        scope: input.scope,
        fetchOptions: { output: deviceCodeOutput },
      });
      if (response.error) {
        const error = await decodeDeviceCodeError(response.error);
        throw new DeviceAuthorizationRequestError(
          error.error,
          response.error.status,
          error.error_description,
        );
      }
      const data: OfficialDeviceCodeResponse = response.data;
      return {
        deviceCode: data.device_code,
        userCode: data.user_code,
        verificationUri: data.verification_uri,
        verificationUriComplete: data.verification_uri_complete,
        expiresIn: data.expires_in,
        interval: data.interval,
      };
    },

    async pollToken(input: {
      clientId: DeviceAuthorizationClientId &
        OfficialDeviceTokenRequest["client_id"];
      deviceCode: OfficialDeviceTokenRequest["device_code"];
    }): Promise<DeviceTokenPollResult> {
      const response = await client.device.token({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: input.deviceCode,
        client_id: input.clientId,
        fetchOptions: { output: deviceTokenOutput },
      });
      if (response.data) {
        const data: OfficialDeviceTokenResponse = response.data;
        return {
          status: "authorized",
          accessToken: data.access_token,
          tokenType: data.token_type,
          expiresIn: data.expires_in,
          scope: data.scope,
        };
      }
      const error = await decodeDeviceTokenError(response.error);
      switch (error.error) {
        case "authorization_pending":
        case "slow_down":
        case "expired_token":
        case "access_denied":
          return {
            status: error.error,
            description: error.error_description,
          };
        case "invalid_request":
        case "invalid_grant":
          throw new DeviceAuthorizationRequestError(
            error.error,
            response.error.status,
            error.error_description,
          );
      }
    },
  };
}

export type DeviceAuthorizationClient = ReturnType<
  typeof createDeviceAuthorizationClient
>;
