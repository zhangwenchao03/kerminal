import type { IDisposable, ITerminalAddon } from "@xterm/xterm";
import type { TerminalRendererTerminal } from "./terminalRenderer.controller.contracts";

export interface WebglAddonLike extends ITerminalAddon {
  clearTextureAtlas?: () => void;
  onAddTextureAtlasCanvas?: (
    listener: (canvas: HTMLCanvasElement) => void,
  ) => IDisposable;
  onChangeTextureAtlas?: (
    listener: (canvas: HTMLCanvasElement) => void,
  ) => IDisposable;
  onContextLoss: (listener: () => void) => IDisposable;
  onRemoveTextureAtlasCanvas?: (
    listener: (canvas: HTMLCanvasElement) => void,
  ) => IDisposable;
  textureAtlas?: HTMLCanvasElement;
}

export type WebglAddonConstructor = new () => WebglAddonLike;

export interface ActiveWebglRenderer {
  addon: WebglAddonLike;
  canvases: Set<HTMLCanvasElement>;
  disposables: IDisposable[];
  rendererCanvases: Set<HTMLCanvasElement>;
}

export function createWebglRendererCandidate(
  addon: WebglAddonLike,
): ActiveWebglRenderer {
  return {
    addon,
    canvases: new Set(),
    disposables: [],
    rendererCanvases: new Set(),
  };
}

interface LoadWebglRendererCandidateOptions {
  element: HTMLElement;
  onContextLoss: () => void;
  onResourcesChanged: () => void;
  renderer: ActiveWebglRenderer;
  terminal: TerminalRendererTerminal;
}

export function loadWebglRendererCandidate({
  element,
  onContextLoss,
  onResourcesChanged,
  renderer,
  terminal,
}: LoadWebglRendererCandidateOptions) {
  const { addon, canvases, disposables, rendererCanvases } = renderer;
  const textureAtlasCanvases = new Set<HTMLCanvasElement>();
  const before = new Set(element.querySelectorAll<HTMLCanvasElement>("canvas"));
  const trackTextureAtlasCanvas = (canvas: HTMLCanvasElement) => {
    textureAtlasCanvases.add(canvas);
    rendererCanvases.delete(canvas);
    canvases.add(canvas);
    onResourcesChanged();
  };

  disposables.push(addon.onContextLoss(onContextLoss));
  if (addon.onAddTextureAtlasCanvas) {
    disposables.push(addon.onAddTextureAtlasCanvas(trackTextureAtlasCanvas));
  }
  if (addon.onChangeTextureAtlas) {
    disposables.push(addon.onChangeTextureAtlas(trackTextureAtlasCanvas));
  }
  if (addon.onRemoveTextureAtlasCanvas) {
    disposables.push(
      addon.onRemoveTextureAtlasCanvas((canvas) => {
        textureAtlasCanvases.delete(canvas);
        rendererCanvases.delete(canvas);
        canvases.delete(canvas);
        onResourcesChanged();
      }),
    );
  }
  terminal.loadAddon(addon);

  for (const canvas of element.querySelectorAll<HTMLCanvasElement>("canvas")) {
    if (!before.has(canvas)) {
      canvases.add(canvas);
      if (!textureAtlasCanvases.has(canvas)) {
        rendererCanvases.add(canvas);
      }
    }
  }
  if (addon.textureAtlas) {
    trackTextureAtlasCanvas(addon.textureAtlas);
  }
}
