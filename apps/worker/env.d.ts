declare namespace Cloudflare {
  interface GlobalProps {
    mainModule: typeof import("./src/index");
    durableNamespaces: "Room" | "Matchmaker" | "Presence";
  }
  interface Env {
    ROOM: DurableObjectNamespace;
    MATCHMAKER: DurableObjectNamespace;
    PRESENCE: DurableObjectNamespace;
    DB: D1Database;
  }
}
