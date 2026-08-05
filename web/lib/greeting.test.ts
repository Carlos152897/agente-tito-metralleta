import { describe, expect, it } from "vitest";
import { timeGreeting } from "./greeting";

describe("timeGreeting", () => {
  it("mañana antes de las 12", () => {
    expect(timeGreeting(new Date(2026, 0, 1, 9, 0))).toBe("Good morning!");
    expect(timeGreeting(new Date(2026, 0, 1, 11, 59))).toBe("Good morning!");
  });

  it("tarde entre las 12 y las 18", () => {
    expect(timeGreeting(new Date(2026, 0, 1, 12, 0))).toBe("Good afternoon!");
    expect(timeGreeting(new Date(2026, 0, 1, 17, 59))).toBe("Good afternoon!");
  });

  it("noche desde las 18", () => {
    expect(timeGreeting(new Date(2026, 0, 1, 18, 0))).toBe("Good evening!");
    expect(timeGreeting(new Date(2026, 0, 1, 23, 59))).toBe("Good evening!");
  });
});
