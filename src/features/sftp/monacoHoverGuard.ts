import {
  getBaseLayerHoverDelegate,
  setBaseLayerHoverDelegate,
} from "monaco-editor/esm/vs/base/browser/ui/hover/hoverDelegate2.js";

type Disposable = {
  dispose: () => void;
};

type HoverOptions = {
  container?: HTMLElement;
  position?: {
    forcePosition?: boolean;
    hoverPosition?: number | { x: number; y: number };
  };
};

type HoverOptionsInput = HoverOptions | (() => HoverOptions);

type BaseHoverDelegate = {
  hideHover?: () => void;
  setupDelayedHover?: (
    target: HTMLElement,
    options: HoverOptionsInput,
    lifecycleOptions?: unknown,
  ) => Disposable;
  setupDelayedHoverAtMouse?: (
    target: HTMLElement,
    options: HoverOptionsInput,
    lifecycleOptions?: unknown,
  ) => Disposable;
  [KerminalHoverDelegateSource]?: BaseHoverDelegate;
};

type MonacoHoverGuardEditor = {
  onDidBlurEditorWidget?: (listener: () => void) => Disposable;
  onDidScrollChange?: (listener: () => void) => Disposable;
  trigger?: (source: string, handlerId: string, payload: unknown) => void;
};

type EventTargetWithListener = {
  addEventListener: EventTarget["addEventListener"];
  removeEventListener: EventTarget["removeEventListener"];
};

const MONACO_HOVER_POSITION_BELOW = 2;
const KerminalHoverDelegateSource = Symbol("KerminalHoverDelegateSource");
const activeHoverContainers = new Map<HTMLElement, number>();
let originalBaseHoverDelegate: BaseHoverDelegate | null = null;

export function installMonacoHoverGuard({
  container,
  editor,
}: {
  container: HTMLElement;
  editor: MonacoHoverGuardEditor;
}): Disposable {
  const ownerDocument = container.ownerDocument;
  const ownerWindow = ownerDocument.defaultView;
  const disposables: Disposable[] = [];
  const placementDisposable = installMonacoHoverPlacementGuard(container);
  const hideHover = () => hideMonacoHover(editor, ownerDocument);
  let lastHoverTarget: HTMLElement | null = null;
  let positionTimer: number | null = null;
  const queueHoverPosition = () => {
    if (!lastHoverTarget || !ownerWindow) {
      return;
    }
    if (positionTimer !== null) {
      ownerWindow.clearTimeout(positionTimer);
    }
    positionTimer = ownerWindow.setTimeout(() => {
      positionTimer = null;
      if (lastHoverTarget) {
        positionMonacoHoverNearTarget({
          container,
          ownerDocument,
          target: lastHoverTarget,
        });
      }
    }, 0);
  };
  const rememberHoverTarget = (event: Event) => {
    const target = closestHoverTarget(event.target, container, ownerWindow);
    if (!target) {
      return;
    }
    lastHoverTarget = target;
    ownerWindow?.setTimeout(queueHoverPosition, 450);
  };
  const hideHoverWhenOutsideEditor = (event: Event) => {
    const target = event.target;
    const NodeCtor = ownerWindow?.Node ?? Node;
    if (target instanceof NodeCtor && container.contains(target)) {
      return;
    }
    hideHover();
  };

  disposables.push(placementDisposable);
  addListener(container, "pointerover", rememberHoverTarget, disposables, true);
  addListener(container, "focusin", rememberHoverTarget, disposables, true);
  addListener(container, "pointerleave", hideHover, disposables);
  addListener(container, "focusout", hideHover, disposables);
  addListener(ownerDocument, "pointerover", hideHoverWhenOutsideEditor, disposables, true);
  addListener(ownerDocument, "pointerdown", hideHoverWhenOutsideEditor, disposables, true);
  addListener(ownerDocument, "scroll", hideHover, disposables, true);
  if (ownerWindow) {
    addListener(ownerWindow, "resize", hideHover, disposables);
  }
  if (typeof ownerWindow?.MutationObserver === "function") {
    const hoverObserver = new ownerWindow.MutationObserver(queueHoverPosition);
    hoverObserver.observe(ownerDocument.body, { childList: true, subtree: true });
    disposables.push({ dispose: () => hoverObserver.disconnect() });
  }

  const blurDisposable = editor.onDidBlurEditorWidget?.(hideHover);
  if (blurDisposable) {
    disposables.push(blurDisposable);
  }
  const scrollDisposable = editor.onDidScrollChange?.(hideHover);
  if (scrollDisposable) {
    disposables.push(scrollDisposable);
  }

  return {
    dispose: () => {
      if (positionTimer !== null) {
        ownerWindow?.clearTimeout(positionTimer);
      }
      for (const disposable of disposables.splice(0)) {
        disposable.dispose();
      }
    },
  };
}

