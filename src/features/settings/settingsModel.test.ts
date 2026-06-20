import { describe, expect, it } from "vitest";
import {
  DEFAULT_CUSTOM_SKILLS_DIRECTORY,
  defaultAppSettings,
  normalizeAppSettings,
  resolveThemeMode,
  terminalColorSchemeForTheme,
  terminalFontWeightValue,
} from "./settingsModel";

describe("settingsModel", () => {
  it("fills appearance defaults for legacy settings payloads", () => {
    const settings = normalizeAppSettings({
      terminal: {
        cursorBlink: false,
        fontFamily: "Consolas, monospace",
        fontSize: 15,
        lineHeight: 1.4,
        scrollback: 8000,
      } as Partial<
        typeof defaultAppSettings.terminal
      > as typeof defaultAppSettings.terminal,
      themeMode: "light",
    });

    expect(settings.interfaceDensity).toBe("comfortable");
    expect(settings.appearance).toMatchObject({
      backgroundEnabled: false,
      backgroundFit: "cover",
      backgroundImagePath: "",
      backgroundOpacity: 100,
      interfaceLanguage: "system",
    });
    expect(settings.terminal).toMatchObject({
      autoReconnect: true,
      colorScheme: "kerminal",
      confirmCloseTab: true,
      cursorStyle: "block",
      darkColorScheme: "kerminal",
      fontWeight: "normal",
      lightColorScheme: "kerminal",
      macOptionIsMeta: false,
      rightClickBehavior: "menu",
      selectionCopy: false,
      showTabNumbers: false,
    });
    expect(settings.terminal.inlineSuggestion).toEqual(
      defaultAppSettings.terminal.inlineSuggestion,
    );
    expect(settings.keybindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "settings.open",
          description: expect.stringContaining("IntelliJ IDEA"),
          macBinding: "Cmd+,",
          windowsBinding: "Ctrl+Alt+S",
        }),
      ]),
    );
    expect(settings.sftp).toMatchObject({
      globalTransfers: 4,
      hostTransfers: 2,
      packetBytes: 256 * 1024,
      pipelineDepth: 64,
      timeoutSeconds: 30,
    });
  });

  it("normalizes invalid appearance values to safe defaults", () => {
    const settings = normalizeAppSettings({
      appearance: {
        backgroundEnabled: true,
        backgroundFit: "poster",
        backgroundImagePath: " C:/Pictures/bg.png ",
        backgroundOpacity: 999,
        interfaceLanguage: "fr",
      },
      interfaceDensity: "tiny",
      terminal: {
        autoReconnect: false,
        colorScheme: "unknown",
        confirmCloseTab: false,
        cursorBlink: true,
        cursorStyle: "beam",
        darkColorScheme: "unknown",
        fontFamily: "",
        fontSize: 99,
        fontWeight: "heavy",
        inlineSuggestion: {
          acceptKey: "tab",
          enabled: "yes",
          productionHostPolicy: "open",
          providers: {
            ai: "true",
            git: false,
            history: 1,
            remoteCommand: false,
            remotePath: false,
            spec: "no",
          },
          remoteProbeEnabled: "no",
          auditRetentionDays: -1,
          feedbackRetentionDays: 99999,
        },
        lightColorScheme: "solarized",
        lineHeight: 9,
        macOptionIsMeta: true,
        rightClickBehavior: "context",
        scrollback: 100,
        selectionCopy: true,
        showTabNumbers: true,
      },
      sftp: {
        globalTransfers: 999,
        hostTransfers: 999,
        packetBytes: 1,
        pipelineDepth: 0,
        timeoutSeconds: 999,
      },
      themeMode: "auto",
    } as unknown as Partial<typeof defaultAppSettings>);

    expect(settings.appearance).toMatchObject({
      backgroundEnabled: true,
      backgroundFit: defaultAppSettings.appearance.backgroundFit,
      backgroundImagePath: "C:/Pictures/bg.png",
      backgroundOpacity: 100,
      interfaceLanguage: defaultAppSettings.appearance.interfaceLanguage,
    });
    expect(settings.interfaceDensity).toBe(defaultAppSettings.interfaceDensity);
    expect(settings.themeMode).toBe(defaultAppSettings.themeMode);
    expect(settings.terminal).toMatchObject({
      autoReconnect: false,
      colorScheme: defaultAppSettings.terminal.colorScheme,
      confirmCloseTab: false,
      cursorStyle: defaultAppSettings.terminal.cursorStyle,
      darkColorScheme: defaultAppSettings.terminal.darkColorScheme,
      fontFamily: defaultAppSettings.terminal.fontFamily,
      fontSize: 24,
      fontWeight: defaultAppSettings.terminal.fontWeight,
      inlineSuggestion: {
        acceptKey: defaultAppSettings.terminal.inlineSuggestion.acceptKey,
        enabled: defaultAppSettings.terminal.inlineSuggestion.enabled,
        productionHostPolicy:
          defaultAppSettings.terminal.inlineSuggestion.productionHostPolicy,
        providers: {
          ai: defaultAppSettings.terminal.inlineSuggestion.providers.ai,
          git: false,
          history:
            defaultAppSettings.terminal.inlineSuggestion.providers.history,
          remoteCommand: false,
          remotePath: false,
          spec: defaultAppSettings.terminal.inlineSuggestion.providers.spec,
        },
        remoteProbeEnabled:
          defaultAppSettings.terminal.inlineSuggestion.remoteProbeEnabled,
        auditRetentionDays: 1,
        feedbackRetentionDays: 3650,
      },
      lightColorScheme: "solarized",
      lineHeight: 1.8,
      macOptionIsMeta: true,
      rightClickBehavior: defaultAppSettings.terminal.rightClickBehavior,
      scrollback: 1000,
      selectionCopy: true,
      showTabNumbers: true,
    });
    expect(settings.sftp).toMatchObject({
      globalTransfers: 16,
      hostTransfers: 8,
      packetBytes: 32 * 1024,
      pipelineDepth: 1,
      timeoutSeconds: 300,
    });
  });

  it("keeps per-host SFTP concurrency at or below the global limit", () => {
    const settings = normalizeAppSettings({
      sftp: {
        ...defaultAppSettings.sftp,
        globalTransfers: 2,
        hostTransfers: 8,
      },
    });

    expect(settings.sftp.globalTransfers).toBe(2);
    expect(settings.sftp.hostTransfers).toBe(2);
  });

  it("uses the Codex skills directory as the default custom skills root", () => {
    expect(defaultAppSettings.ai.mcp.skillDirectories[0]?.path).toBe(
      DEFAULT_CUSTOM_SKILLS_DIRECTORY,
    );

    const settings = normalizeAppSettings({
      ai: {
        ...defaultAppSettings.ai,
        mcp: {
          servers: [],
          skillDirectories: [
            {
              enabled: true,
              id: "user-skills",
              path: " ~/.codex/skills ",
            },
          ],
        },
      },
    });

    expect(settings.ai.mcp.skillDirectories[0]?.path).toBe(
      DEFAULT_CUSTOM_SKILLS_DIRECTORY,
    );
  });

  it("maps terminal font weight choices to xterm values", () => {
    expect(terminalFontWeightValue("normal")).toBe(400);
    expect(terminalFontWeightValue("medium")).toBe(500);
    expect(terminalFontWeightValue("bold")).toBe(600);
  });

  it("enriches legacy keybinding payloads with platform bindings", () => {
    const settings = normalizeAppSettings({
      keybindings: [
        {
          action: "terminal.newTab",
          binding: "Ctrl+Shift+T",
          editable: false,
          label: "新建终端 tab",
          scope: "workspace",
        },
      ] as typeof defaultAppSettings.keybindings,
    });

    expect(settings.keybindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "terminal.newTab",
          macBinding: "Cmd+Shift+T",
          windowsBinding: "Ctrl+Shift+T",
        }),
        expect.objectContaining({
          action: "terminal.closeTab",
        }),
      ]),
    );
  });

  it("selects separate terminal color schemes for light and dark themes", () => {
    const terminal = {
      ...defaultAppSettings.terminal,
      darkColorScheme: "tokyoNight" as const,
      lightColorScheme: "github" as const,
    };

    expect(terminalColorSchemeForTheme(terminal, "dark")).toBe("tokyoNight");
    expect(terminalColorSchemeForTheme(terminal, "light")).toBe("github");
  });

  it("resolves system theme mode from the operating system preference", () => {
    expect(resolveThemeMode("system", true)).toBe("dark");
    expect(resolveThemeMode("system", false)).toBe("light");
  });
});
