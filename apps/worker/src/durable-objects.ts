import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";

// Declared now so the namespaces and migrations exist; behaviour arrives in later phases.
export class Room extends DurableObject<Env> {
  override async fetch(_request: Request): Promise<Response> {
    return new Response("Room: not implemented", { status: 501 });
  }
}

export class Matchmaker extends DurableObject<Env> {
  override async fetch(_request: Request): Promise<Response> {
    return new Response("Matchmaker: not implemented", { status: 501 });
  }
}

export class Presence extends DurableObject<Env> {
  override async fetch(_request: Request): Promise<Response> {
    return new Response("Presence: not implemented", { status: 501 });
  }
}