export function hideMonacoHover(
  editor: MonacoHoverGuardEditor,
  ownerDocument: Document = document,
) {
  try {
    editor.trigger?.("kerminal.hoverGuard", "editor.action.hideHover", {});
  } catch {
    // Monaco action availability varies by build; the base hover delegate below
    // is the important path for find-widget button hovers.
  }

  getBaseLayerHoverDelegate().hideHover?.();
  hideStrandedWorkbenchHover(ownerDocument);
}

export function positionMonacoHoverNearTarget({
  container,
  ownerDocument,
  target,
}: {
  container: HTMLElement;
  ownerDocument: Document;
  target: HTMLElement;
}) {
  if (!container.contains(target)) {
    return;
  }
  const hoverContainer = ownerDocument.querySelector<HTMLElement>(
    ".workbench-hover-container",
  );
  const hover = hoverContainer?.querySelector<HTMLElement>(
    ".monaco-hover.workbench-hover",
  );
  const ownerWindow = ownerDocument.defaultView;
  if (!hoverContainer || !hover || !ownerWindow) {
    return;
  }

  const targetRect = target.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  const hoverRect = hover.getBoundingClientRect();
  const margin = 8;
  const gap = 6;
  const hoverWidth = hoverRect.width || hover.offsetWidth;
  const hoverHeight = hoverRect.height || hover.offsetHeight;
  const viewportWidth = ownerWindow.innerWidth;
  const viewportHeight = ownerWindow.innerHeight;
  const minLeft = Math.max(margin, containerRect.left + margin);
  const rightBoundary = Math.min(viewportWidth, containerRect.right) - margin;
  const maxLeft = Math.max(minLeft, rightBoundary - hoverWidth);
  const topBelowTarget = targetRect.bottom + gap;
  const topAboveTarget = targetRect.top - hoverHeight - gap;
  const preferredTop =
    topBelowTarget + hoverHeight + margin <= viewportHeight
      ? topBelowTarget
      : topAboveTarget;
  const top = Math.max(containerRect.top + margin, preferredTop);
  const left = Math.min(
    maxLeft,
    Math.max(
      minLeft,
      targetRect.left + targetRect.width / 2 - hoverWidth / 2,
    ),
  );

  hoverContainer.style.left = `${left}px`;
  hoverContainer.style.margin = "0";
  hoverContainer.style.position = "fixed";
  hoverContainer.style.top = `${top}px`;
  hoverContainer.style.transform = "none";
  hoverContainer.style.visibility = "visible";
}

export function installMonacoHoverPlacementGuard(container: HTMLElement): Disposable {
  activeHoverContainers.set(container, (activeHoverContainers.get(container) ?? 0) + 1);
  ensureKerminalHoverDelegate();

  return {
    dispose: () => {
      const nextCount = (activeHoverContainers.get(container) ?? 1) - 1;
      if (nextCount > 0) {
        activeHoverContainers.set(container, nextCount);
      } else {
        activeHoverContainers.delete(container);
      }
      if (activeHoverContainers.size === 0) {
        restoreBaseHoverDelegate();
      }
    },
  };
}

