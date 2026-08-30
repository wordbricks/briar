import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export type EncryptedEnvPolicy = {
  publicKey: string;
  secrets: readonly string[];
  optionalSecrets?: readonly string[];
};

export const encryptedEnvPolicies = {
  ".env.production": {
    publicKey: "DOTENV_PUBLIC_KEY_PRODUCTION",
    secrets: [
      "BETTER_AUTH_SECRET",
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
      "SLACK_CLIENT_ID",
      "SLACK_CLIENT_SECRET",
      "SLACK_SIGNING_SECRET",
      "SLACK_TOKEN_ENCRYPTION_KEY",
      "MANAGED_COMPUTER_PROMOTION_CODE",
      "MANAGED_COMPUTER_ENROLLMENT_SECRET",
      "MANAGED_COMPUTER_AWS_ACCESS_KEY_ID",
      "MANAGED_COMPUTER_AWS_SECRET_ACCESS_KEY",
    ],
    optionalSecrets: [
      "GITHUB_APP_ID",
      "GITHUB_APP_PRIVATE_KEY",
      "GITHUB_APP_CLIENT_ID",
      "GITHUB_APP_CLIENT_SECRET",
      "GITHUB_APP_SLUG",
      "GITHUB_CALLBACK_ORIGIN",
      "GITHUB_WEBHOOK_SECRET",
      "MANAGED_COMPUTER_AWS_SESSION_TOKEN",
      "APNS_KEY_ID",
      "APNS_PRIVATE_KEY",
      "FIREBASE_PROJECT_ID",
      "FIREBASE_CLIENT_EMAIL",
      "FIREBASE_PRIVATE_KEY",
    ],
  },
  ".env.release": {
    publicKey: "DOTENV_PUBLIC_KEY_RELEASE",
    secrets: [
      "APPLE_CERTIFICATE",
      "APPLE_CERTIFICATE_PASSWORD",
      "IOS_DISTRIBUTION_CERTIFICATE",
      "IOS_DISTRIBUTION_CERTIFICATE_PASSWORD",
      "KEYCHAIN_PASSWORD",
      "APPLE_API_KEY_CONTENT",
      "TAURI_SIGNING_PRIVATE_KEY",
      "TAURI_SIGNING_PRIVATE_KEY_PASSWORD",
      "CLOUDFLARE_API_TOKEN",
      "ANDROID_KEYSTORE_BASE64",
      "ANDROID_KEYSTORE_PASSWORD",
      "ANDROID_KEY_ALIAS",
      "ANDROID_KEY_PASSWORD",
    ],
  },
} satisfies Readonly<Record<string, EncryptedEnvPolicy>>;

function unquote(value: string) {
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

export function verifyEncryptedEnv(
  filename: string,
  source: string,
  policy: EncryptedEnvPolicy,
) {
  const entries = new Map<string, string>();
  for (const [index, rawLine] of source.split(/\r?\n/u).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/u.exec(line);
    if (!match) throw new Error(`${filename}:${index + 1} is not a dotenv assignment.`);
    const [, key, rawValue] = match;
    if (entries.has(key)) throw new Error(`${filename} contains duplicate ${key}.`);
    entries.set(key, unquote(rawValue));
  }

  const allowed = new Set([
    policy.publicKey,
    ...policy.secrets,
    ...(policy.optionalSecrets ?? []),
  ]);
  for (const key of entries.keys()) {
    if (!allowed.has(key)) throw new Error(`${filename} contains unexpected ${key}.`);
  }
  for (const key of [policy.publicKey, ...policy.secrets]) {
    if (!entries.has(key)) throw new Error(`${filename} is missing ${key}.`);
  }

  const publicKey = entries.get(policy.publicKey) ?? "";
  if (!/^(02|03)[0-9a-f]{64}$/u.test(publicKey)) {
    throw new Error(`${filename} contains an invalid dotenvx public key.`);
  }
  for (const key of policy.secrets) {
    if (!/^encrypted:[A-Za-z0-9+/=]+$/u.test(entries.get(key) ?? "")) {
      throw new Error(`${filename} requires encrypted ciphertext for ${key}.`);
    }
  }
  for (const key of policy.optionalSecrets ?? []) {
    const value = entries.get(key);
    if (value !== undefined && !/^encrypted:[A-Za-z0-9+/=]+$/u.test(value)) {
      throw new Error(`${filename} requires encrypted ciphertext for ${key}.`);
    }
  }
}

if (import.meta.main) {
  const workspaceRoot = resolve(import.meta.dir, "..");
  for (const [filename, policy] of Object.entries(encryptedEnvPolicies)) {
    const source = await readFile(resolve(workspaceRoot, filename), "utf8");
    verifyEncryptedEnv(filename, source, policy);
  }
  console.log("Verified checked-in environment files contain ciphertext only.");
}
