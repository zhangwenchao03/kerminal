import { describe, expect, it } from "vitest";
import {
  acknowledgeSnippetPanelOpenRequest,
  consumePendingSnippetPanelOpenRequest,
  requestSnippetPanelOpen,
} from "../../../../src/features/snippets/snippetPanelEvents";

describe("snippetPanelEvents", () => {
  it("consumes a pending navigation request only once", () => {
    requestSnippetPanelOpen({ paneId: "pane-a", snippetId: "snippet-a" });

    expect(consumePendingSnippetPanelOpenRequest()).toEqual({
      paneId: "pane-a",
      snippetId: "snippet-a",
    });
    expect(consumePendingSnippetPanelOpenRequest()).toBeNull();
  });

  it("clears a live request after the mounted panel acknowledges it", () => {
    const request = { paneId: "pane-a", snippetId: "snippet-live" };
    requestSnippetPanelOpen(request);
    acknowledgeSnippetPanelOpenRequest(request);

    expect(consumePendingSnippetPanelOpenRequest()).toBeNull();
  });
});
