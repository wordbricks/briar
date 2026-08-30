import { createClient } from "@connectrpc/connect";
import {
  AccountService,
  MobilePushEndpoint as ProtoMobilePushEndpoint,
  MobilePushLocale as ProtoMobilePushLocale,
} from "@briar/contracts/gen/briar/app/v1/account_pb";
import type { SessionUser } from "../../types";
import { appCallOptions, appRpc, appTransport } from "./core";

const accountClient = appTransport
  ? createClient(AccountService, appTransport)
  : undefined;

const requireAccountClient = () => {
  if (!accountClient) {
    throw new Error("Briar API URL이 설정되지 않았습니다.");
  }
  return accountClient;
};

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
  return appRpc(async () => {
    const response = await client.getCurrentUser(
      {},
      appCallOptions(token, signal),
    );
    if (response.user === undefined) throw new Error("Current user is missing");
    return {
      id: response.user.id,
      username: response.user.username ?? null,
      name: response.user.name,
      email: response.user.email,
      image: response.user.image ?? null,
    };
  });
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
  await appRpc(async () => {
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
  });
}

export async function unregisterMobilePushDevice(
  sessionToken: string,
  endpoint: MobilePushDeviceEndpoint,
  deviceToken: string,
): Promise<void> {
  const client = requireAccountClient();
  await appRpc(async () => {
    await client.unregisterMobilePushDevice(
      {
        endpoint: mobilePushEndpointToProto(endpoint),
        token: deviceToken,
      },
      appCallOptions(sessionToken),
    );
  });
}
