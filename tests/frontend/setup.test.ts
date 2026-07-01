import { describe, expect, it } from "vitest";

describe("frontend test setup", () => {
  it("installs browser testing shims", () => {
    expect(globalThis.ResizeObserver).toBeDefined();
    expect(window.matchMedia("(prefers-color-scheme: dark)").matches).toBe(false);
    expect(document.body).toBeInTheDocument();
  });
});
