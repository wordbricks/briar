import {
  AccountService,
  MobilePushEndpoint,
  MobilePushLocale,
} from "@briar/contracts/gen/briar/app/v1/account_pb";
import {
  Code,
  ConnectError,
  type ConnectRouter,
  type ServiceImpl,
} from "@connectrpc/connect";
import * as Schema from "effect/Schema";
import type { BriarAuth } from "./auth";
import { withConnectErrors } from "./app-connect-errors";
import { appUser } from "./app-connect-mappers";
import {
  deleteMobilePushRegistration,
  upsertMobilePushRegistration,
} from "./mobile-push-repository";
import { decodeRequestSync } from "./request-schema";
import { requireSession } from "./session-auth";

export type AppConnectAccountInput = {
  readonly request: Request;
  readonly auth: BriarAuth;
  readonly db: D1Database;
};

export type AppConnectAccountServices = {
  readonly requireSession: typeof requireSession;
  readonly registerMobilePushDevice: typeof upsertMobilePushRegistration;
  readonly unregisterMobilePushDevice: typeof deleteMobilePushRegistration;
};

export const appConnectAccountServices: AppConnectAccountServices = {
  requireSession,
  registerMobilePushDevice: upsertMobilePushRegistration,
  unregisterMobilePushDevice: deleteMobilePushRegistration,
};

const mobilePushTokenSchema = Schema.Trim.check(
  Schema.isLengthBetween(32, 4_096),
);
const mobilePushLocaleSchema = Schema.Literals(["ko", "en", "zh"]);
const mobilePushPreferencesSchema = Schema.Struct({
  playSound: Schema.Boolean,
  urgent: Schema.Boolean,
  actionRequired: Schema.Boolean,
  important: Schema.Boolean,
  activity: Schema.Boolean,
});

const decodeMobilePushToken = decodeRequestSync(mobilePushTokenSchema);
const decodeMobilePushLocale = decodeRequestSync(mobilePushLocaleSchema);
const decodeMobilePushPreferences = decodeRequestSync(
  mobilePushPreferencesSchema,
);

const mobilePushEndpoint = (endpoint: MobilePushEndpoint) => {
  switch (endpoint) {
    case MobilePushEndpoint.APNS_DEVELOPMENT:
      return {
        platform: "apns",
        environment: "development",
        topic: "app.briar.companion.native.dev",
      } as const;
    case MobilePushEndpoint.APNS_PRODUCTION:
      return {
        platform: "apns",
        environment: "production",
        topic: "app.briar.companion",
      } as const;
    case MobilePushEndpoint.FCM:
      return {
        platform: "fcm",
        environment: "production",
        topic: "app.briar.companion",
      } as const;
    case MobilePushEndpoint.UNSPECIFIED:
    default:
      throw new ConnectError(
        "mobile push endpoint is required",
        Code.InvalidArgument,
      );
  }
};

const mobilePushLocale = (locale: MobilePushLocale) => {
  switch (locale) {
    case MobilePushLocale.KO:
      return decodeMobilePushLocale("ko");
    case MobilePushLocale.EN:
      return decodeMobilePushLocale("en");
    case MobilePushLocale.ZH:
      return decodeMobilePushLocale("zh");
    case MobilePushLocale.UNSPECIFIED:
    default:
      throw new ConnectError(
        "mobile push locale is required",
        Code.InvalidArgument,
      );
  }
};

export const createAppAccountService = (
  { request, auth, db }: AppConnectAccountInput,
  services: AppConnectAccountServices = appConnectAccountServices,
): ServiceImpl<typeof AccountService> => ({
  getCurrentUser: async () => withConnectErrors(async () => {
    const session = await services.requireSession(auth, request);
    return { user: appUser(session.user) };
  }),

  registerMobilePushDevice: async (rpcRequest) =>
    withConnectErrors(async () => {
      const session = await services.requireSession(auth, request);
      const endpoint = mobilePushEndpoint(rpcRequest.endpoint);
      await services.registerMobilePushDevice(
        db,
        session.user.id,
        {
          ...endpoint,
          token: decodeMobilePushToken(rpcRequest.token),
          locale: mobilePushLocale(rpcRequest.locale),
          preferences: decodeMobilePushPreferences(rpcRequest.preferences),
        },
        new Date().toISOString(),
      );
      return {};
    }),

  unregisterMobilePushDevice: async (rpcRequest) =>
    withConnectErrors(async () => {
      const session = await services.requireSession(auth, request);
      const endpoint = mobilePushEndpoint(rpcRequest.endpoint);
      await services.unregisterMobilePushDevice(
        db,
        session.user.id,
        endpoint.platform,
        decodeMobilePushToken(rpcRequest.token),
      );
      return {};
    }),
});

export function registerAppAccountService(
  router: ConnectRouter,
  input: AppConnectAccountInput,
  services: AppConnectAccountServices = appConnectAccountServices,
) {
  router.service(AccountService, createAppAccountService(input, services));
}
