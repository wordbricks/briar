import { MemoryVaultError } from "./errors";

/**
 * Rejects memory content that carries a credential (spec §4: passwords,
 * tokens, one-time codes, card numbers, private keys). Patterns favour shapes
 * that are unambiguous, so ordinary prose about passwords or tokens passes and
 * only something that looks like the secret itself is refused. The matched
 * value is never echoed back.
 */
export type SecretKind =
  | "private_key"
  | "api_token"
  | "aws_access_key"
  | "jwt"
  | "password"
  | "credential_assignment"
  | "card_number"
  | "one_time_code";

type Rule = { readonly kind: SecretKind; readonly pattern: RegExp; readonly accept?: (match: RegExpExecArray) => boolean };

const PLACEHOLDER = /^(?:<[^>]*>|\[[^\]]*\]|\(?(?:redacted|hidden|none|n\/a|null|unset|empty|tbd|생략|비공개)\)?|\*{3,}|x{3,}|\.{3,}|…|"?\$\{?[A-Z_]+\}?"?)$/iu;

/** A value worth treating as a secret: not a placeholder, and not a plain lowercase word. */
const secretLike = (value: string) => {
  const trimmed = value.replace(/^["'`]|["'`.,;]$/gu, "");
  if (trimmed.length < 4 || PLACEHOLDER.test(trimmed)) return false;
  return /\d/u.test(trimmed) || /[^\p{L}\p{N}]/u.test(trimmed) || (/\p{Lu}/u.test(trimmed) && /\p{Ll}/u.test(trimmed));
};

const luhn = (digits: string) => {
  let sum = 0;
  for (let index = 0; index < digits.length; index += 1) {
    let digit = Number(digits[digits.length - 1 - index]);
    if (index % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
};

const RULES: readonly Rule[] = [
  { kind: "private_key", pattern: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/u },
  // Provider tokens with distinctive prefixes.
  { kind: "api_token", pattern: /\bsk-(?:proj-|ant-(?:api\d{2}-)?|live-|svcacct-)?[A-Za-z0-9_-]{20,}/u },
  { kind: "api_token", pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/u },
  { kind: "api_token", pattern: /\bgithub_pat_[A-Za-z0-9_]{30,}\b/u },
  { kind: "api_token", pattern: /\bglpat-[A-Za-z0-9_-]{20,}\b/u },
  { kind: "api_token", pattern: /\bart_v\d+_[A-Za-z0-9_-]{16,}/u },
  { kind: "api_token", pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}/u },
  { kind: "api_token", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/u },
  { kind: "api_token", pattern: /\b(?:sk|rk)_(?:live|test)_[0-9A-Za-z]{16,}\b/u },
  { kind: "api_token", pattern: /\bnpm_[A-Za-z0-9]{36}\b/u },
  // Briar's own credentials: briar_worker_…, briar_claim_…, briar_channel_claim_….
  // Table names such as briar_memory_vault_records never end in a long,
  // digit-bearing segment, so they do not match.
  {
    kind: "api_token",
    pattern: /\bbriar_[a-z]+(?:_[a-z]+)*_([A-Za-z0-9-]{16,})/u,
    accept: (match) => /\d/u.test(match[1]),
  },
  { kind: "aws_access_key", pattern: /\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/u },
  { kind: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/u },
  // "password: hunter2", "pwd=…", "비밀번호는 abcd1234".
  {
    kind: "password",
    pattern: /(?:\b(?:password|passwd|passphrase|pwd|passcode)\b|비밀\s?번호|패스워드|암호)\s*(?:[:=]|\bis\b|는|은|:\s*는)\s*(\S+)/iu,
    accept: (match) => secretLike(match[1]),
  },
  {
    kind: "credential_assignment",
    pattern: /\b(?:api[_-]?key|secret(?:[_-]?key)?|access[_-]?key|private[_-]?key|client[_-]?secret|auth[_-]?token|access[_-]?token|refresh[_-]?token|bearer|token)\b\s*[:=]\s*["'`]?([A-Za-z0-9_\-./+=]{16,})/iu,
    accept: (match) => /\d/u.test(match[1]) && /[A-Za-z]/u.test(match[1]),
  },
  { kind: "credential_assignment", pattern: /\bAuthorization:\s*Bearer\s+[A-Za-z0-9_\-.=]{16,}/iu },
  // One-time codes: "인증번호 123456", "verification code: 482913", "code 123456", "OTP 4829".
  {
    kind: "one_time_code",
    pattern: /(?:인증\s?번호|인증\s?코드|보안\s?코드|확인\s?코드|\bOTP\b|\b(?:verification|security|login|sign-?in|one[- ]time|2fa|mfa|sms|auth(?:entication)?)\s+code\b)\s*(?:is|는|은|:|=)?\s*[:=]?\s*\d{4,8}\b/iu,
  },
  { kind: "one_time_code", pattern: /\bcode\s*(?:is|:)?\s*\d{6}\b/iu },
  // Card numbers: 13-19 digits (spaces or dashes allowed) on a major network prefix that pass Luhn.
  {
    kind: "card_number",
    pattern: /(?<![\d-])([2-6]\d{3}(?:[ -]?\d){9,15})(?![\d-])/u,
    accept: (match) => {
      const digits = match[1].replace(/[ -]/gu, "");
      return digits.length >= 13 && digits.length <= 19 && luhn(digits);
    },
  },
];

export function detectSecrets(text: string): SecretKind[] {
  const found = new Set<SecretKind>();
  for (const rule of RULES) {
    const pattern = new RegExp(rule.pattern.source, `${rule.pattern.flags.replace("g", "")}g`);
    for (const match of text.matchAll(pattern)) {
      if (!rule.accept || rule.accept(match as RegExpExecArray)) {
        found.add(rule.kind);
        break;
      }
    }
  }
  return [...found];
}

export function assertNoSecrets(text: string) {
  const kinds = detectSecrets(text);
  if (kinds.length > 0) {
    throw new MemoryVaultError(
      "secret_detected",
      `Memory never stores secrets; remove the ${kinds.join(", ").replaceAll("_", " ")} and save again`,
    );
  }
}
