import type { ErrorCode, MeResponse, MatchesResponse, Preferences, Profile } from "@uno/shared";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode | "ERR_NETWORK",
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: { ...(init?.body ? { "content-type": "application/json" } : {}), ...init?.headers },
    });
  } catch {
    throw new ApiError(0, "ERR_NETWORK", "Could not reach the server.");
  }
  const body = (await response.json().catch(() => null)) as {
    error?: { code: ErrorCode; message: string };
  } | null;
  if (!response.ok) {
    throw new ApiError(
      response.status,
      body?.error?.code ?? "ERR_INTERNAL",
      body?.error?.message ?? "Request failed.",
    );
  }
  return body as T;
}

export const api = {
  me: () => request<MeResponse>("/api/me"),
  updateProfile: (changes: { displayName?: string; avatarSeed?: string }) =>
    request<{ profile: Profile }>("/api/me/profile", {
      method: "PATCH",
      body: JSON.stringify(changes),
    }),
  updatePreferences: (patch: Partial<Preferences>) =>
    request<{ preferences: Preferences }>("/api/me/preferences", {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  matches: (limit = 20) => request<MatchesResponse>(`/api/me/matches?limit=${limit}`),
};
