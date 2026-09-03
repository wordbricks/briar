import { createAuthClient } from "better-auth/client";
import { emailOTPClient } from "better-auth/client/plugins";
import { briarAuthUrl } from "./api-config";
import { browserCookieSessionCredential } from "./session-credential";

export type BrowserAuthLocale = "ko" | "en" | "zh";

export type BrowserAuthFetch = (
  input: Parameters<typeof globalThis.fetch>[0],
  init?: Parameters<typeof globalThis.fetch>[1],
) => ReturnType<typeof globalThis.fetch>;

type BrowserAuthDependencies = {
  fetch?: BrowserAuthFetch;
};

const requestHeaders = (locale: BrowserAuthLocale) => ({
  "x-briar-locale": locale,
});

export function createBrowserAuthClient(
  baseURL: string,
  dependencies: BrowserAuthDependencies = {},
) {
  const client = createAuthClient({
    baseURL,
    plugins: [emailOTPClient()],
    fetchOptions: {
      customFetchImpl: dependencies.fetch ?? globalThis.fetch,
    },
  });

  return {
    async readSessionCredential() {
      const response = await client.getSession();
      if (response.error) throw new Error(response.error.message);
      return response.data?.user ? browserCookieSessionCredential : null;
    },

    async signInWithGoogle(input: {
      callbackURL: string;
      locale: BrowserAuthLocale;
    }) {
      const response = await client.signIn.social({
        provider: "google",
        callbackURL: input.callbackURL,
        fetchOptions: { headers: requestHeaders(input.locale) },
      });
      if (response.error) throw new Error(response.error.message);
    },

    async sendEmailOTP(email: string, locale: BrowserAuthLocale) {
      const response = await client.emailOtp.sendVerificationOtp({
        email,
        type: "sign-in",
        fetchOptions: { headers: requestHeaders(locale) },
      });
      if (response.error) throw new Error(response.error.message);
    },

    async signInWithEmailOTP(input: {
      email: string;
      locale: BrowserAuthLocale;
      otp: string;
    }) {
      const response = await client.signIn.emailOtp({
        email: input.email,
        otp: input.otp,
        name: input.email.split("@")[0] || input.email,
        fetchOptions: { headers: requestHeaders(input.locale) },
      });
      if (response.error) throw new Error(response.error.message);
    },

    async signOut() {
      const response = await client.signOut();
      if (response.error) throw new Error(response.error.message);
    },
  };
}

export const browserAuthClient = createBrowserAuthClient(briarAuthUrl);
