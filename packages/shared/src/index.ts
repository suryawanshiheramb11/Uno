export const PROTOCOL_VERSION = 1 as const;
export const VARIANTS = ["classic", "no_mercy"] as const;
export type Variant = (typeof VARIANTS)[number];
export type Environment = "local" | "staging" | "production";

export const ERROR_CODES = [
  "ERR_PROTOCOL_UNSUPPORTED",
  "ERR_UNAUTHORIZED",
  "ERR_FORBIDDEN",
  "ERR_VALIDATION",
  "ERR_CONFLICT",
  "ERR_NOT_FOUND",
  "ERR_RATE_LIMITED",
  "ERR_INTERNAL",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface HealthResponse {
  ok: true;
  environment: Environment;
  version: string;
}

export interface ProtocolResponse {
  protocolVersion: typeof PROTOCOL_VERSION;
  variants: readonly Variant[];
}

/** i18n string tables; English only for now. */
export const STRINGS = {
  en: {
    title: "UNO",
    tagline: "Play Classic and No Mercy with friends, anywhere.",
    signIn: "Sign in",
    statusChecking: "Checking…",
    statusOffline: "Offline",
  },
} as const;

export * from "./profile";
