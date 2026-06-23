import type {
  BackgroundImageFit,
  InterfaceDensity,
  InterfaceLanguage,
  TerminalColorScheme,
  TerminalCursorStyle,
  TerminalFontWeight,
  TerminalRightClickBehavior,
} from "./settingsModel";

export const terminalFontOptions = [
  {
    label: "JetBrains Mono",
    value:
      '"JetBrains Mono", "JetBrains Mono NL", "Cascadia Mono", Consolas, monospace',
  },
  {
    label: "JetBrainsMono Nerd Font",
    value:
      '"JetBrainsMono Nerd Font", "JetBrainsMonoNL Nerd Font", "JetBrains Mono", "Cascadia Mono", Consolas, monospace',
  },
  {
    label: "Fira Code",
    value:
      '"Fira Code", "FiraCode Nerd Font", "Cascadia Code", Consolas, monospace',
  },
  {
    label: "Cascadia Mono",
    value:
      '"Cascadia Mono", "Cascadia Code", "Cascadia Mono NF", Consolas, monospace',
  },
  {
    label: "Cascadia Code",
    value:
      '"Cascadia Code", "Cascadia Code NF", "Cascadia Mono", Consolas, monospace',
  },
  {
    label: "MesloLGS NF",
    value:
      '"MesloLGS NF", "MesloLGS Nerd Font", "MesloLGM Nerd Font", "Cascadia Mono", Consolas, monospace',
  },
  {
    label: "Hack",
    value:
      '"Hack", "Hack Nerd Font", "Cascadia Mono", Consolas, monospace',
  },
  {
    label: "Source Code Pro",
    value:
      '"Source Code Pro", "SauceCodePro Nerd Font", "Cascadia Mono", Consolas, monospace',
  },
  {
    label: "Iosevka Term",
    value:
      '"Iosevka Term", "IosevkaTerm Nerd Font", "Iosevka", "Cascadia Mono", Consolas, monospace',
  },
  {
    label: "IBM Plex Mono",
    value:
      '"IBM Plex Mono", "BlexMono Nerd Font", "Cascadia Mono", Consolas, monospace',
  },
  {
    label: "Inconsolata",
    value:
      '"Inconsolata", "Inconsolata Nerd Font", "Cascadia Mono", Consolas, monospace',
  },
  {
    label: "Ubuntu Mono",
    value:
      '"Ubuntu Mono", "UbuntuMono Nerd Font", "Cascadia Mono", Consolas, monospace',
  },
  {
    label: "Consolas",
    value: 'Consolas, "Cascadia Mono", monospace',
  },
  {
    label: "Lucida Console",
    value: '"Lucida Console", Consolas, monospace',
  },
  {
    label: "Courier New",
    value: '"Courier New", Consolas, monospace',
  },
];

export const interfaceLanguageOptions: Array<{
  label: string;
  value: InterfaceLanguage;
}> = [
  { label: "跟随系统", value: "system" },
  { label: "简体中文", value: "zhCN" },
  { label: "English", value: "enUS" },
];

export const backgroundImageFitOptions: Array<{
  description: string;
  label: string;
  value: BackgroundImageFit;
}> = [
  {
    description: "铺满工作台，适合大图和壁纸。",
    label: "填充画布",
    value: "cover",
  },
  {
    description: "完整显示图片，避免裁切边缘。",
    label: "完整显示",
    value: "contain",
  },
  {
    description: "重复平铺小纹理或像素图。",
    label: "平铺纹理",
    value: "tile",
  },
];

export const interfaceDensityOptions: Array<{
  description: string;
  label: string;
  value: InterfaceDensity;
}> = [
  {
    description: "标签栏和内容区域更紧，适合小屏或多分屏。",
    label: "紧凑",
    value: "compact",
  },
  {
    description: "保留默认留白，适合日常开发。",
    label: "舒适",
    value: "comfortable",
  },
  {
    description: "增加操作区呼吸感，适合长时间阅读。",
    label: "宽松",
    value: "spacious",
  },
];

export const terminalColorSchemeOptions: Array<{
  colors: string[];
  description: string;
  label: string;
  value: TerminalColorScheme;
}> = [
  {
    colors: ["#1f1f21", "#60a5fa", "#4ade80", "#facc15"],
    description: "Kerminal 默认深浅色终端主题。",
    label: "Kerminal",
    value: "kerminal",
  },
  {
    colors: ["#1a1b26", "#7aa2f7", "#9ece6a", "#bb9af7"],
    description: "低亮度蓝紫背景，适合夜间长会话。",
    label: "Tokyo Night",
    value: "tokyoNight",
  },
  {
    colors: ["#002b36", "#268bd2", "#859900", "#b58900"],
    description: "经典低对比阅读色盘。",
    label: "Solarized",
    value: "solarized",
  },
  {
    colors: ["#ffffff", "#0969da", "#1a7f37", "#9a6700"],
    description: "接近 GitHub 代码区的清晰对比。",
    label: "GitHub",
    value: "github",
  },
];

export const terminalCursorStyleOptions: Array<{
  description: string;
  label: string;
  value: TerminalCursorStyle;
}> = [
  {
    description: "最醒目，适合频繁在输出里定位输入点。",
    label: "块状",
    value: "block",
  },
  {
    description: "接近现代编辑器插入点，输入感更轻。",
    label: "竖线",
    value: "bar",
  },
  {
    description: "占用最少，适合密集日志和长命令输出。",
    label: "下划线",
    value: "underline",
  },
];

export const terminalFontWeightOptions: Array<{
  label: string;
  value: TerminalFontWeight;
}> = [
  { label: "常规", value: "normal" },
  { label: "中等", value: "medium" },
  { label: "加粗", value: "bold" },
];

export const terminalRightClickBehaviorOptions: Array<{
  description: string;
  label: string;
  value: TerminalRightClickBehavior;
}> = [
  {
    description: "保留系统右键，不触发终端动作。",
    label: "不执行",
    value: "none",
  },
  {
    description: "右键直接粘贴剪贴板内容。",
    label: "粘贴",
    value: "paste",
  },
  {
    description: "打开复制、粘贴、搜索、分屏等菜单。",
    label: "显示菜单",
    value: "menu",
  },
];