function ensureKerminalHoverDelegate() {
  const currentDelegate = getBaseLayerHoverDelegate() as BaseHoverDelegate;
  const delegateSource = getKerminalHoverDelegateSource(currentDelegate);
  const sourceDelegate = delegateSource ?? currentDelegate;
  if (!originalBaseHoverDelegate || sourceDelegate !== originalBaseHoverDelegate) {
    originalBaseHoverDelegate = sourceDelegate;
  }
  if (delegateSource) {
    return;
  }

  const positionedDelegateState: BaseHoverDelegate = {
    [KerminalHoverDelegateSource]: sourceDelegate,
  };
  const positionedDelegate = new Proxy(positionedDelegateState, {
    get(target, property) {
      if (property in target) {
        return target[property as keyof BaseHoverDelegate];
      }
      if (property === "setupDelayedHover") {
        return setupDelayedHover;
      }
      if (property === "setupDelayedHoverAtMouse") {
        return setupDelayedHoverAtMouse;
      }
      const value = sourceDelegate[property as keyof BaseHoverDelegate];
      return typeof value === "function" ? value.bind(sourceDelegate) : value;
    },
  }) as BaseHoverDelegate;
  const setupDelayedHover: NonNullable<BaseHoverDelegate["setupDelayedHover"]> = (
    target,
    options,
    lifecycleOptions,
  ) =>
    sourceDelegate.setupDelayedHover?.(
      target,
      withKerminalHoverPlacement(target, options),
      lifecycleOptions,
    ) ?? { dispose: () => undefined };
  const setupDelayedHoverAtMouse: NonNullable<
    BaseHoverDelegate["setupDelayedHoverAtMouse"]
  > = (target, options, lifecycleOptions) =>
    sourceDelegate.setupDelayedHoverAtMouse?.(
      target,
      withKerminalHoverPlacement(target, options),
      lifecycleOptions,
    ) ?? { dispose: () => undefined };

  setBaseLayerHoverDelegate(positionedDelegate);
}

function restoreBaseHoverDelegate() {
  const currentDelegate = getBaseLayerHoverDelegate() as BaseHoverDelegate;
  if (getKerminalHoverDelegateSource(currentDelegate) && originalBaseHoverDelegate) {
    setBaseLayerHoverDelegate(originalBaseHoverDelegate);
  }
  originalBaseHoverDelegate = null;
}

function getKerminalHoverDelegateSource(delegate: BaseHoverDelegate) {
  if (
    Object.prototype.hasOwnProperty.call(delegate, KerminalHoverDelegateSource)
  ) {
    return delegate[KerminalHoverDelegateSource] ?? null;
  }
  return null;
}

function withKerminalHoverPlacement(
  target: HTMLElement,
  options: HoverOptionsInput,
): HoverOptionsInput {
  return () => {
    const resolvedOptions = typeof options === "function" ? options() : options;
    const container = findActiveHoverContainer(target);
    if (!container) {
      return resolvedOptions;
    }
    return {
      ...resolvedOptions,
      position: {
        ...resolvedOptions.position,
        forcePosition: true,
        hoverPosition: MONACO_HOVER_POSITION_BELOW,
      },
    };
  };
}

function findActiveHoverContainer(target: HTMLElement) {
  for (const container of activeHoverContainers.keys()) {
    if (container.contains(target)) {
      return container;
    }
  }
  return null;
}

function closestHoverTarget(
  target: EventTarget | null,
  container: HTMLElement,
  _ownerWindow: Window | null,
) {
  if (!(target instanceof Element)) {
    return null;
  }
  const hoverTarget = target.closest<HTMLElement>(
    "[custom-hover='true'], [aria-label], [title]",
  );
  if (!hoverTarget || !container.contains(hoverTarget)) {
    return null;
  }
  return hoverTarget;
}

function hideStrandedWorkbenchHover(ownerDocument: Document) {
  for (const element of ownerDocument.querySelectorAll<HTMLElement>(
    ".workbench-hover-container, .monaco-hover.workbench-hover",
  )) {
    element.style.pointerEvents = "none";
    element.style.visibility = "hidden";
  }
}

function addListener(
  target: EventTargetWithListener,
  type: string,
  listener: EventListener,
  disposables: Disposable[],
  capture = false,
) {
  target.addEventListener(type, listener, capture);
  disposables.push({
    dispose: () => target.removeEventListener(type, listener, capture),
  });
}
