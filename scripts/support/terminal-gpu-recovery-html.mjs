export function terminalGpuRecoveryHtml() {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <link rel="stylesheet" href="/xterm.css" />
  <style>
    body {
      margin: 0;
      background: #111827;
      color: #e5e7eb;
      font-family: Inter, system-ui, sans-serif;
    }
    #stage {
      box-sizing: border-box;
      display: grid;
      gap: 16px;
      grid-template-columns: 1fr 1fr;
      min-height: 100vh;
      padding: 20px;
    }
    .pane {
      border: 1px solid rgba(255, 255, 255, .15);
      box-sizing: border-box;
      min-width: 0;
      padding: 12px;
    }
    .title {
      color: #f9fafb;
      font-size: 13px;
      margin: 0 0 8px;
    }
    .terminal {
      height: 780px;
      width: 100%;
    }
    .xterm {
      height: 100%;
    }
  </style>
</head>
<body>
  <main id="stage"></main>
  <script type="module">
    import {
      FitAddon,
      Terminal,
      WebglAddon,
      createTerminalOutputWriter,
      createTerminalRendererController,
      createTerminalRendererRegistry,
      createTerminalRendererSurfaceCoordinator,
    } from "/terminal-renderer-smoke.mjs";

    window.__terminalGpuRecoverySmokeReady = true;
    window.runTerminalGpuRecoverySmoke = async function runTerminalGpuRecoverySmoke(config) {
      const webgl = probeWebgl();
      const gpuExpected =
        config.backend === "gpu" ||
        (config.backend === "auto" && webgl.gpuClass !== "software");
      const rendererRegistry = createTerminalRendererRegistry({
        rendererType: config.backend,
      });
      const panes = Array.from(
        { length: config.panes },
        (_, index) =>
          createPane(
            "pane-" + index,
            config.backend,
            rendererRegistry,
          ),
      );
      const failures = [];
      await waitForCondition(() => {
        const snapshot = rendererRegistry.getSnapshot();
        return (
          snapshot.panes.every((pane) => !pane.gpuAttachPending) &&
          (!gpuExpected ||
            snapshot.effectiveGpuPanes >= Math.min(config.panes, 6))
        );
      });
      await nextFrame();
      const frames = collectFrameGaps();
      const longTasks = collectLongTasks();
      const writeCallbackMs = [];
      const startedAt = performance.now();

      for (let index = 0; index < config.chunks; index += 1) {
        for (const pane of panes) {
          writeCallbackMs.push(
            await writeTerminal(pane, buildChunk(pane.id, index)),
          );
        }
      }

      await writeTerminal(panes[0], "\\x1b[?1049h\\x1b[2J\\x1b[HALT BUFFER GPU pane-a 中文 emoji 🚀\\r\\n");
      await nextFrame();
      await writeTerminal(panes[0], "\\x1b[?1049l\\r\\nBACK FROM ALT pane-0 final-token-pane-0\\r\\n");

      if (config.backend !== "cpu") {
        rendererRegistry.clearTextureAtlas();
      }
      await nextFrame();

      for (const pane of panes) {
        pane.terminal.resize(96, 28);
        pane.surface.invalidate();
        pane.surface.flush();
      }
      for (const pane of panes) {
        await writeTerminal(
          pane,
          "\\x1b[35mPOST-RECOVERY " +
            pane.id +
            " final-token-" +
            pane.id +
            " 中文 emoji ✅\\x1b[0m\\r\\n",
        );
      }
      await nextFrame();

      const registry = rendererRegistry.getSnapshot();
      for (const pane of registry.panes) {
        const expectedSoftwareFallback =
          !gpuExpected &&
          config.backend === "auto" &&
          pane.fallbackReason === "software-gpu";
        if (pane.fallbackReason && !expectedSoftwareFallback) {
          failures.push(pane.paneId + ":" + pane.fallbackReason);
        }
      }
      const paneReports = panes.map((pane) => summarizePane(pane));
      const noMouseSelectionUsed = document.getSelection()?.toString() === "";
      frames.stop();
      longTasks.stop();
      const totalMs = performance.now() - startedAt;
      const gpuModeMatches =
        config.gpuMode === "software"
          ? webgl.gpuClass === "software"
          : webgl.gpuClass !== "software";
      const pass =
        (!gpuExpected || webgl.available) &&
        (!gpuExpected || gpuModeMatches) &&
        (!gpuExpected || registry.atlasEpoch >= 1) &&
        (!gpuExpected || registry.recoveryCount >= 1) &&
        (!gpuExpected ||
          registry.webglCanvasCount >= Math.min(config.panes, 6)) &&
        noMouseSelectionUsed &&
        failures.length === 0 &&
        paneReports.every((pane) => pane.pass);

      const result = {
        dataSource: "local-generated-xterm-buffer",
        implementationCoverage: [
          "terminalOutputWriter",
          "terminalRendererController",
          "terminalRendererRegistry",
          "terminalRendererSurfaceCoordinator",
        ],
        failures,
        gpuModeMatches,
        noMouseSelectionUsed,
        panes: paneReports,
        pass,
        performance: {
          writesPerSecond:
            (config.chunks * config.panes) /
            Math.max(totalMs / 1000, 0.001),
          frameGapMs: percentileSummary(frames.values),
          longTasks: {
            count: longTasks.values.length,
            maxMs:
              longTasks.values.length === 0
                ? 0
                : Math.max(...longTasks.values),
          },
          totalMs,
          writeCallbackMs: percentileSummary(writeCallbackMs),
        },
        registry,
        webgl,
      };
      for (const pane of panes) {
        pane.dispose();
      }
      rendererRegistry.dispose();
      return result;
    };

    function createPane(id, backend, rendererRegistry) {
      const section = document.createElement("section");
      section.className = "pane";
      section.innerHTML = '<p class="title"></p><div class="terminal"></div>';
      section.querySelector(".title").textContent = id + " local GPU smoke";
      document.getElementById("stage").append(section);
      const terminal = new Terminal({
        allowProposedApi: true,
        cols: 100,
        convertEol: true,
        cursorBlink: false,
        disableStdin: true,
        fontFamily: '"Cascadia Mono", Consolas, monospace',
        fontSize: 13,
        lineHeight: 1.15,
        rows: 30,
        scrollback: 2000,
        theme: {
          background: "#0f172a",
          black: "#111827",
          blue: "#60a5fa",
          brightGreen: "#86efac",
          brightMagenta: "#f0abfc",
          cyan: "#67e8f9",
          foreground: "#e5e7eb",
          green: "#22c55e",
          magenta: "#d946ef",
          red: "#ef4444",
          white: "#f8fafc",
          yellow: "#eab308",
        },
      });
      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      const terminalContainer = section.querySelector(".terminal");
      terminal.open(terminalContainer);
      fitAddon.fit();
      const renderer = createTerminalRendererController({
        loadWebglAddon: async () => ({ WebglAddon }),
        onStateChange: (state) =>
          rendererRegistry.updatePaneState(id, state),
        paneId: id,
        rendererType: backend,
        terminal,
      });
      const unregisterRenderer = rendererRegistry.registerPane({
        controller: renderer,
        focused: id === "pane-0",
        paneId: id,
        visible: true,
      });
      const writer = createTerminalOutputWriter(terminal, {
        callbackMode: "required",
        cadence: id === "pane-0" ? "focused" : "visible",
      });
      const surface = createTerminalRendererSurfaceCoordinator({
        fit: () => {
          fitAddon.fit();
          return { cols: terminal.cols, rows: terminal.rows };
        },
        measure: () => {
          const rect = terminalContainer.getBoundingClientRect();
          return {
            dpr: window.devicePixelRatio,
            height: rect.height,
            minimized: rect.width <= 0 || rect.height <= 0,
            visible: true,
            width: rect.width,
          };
        },
        onStableSurface: () => {
          renderer.resume();
          renderer.attach();
        },
      });
      surface.flush();
      return {
        dispose() {
          surface.dispose();
          writer.dispose();
          unregisterRenderer();
          terminal.dispose();
        },
        id,
        renderer,
        section,
        surface,
        terminal,
        writer,
      };
    }

    function buildChunk(prefix, index) {
      const color = 31 + (index % 6);
      const wide = index % 7 === 0 ? " 中文宽字符" : "";
      const emoji = index % 11 === 0 ? " emoji 🚀✅" : "";
      const long = index % 13 === 0 ? " " + "x".repeat(220) : "";
      return "\\x1b[" + color + "m" + prefix + "-line-" + String(index).padStart(4, "0") + wide + emoji + long + "\\x1b[0m\\r\\n";
    }

    function summarizePane(pane) {
      const tail = readTail(pane.terminal);
      const canvases = [...pane.section.querySelectorAll("canvas")].map((canvas) => {
        const rect = canvas.getBoundingClientRect();
        return {
          dataUrlLength: safeCanvasDataUrlLength(canvas),
          height: Number(rect.height.toFixed(2)),
          width: Number(rect.width.toFixed(2)),
        };
      });
      const sectionRect = pane.section.getBoundingClientRect();
      const expectedFinalToken = "final-token-" + pane.id;
      const visibleCanvasCount = canvases.filter(
        (canvas) => canvas.width > 0 && canvas.height > 0,
      ).length;
      const rendererState = pane.renderer.getState();
      const pass =
        tail.includes(expectedFinalToken) &&
        tail.includes("中文") &&
        tail.includes("emoji") &&
        (rendererState.backend === "cpu" || visibleCanvasCount >= 1) &&
        sectionRect.width > 100 &&
        sectionRect.height > 100;
      return {
        canvasCount: canvases.length,
        canvases,
        backend: rendererState.backend,
        bufferLength: pane.terminal.buffer.active.length,
        contextLossCount:
          pane.renderer.getDiagnostics().contextLossCount,
        id: pane.id,
        pass,
        rect: {
          height: Number(sectionRect.height.toFixed(2)),
          width: Number(sectionRect.width.toFixed(2)),
        },
        tail,
        visibleCanvasCount,
        writer: pane.writer.stats(),
      };
    }

    function readTail(terminal) {
      const lines = [];
      const buffer = terminal.buffer.active;
      for (let index = 0; index < buffer.length; index += 1) {
        const line = buffer.getLine(index);
        if (line) {
          const text = line.translateToString(true);
          if (text.trim().length > 0) {
            lines.push(text);
          }
        }
      }
      return lines.slice(-16).join("\\n");
    }

    function safeCanvasDataUrlLength(canvas) {
      try {
        return canvas.toDataURL("image/png").length;
      } catch {
        return null;
      }
    }

    function probeWebgl() {
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
      if (!context) {
        return {
          available: false,
          gpuClass: "unavailable",
        };
      }
      const debugInfo = context.getExtension("WEBGL_debug_renderer_info");
      const renderer = String(
        debugInfo
          ? context.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
          : context.getParameter(context.RENDERER),
      ).toLowerCase();
      return {
        available: true,
        gpuClass:
          renderer.includes("swiftshader") ||
          renderer.includes("llvmpipe") ||
          renderer.includes("software")
            ? "software"
            : "hardware-or-unknown",
      };
    }

    async function writeTerminal(pane, value) {
      const startedAt = performance.now();
      pane.writer.write(value);
      pane.writer.flush();
      await waitForCondition(
        () => {
          const stats = pane.writer.stats();
          return stats.pendingChars === 0 && !stats.inFlight;
        },
        5_000,
      );
      return performance.now() - startedAt;
    }

    async function waitForCondition(
      predicate,
      timeoutMs = 10_000,
    ) {
      const deadline = performance.now() + timeoutMs;
      while (!predicate()) {
        if (performance.now() >= deadline) {
          throw new Error("Timed out waiting for renderer smoke condition.");
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    }

    function nextFrame() {
      return new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      });
    }

    function collectFrameGaps() {
      const values = [];
      let last = performance.now();
      let running = true;
      function tick(now) {
        values.push(now - last);
        last = now;
        if (running) {
          requestAnimationFrame(tick);
        }
      }
      requestAnimationFrame(tick);
      return {
        stop() {
          running = false;
        },
        values,
      };
    }

    function collectLongTasks() {
      const values = [];
      if (
        !("PerformanceObserver" in window) ||
        !PerformanceObserver.supportedEntryTypes?.includes("longtask")
      ) {
        return { stop() {}, values };
      }
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          values.push(entry.duration);
        }
      });
      observer.observe({ entryTypes: ["longtask"] });
      return {
        stop() {
          observer.disconnect();
        },
        values,
      };
    }

    function percentileSummary(values) {
      if (values.length === 0) {
        return { max: 0, p50: 0, p95: 0, p99: 0 };
      }
      const sorted = [...values].sort((left, right) => left - right);
      const percentile = (ratio) =>
        sorted[
          Math.min(
            sorted.length - 1,
            Math.ceil(sorted.length * ratio) - 1,
          )
        ];
      return {
        max: sorted.at(-1),
        p50: percentile(0.5),
        p95: percentile(0.95),
        p99: percentile(0.99),
      };
    }
  </script>
</body>
</html>`;
}
