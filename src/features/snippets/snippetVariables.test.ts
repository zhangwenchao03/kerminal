import { describe, expect, it } from "vitest";
import {
  extractSnippetVariables,
  renderSnippetCommand,
} from "./snippetVariables";

describe("snippetVariables", () => {
  it("extracts unique variables in first-seen order", () => {
    expect(
      extractSnippetVariables(
        "ssh {{ host }} && tail -f {{path}} && echo {{host}} {{ }}",
      ),
    ).toEqual(["host", "path"]);
  });

  it("renders variables while preserving command body", () => {
    expect(
      renderSnippetCommand("echo {{ name }}\ncd {{dir}}", {
        dir: "/tmp/app",
        name: "Kerminal",
      }),
    ).toBe("echo Kerminal\ncd /tmp/app");
  });

  it("renders missing values as empty strings", () => {
    expect(renderSnippetCommand("echo {{missing}}", {})).toBe("echo ");
  });
});
