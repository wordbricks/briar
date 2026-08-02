import { betterAuth } from "better-auth";
import { bearer, deviceAuthorization } from "better-auth/plugins";
import { isMobileClientId } from "./mobile-contract";

export function createAuth(env: Env, apiOrigin: string) {
  return betterAuth({
    appName: "Briar",
    baseURL: `${apiOrigin}/api/auth`,
    secret: env.BETTER_AUTH_SECRET,
    database: env.DB,
    user: {
      additionalFields: {
        username: {
          type: "string",
          required: false,
          input: false,
        },
      },
    },
    trustedOrigins: [
      apiOrigin,
      "https://briar.wordbricks.ai",
      "http://localhost:1420",
      "tauri://localhost",
      "http://tauri.localhost",
    ],
    advanced: {
      ipAddress: {
        ipAddressHeaders: ["cf-connecting-ip"],
      },
    },
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
      },
    },
    plugins: [
      bearer(),
      deviceAuthorization({
        verificationUri: `${apiOrigin}/device`,
        validateClient: async (clientId) =>
          isMobileClientId(clientId) ||
          clientId === "briar-desktop" ||
          clientId === "briar-web" ||
          clientId === "briar-cli",
      }),
    ],
  });
}

export type BriarAuth = ReturnType<typeof createAuth>;
