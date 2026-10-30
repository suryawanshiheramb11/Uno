import { describe, expect, it } from "vitest";
import { chooseBotAction } from "./index";

const red5 = { id: "a", color: "red", face: "number", value: 5 } as const;
const blue2 = { id: "b", color: "blue", face: "number", value: 2 } as const;

describe("chooseBotAction", () => {
  it("plays the first playable card", () =>
    expect(chooseBotAction([blue2, red5], (c) => c.color === "red")).toEqual({
      type: "play",
      cardId: "a",
    }));
  it("draws when nothing is playable", () =>
    expect(chooseBotAction([blue2], () => false)).toEqual({ type: "draw" }));
});
