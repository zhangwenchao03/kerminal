import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { QuickOpenPalette } from "../../../../src/features/quick-open/QuickOpenPalette";
import type { QuickOpenCoordinator } from "../../../../src/features/quick-open/coordinator";

describe("QuickOpenPalette", () => {
  it("接受选择后先关闭弹框，再转发 typed reference", async () => {
    const user = userEvent.setup();
    const events: string[] = [];
    const reference = { id: "prod-api", kind: "host" as const };
    const coordinator = {
      cancel: vi.fn(),
      search: vi.fn(
        async (
          query: string,
          options: {
            onUpdate: (state: unknown) => void;
          },
        ) => {
          options.onUpdate({
            failures: [],
            query,
            requestId: 1,
            results: [
              {
                label: "Production API",
                providerId: "hosts",
                reference,
                score: 100,
              },
            ],
            status: "ready",
          });
        },
      ),
    } as unknown as QuickOpenCoordinator;
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = vi.fn();

    render(
      <QuickOpenPalette
        coordinator={coordinator}
        onClose={() => events.push("close")}
        onSelect={(selected) => events.push(`select:${selected.id}`)}
        open
      />,
    );

    expect(
      await screen.findByRole("option", { name: /Production API/ }),
    ).toBeInTheDocument();
    await user.keyboard("{Enter}");

    expect(events).toEqual(["close", "select:prod-api"]);
    if (originalScrollIntoView) {
      HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    } else {
      delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
    }
  });
});
