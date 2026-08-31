import { createClient } from "@connectrpc/connect";
import {
  AccountService,
  MobilePushEndpoint as ProtoMobilePushEndpoint,
  MobilePushLocale as ProtoMobilePushLocale,
} from "@briar/contracts/gen/briar/app/v1/account_pb";
import type { User } from "@briar/contracts/gen/briar/app/v1/common_pb";
import type { SessionUser } from "../../types";
import { appCallOptions, appTransport } from "./core";
import { requiredMessage } from "./mappers";

const accountClient = appTransport
  ? createClient(AccountService, appTransport)
  : undefined;

const requireAccountClient = () => {
  if (!accountClient) {
    throw new Error("Briar API URL이 설정되지 않았습니다.");
  }
  return accountClient;
};

export type AccountProfileInput = {
  readonly username: string | null;
  readonly name: string;
  readonly image: string | null;
};

export const sessionUserFromProto = (user: User): SessionUser => ({
  id: user.id,
  username: user.username ?? null,
  name: user.name,
  email: user.email,
  image: user.image ?? null,
});

export const accountProfileUpdateToProto = (input: AccountProfileInput) => ({
  usernameUpdate: input.username === null
    ? { case: "clearUsername" as const, value: {} }
    : { case: "username" as const, value: input.username },
  name: input.name,
  imageUpdate: input.image === null
    ? { case: "clearImage" as const, value: {} }
    : { case: "image" as const, value: input.image },
});

export type MobilePushDeviceEndpoint =
  | "apns-development"
  | "apns-production"
  | "fcm";

export type MobilePushDeviceLocale = "ko" | "en" | "zh";

const mobilePushEndpointToProto = (
  endpoint: MobilePushDeviceEndpoint,
): ProtoMobilePushEndpoint => {
  switch (endpoint) {
    case "apns-development":
      return ProtoMobilePushEndpoint.APNS_DEVELOPMENT;
    case "apns-production":
      return ProtoMobilePushEndpoint.APNS_PRODUCTION;
    case "fcm":
      return ProtoMobilePushEndpoint.FCM;
  }
};

const mobilePushLocaleToProto = (
  locale: MobilePushDeviceLocale,
): ProtoMobilePushLocale => {
  switch (locale) {
    case "ko":
      return ProtoMobilePushLocale.KO;
    case "en":
      return ProtoMobilePushLocale.EN;
    case "zh":
      return ProtoMobilePushLocale.ZH;
  }
};

export async function getCurrentUser(
  token: string,
  signal?: AbortSignal,
): Promise<SessionUser> {
  const client = requireAccountClient();
  const response = await client.getCurrentUser(
    {},
    appCallOptions(token, signal),
  );
  return sessionUserFromProto(requiredMessage(
    response.user,
    "getCurrentUser.user",
  ));
}

export async function updateCurrentUserProfile(
  token: string,
  input: AccountProfileInput,
): Promise<SessionUser> {
  const client = requireAccountClient();
  const response = await client.updateAccountProfile(
    accountProfileUpdateToProto(input),
    appCallOptions(token),
  );
  return sessionUserFromProto(requiredMessage(
    response.user,
    "updateAccountProfile.user",
  ));
}

export async function deleteCurrentUser(
  token: string,
  confirmation: string,
): Promise<void> {
  const client = requireAccountClient();
  await client.deleteAccount(
    { confirmation },
    appCallOptions(token),
  );
}

export async function registerMobilePushDevice(
  sessionToken: string,
  input: {
    readonly endpoint: MobilePushDeviceEndpoint;
    readonly deviceToken: string;
    readonly locale: MobilePushDeviceLocale;
    readonly playSound: boolean;
    readonly urgent: boolean;
    readonly actionRequired: boolean;
    readonly important: boolean;
    readonly activity: boolean;
  },
): Promise<void> {
  const client = requireAccountClient();
  await client.registerMobilePushDevice(
    {
      endpoint: mobilePushEndpointToProto(input.endpoint),
      token: input.deviceToken,
      locale: mobilePushLocaleToProto(input.locale),
      preferences: {
        playSound: input.playSound,
        urgent: input.urgent,
        actionRequired: input.actionRequired,
        important: input.important,
        activity: input.activity,
      },
    },
    appCallOptions(sessionToken),
  );
}

export async function unregisterMobilePushDevice(
  sessionToken: string,
  endpoint: MobilePushDeviceEndpoint,
  deviceToken: string,
): Promise<void> {
  const client = requireAccountClient();
  await client.unregisterMobilePushDevice(
    {
      endpoint: mobilePushEndpointToProto(endpoint),
      token: deviceToken,
    },
    appCallOptions(sessionToken),
  );
}
