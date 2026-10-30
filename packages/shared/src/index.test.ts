import { describe, expect, it } from "vitest";
import { ERROR_CODES, PROTOCOL_VERSION, VARIANTS } from "./index";

describe("shared constants", () => {
  it("protocol version is 1", () => expect(PROTOCOL_VERSION).toBe(1));
  it("exposes both variants", () => expect([...VARIANTS]).toEqual(["classic", "no_mercy"]));
  it("error codes are unique", () => expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length));
});
