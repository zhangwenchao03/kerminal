import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hideMonacoHover,
  installMonacoHoverPlacementGuard,
  installMonacoHoverGuard,
  positionMonacoHoverNearTarget,
} from "../../../../src/features/sftp/monacoHoverGuard";

const hoverDelegateMock = vi.hoisted(() => {
  const state: {
    base: {
      hideHover: ReturnType<typeof vi.fn>;
      setupDelayedHover: ReturnType<typeof vi.fn>;
      setupDelayedHoverAtMouse: ReturnType<typeof vi.fn>;
    };
    current: unknown;
    setBaseLayerHoverDelegate: ReturnType<typeof vi.fn>;
  } = {
    base: {
      hideHover: vi.fn(),
      setupDelayedHover: vi.fn(() => ({ dispose: vi.fn() })),
      setupDelayedHoverAtMouse: vi.fn(() => ({ dispose: vi.fn() })),
    },
    current: null,
    setBaseLayerHoverDelegate: vi.fn(),
  };
  state.current = state.base;
  state.setBaseLayerHoverDelegate = vi.fn((next: unknown) => {
    state.current = next;
  });
  return state;
});

vi.mock(
  "monaco-editor/esm/vs/base/browser/ui/hover/hoverDelegate2.js",
  () => ({
    getBaseLayerHoverDelegate: () => hoverDelegateMock.current,
    setBaseLayerHoverDelegate: hoverDelegateMock.setBaseLayerHoverDelegate,
  }),
);

describe("monacoHoverGuard", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    hoverDelegateMock.current = hoverDelegateMock.base;
    hoverDelegateMock.base.hideHover.mockReset();
    hoverDelegateMock.base.setupDelayedHover.mockClear();
    hoverDelegateMock.base.setupDelayedHoverAtMouse.mockClear();
    hoverDelegateMock.setBaseLayerHoverDelegate.mockClear();
  });

  it("hides Monaco hovers through the editor command and base hover delegate", () => {
    const trigger = vi.fn();
    const hover = document.createElement("div");
    hover.className = "workbench-hover-container";
    document.body.appendChild(hover);

    hideMonacoHover({ trigger });

    expect(trigger).toHaveBeenCalledWith(
      "kerminal.hoverGuard",
      "editor.action.hideHover",
      {},
    );
    expect(hoverDelegateMock.base.hideHover).toHaveBeenCalledTimes(1);
    expect(hover.style.pointerEvents).toBe("none");
    expect(hover.style.visibility).toBe("hidden");
  });

  it("hides hovers as soon as pointer focus leaves the editor container", () => {
    const container = document.createElement("div");
    const outsideButton = document.createElement("button");
    const editor = {
      onDidBlurEditorWidget: vi.fn(() => ({ dispose: vi.fn() })),
      onDidScrollChange: vi.fn(() => ({ dispose: vi.fn() })),
      trigger: vi.fn(),
    };
    document.body.append(container, outsideButton);

    const disposable = installMonacoHoverGuard({ container, editor });
    outsideButton.dispatchEvent(
      new PointerEvent("pointerover", { bubbles: true }),
    );

    expect(editor.trigger).toHaveBeenCalledWith(
      "kerminal.hoverGuard",
      "editor.action.hideHover",
      {},
    );
    expect(hoverDelegateMock.base.hideHover).toHaveBeenCalledTimes(1);

    disposable.dispose();
    editor.trigger.mockClear();
    outsideButton.dispatchEvent(
      new PointerEvent("pointerover", { bubbles: true }),
    );
    expect(editor.trigger).not.toHaveBeenCalled();
  });

  it("places Monaco button hovers below targets inside the editor container", () => {
    const container = document.createElement("div");
    const findButton = document.createElement("button");
    container.appendChild(findButton);
    document.body.appendChild(container);

    const disposable = installMonacoHoverPlacementGuard(container);
    const delegate = hoverDelegateMock.current as {
      setupDelayedHover: (
        target: HTMLElement,
        options: () => { content: string },
      ) => void;
    };

    delegate.setupDelayedHover(findButton, () => ({ content: "Find" }));

    const positionedOptions =
      hoverDelegateMock.base.setupDelayedHover.mock.calls[0][1]();
    expect(positionedOptions.container).toBeUndefined();
    expect(positionedOptions.position.forcePosition).toBe(true);
    expect(positionedOptions.position.hoverPosition).toBe(2);

    disposable.dispose();
    expect(hoverDelegateMock.current).toBe(hoverDelegateMock.base);
  });

  it("resolves the active editor container when Monaco shows the hover", () => {
    const container = document.createElement("div");
    const findButton = document.createElement("button");
    document.body.appendChild(container);

    const disposable = installMonacoHoverPlacementGuard(container);
    const delegate = hoverDelegateMock.current as {
      setupDelayedHover: (
        target: HTMLElement,
        options: () => { content: string },
      ) => void;
    };

    delegate.setupDelayedHover(findButton, () => ({ content: "Find" }));
    container.appendChild(findButton);

    const positionedOptions =
      hoverDelegateMock.base.setupDelayedHover.mock.calls[0][1]();
    expect(positionedOptions.position.forcePosition).toBe(true);
    expect(positionedOptions.position.hoverPosition).toBe(2);

    disposable.dispose();
  });

  it("repositions existing Monaco hover DOM under the hovered editor target", () => {
    const container = document.createElement("div");
    const target = document.createElement("button");
    const hoverContainer = document.createElement("div");
    const hover = document.createElement("div");
    hoverContainer.className = "workbench-hover-container";
    hover.className = "monaco-hover workbench-hover";
    hoverContainer.appendChild(hover);
    container.appendChild(target);
    document.body.append(container, hoverContainer);
    container.getBoundingClientRect = () => rect({ top: 160, bottom: 600 });
    target.getBoundingClientRect = () =>
      rect({ left: 420, right: 440, top: 220, bottom: 240, width: 20 });
    hover.getBoundingClientRect = () =>
      rect({ left: 0, right: 180, top: 0, bottom: 24, width: 180, height: 24 });

    positionMonacoHoverNearTarget({ container, ownerDocument: document, target });

    expect(hoverContainer.style.position).toBe("fixed");
    expect(hoverContainer.style.top).toBe("246px");
    expect(hoverContainer.style.visibility).toBe("visible");
  });
});

function rect({
  bottom,
  height,
  left = 0,
  right,
  top,
  width,
}: {
  bottom: number;
  height?: number;
  left?: number;
  right?: number;
  top: number;
  width?: number;
}): DOMRect {
  const resolvedRight = right ?? left + (width ?? 0);
  const resolvedWidth = width ?? resolvedRight - left;
  const resolvedHeight = height ?? bottom - top;
  return {
    bottom,
    height: resolvedHeight,
    left,
    right: resolvedRight,
    top,
    width: resolvedWidth,
    x: left,
    y: top,
    toJSON: () => undefined,
  } as DOMRect;
}
