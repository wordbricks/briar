import { betterAuth } from "better-auth";
import { bearer, deviceAuthorization } from "better-auth/plugins";

export function createAuth(env: Env, apiOrigin: string) {
  return betterAuth({
    appName: "Briar",
    baseURL: `${apiOrigin}/api/auth`,
    secret: env.BETTER_AUTH_SECRET,
    database: env.DB,
    trustedOrigins: [
      apiOrigin,
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
          clientId === "briar-android" ||
          clientId === "briar-desktop" ||
          clientId === "briar-cli",
      }),
    ],
  });
}

export type BriarAuth = ReturnType<typeof createAuth>;
