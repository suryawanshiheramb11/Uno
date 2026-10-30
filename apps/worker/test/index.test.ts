import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const call = (path: string, init?: RequestInit) =>
  exports.default.fetch(new Request(`https://staging.uno.example.com${path}`, init));

describe("worker routes", () => {
  it("GET /api/health returns ok, environment and version", async () => {
    const res = await call("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, environment: "staging", version: "abc123" });
  });

  it("GET /api/protocol returns version and variants", async () => {
    const res = await call("/api/protocol");
    expect(await res.json()).toEqual({ protocolVersion: 1, variants: ["classic", "no_mercy"] });
  });

  it("unknown /api route is a JSON 404", async () => {
    const res = await call("/api/nope");
    expect(res.status).toBe(404);
    expect(((await res.json()) as any).error.code).toBe("ERR_NOT_FOUND");
  });

  it("POST to /api is rejected", async () => {
    expect((await call("/api/health", { method: "POST" })).status).toBe(405);
  });

  it("non-API paths fall through to the asset binding", async () => {
    const res = await call("/some/spa/route");
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("declares ROOM, MATCHMAKER, PRESENCE and DB bindings", () => {
    expect(env.ROOM).toBeDefined();
    expect(env.MATCHMAKER).toBeDefined();
    expect(env.PRESENCE).toBeDefined();
    expect(env.DB).toBeDefined();
  });
});
