import { describe, expect, it } from "vitest";
import {
  classifyTerminalGpuRenderer,
  shouldUseAutoGpuRenderer,
} from "../../../../src/features/terminal/terminalRendererPlatform";

describe("terminalRendererPlatform", () => {
  it("disables Auto WebGL only for a definitively software renderer", () => {
    expect(shouldUseAutoGpuRenderer("software")).toBe(false);
    expect(shouldUseAutoGpuRenderer("hardware-or-unknown")).toBe(true);
    expect(shouldUseAutoGpuRenderer("unavailable")).toBe(true);
  });

  it.each([
    "ANGLE (Google, Vulkan SwiftShader Device)",
    "llvmpipe (LLVM 18.1.8, 256 bits)",
    "Microsoft Basic Render Driver",
    "Direct3D11 WARP",
    "Mesa Software Rasterizer",
  ])("classifies software renderer %s", (renderer) => {
    expect(classifyTerminalGpuRenderer(renderer)).toBe("software");
  });

  it("does not classify ordinary hardware renderer names as software", () => {
    expect(
      classifyTerminalGpuRenderer(
        "ANGLE (NVIDIA, NVIDIA GeForce RTX Direct3D11)",
      ),
    ).toBe("hardware-or-unknown");
  });
});
