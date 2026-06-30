---
name: tauri-capabilities
description: |
  Tauri 2 Capabilities 深度配置技能，指导高级权限管理、作用域控制、平台差异和多窗口权限差异化。

  触发场景：
  - 需要精确控制 Tauri API 或插件访问权限
  - 需要限制文件访问作用域
  - 需要为不同窗口、WebView、平台或远程来源配置不同权限
  - 需要自定义 Capability 权限组或排查 Permission denied

  触发词：Capabilities、权限配置、作用域、scope、精细权限、安全配置、remote capability、platforms
---

# Tauri Capabilities 深度配置

## 核心模型

Capabilities 是 Tauri 2.x 的核心安全机制，用来约束哪些窗口或 WebView 能访问哪些 core/plugin 权限。

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "main-capability",
  "description": "Capability for the main window",
  "windows": ["main"],
  "permissions": ["core:default", "opener:default"]
}
```

关键规则：

- Capability 文件放在 `src-tauri/capabilities/*.json` 或 `*.toml`。
- 目录里的 Capability 默认都会启用；如果在 `tauri.conf.json -> app.security.capabilities` 显式列出，则只启用列出的项。
- 窗口或 WebView 同时命中多个 Capability 时，权限会合并；不要让低信任窗口命中高权限 Capability。
- `windows` 匹配的是窗口 label，不是窗口标题。
- 注册到 `invoke_handler` 的自定义 Command 默认对所有窗口可用；需要限制自定义 Command 时，在 `src-tauri/build.rs` 使用 `tauri_build::AppManifest::commands(...)` 或项目内更细粒度的校验策略。

## Capability 字段速查

| 字段 | 必填 | 说明 |
|------|------|------|
| `$schema` | 推荐 | 桌面用 `../gen/schemas/desktop-schema.json`，移动端用 `../gen/schemas/mobile-schema.json` |
| `identifier` | 是 | 唯一标识，建议与文件名一致 |
| `description` | 推荐 | 说明这个 Capability 的边界和用途 |
| `windows` | 常用 | 绑定窗口 label，支持 `*` 通配符 |
| `permissions` | 是 | 权限字符串或带 `allow`/`deny` scope 的对象 |
| `platforms` | 可选 | 限定 `linux`、`macOS`、`windows`、`iOS`、`android` |
| `remote` | 可选 | 授权远程 URL 访问 Tauri API，必须非常谨慎 |

## 权限声明格式

### 简单声明

```json
{
  "permissions": ["core:default", "fs:read-files", "store:default"]
}
```

### 带作用域的声明

递归路径要同时覆盖目录本身和子路径；例如 `$APPDATA` 加 `$APPDATA/**/*`。

```json
{
  "permissions": [
    {
      "identifier": "fs:scope",
      "allow": [
        { "path": "$APPDATA" },
        { "path": "$APPDATA/**/*" },
        { "path": "$DOCUMENT/projects/**/*" }
      ],
      "deny": [
        { "path": "$HOME/.ssh/**/*" },
        { "path": "$HOME/.gnupg/**/*" }
      ]
    },
    "fs:read-files",
    "fs:allow-write-text-file"
  ]
}
```

`deny` 优先于 `allow`。Unix dotfile/dotfolder 需要显式写出 dot 路径，如 `$HOME/.ssh/**/*`。

## 路径变量

常用变量：

| 变量 | 说明 |
|------|------|
| `$APPDATA` | 应用数据目录 |
| `$APPCACHE` | 应用缓存目录 |
| `$APPCONFIG` | 应用配置目录 |
| `$APPLOCALDATA` | 应用本地数据目录 |
| `$APPLOG` | 应用日志目录 |
| `$HOME` | 用户主目录 |
| `$DESKTOP` | 桌面目录 |
| `$DOCUMENT` | 文档目录 |
| `$DOWNLOAD` | 下载目录 |
| `$RESOURCE` | 应用资源目录 |
| `$TEMP` | 临时目录 |

需要访问音频、图片、视频、公共目录等用户目录时，优先查看 `src-tauri/gen/schemas/*` 里当前插件生成的权限与 scope 名称。

## 多 Capability 文件

```
src-tauri/capabilities/
├── default.json        # 主窗口：基础权限
├── editor.json         # 编辑器窗口：文件读写权限
├── desktop.json        # 仅桌面端权限
└── mobile.json         # 仅移动端权限
```

### default.json

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "主窗口默认权限",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "opener:default",
    "store:default",
    "log:default"
  ]
}
```

### 无边框窗口权限

`core:default` 不等于所有窗口操作权限。自定义标题栏通常需要显式补以下权限：

```json
{
  "permissions": [
    "core:default",
    "core:window:allow-start-dragging",
    "core:window:allow-minimize",
    "core:window:allow-maximize",
    "core:window:allow-toggle-maximize",
    "core:window:allow-close"
  ]
}
```

### 动态窗口通配符

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "editor",
  "description": "动态编辑器窗口权限",
  "windows": ["editor-*"],
  "permissions": [
    "core:default",
    "dialog:default",
    {
      "identifier": "fs:scope",
      "allow": [{ "path": "$DOCUMENT/**/*" }],
      "deny": [{ "path": "$HOME/.ssh/**/*" }, { "path": "$HOME/.gnupg/**/*" }]
    },
    "fs:read-files",
    "fs:allow-write-text-file"
  ]
}
```

## 平台差异

桌面专用插件不要给移动端 Capability：

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "desktop",
  "description": "Desktop-only permissions",
  "windows": ["main"],
  "platforms": ["linux", "macOS", "windows"],
  "permissions": ["global-shortcut:allow-register", "window-state:default"]
}
```

移动端专用能力单独放：

```json
{
  "$schema": "../gen/schemas/mobile-schema.json",
  "identifier": "mobile",
  "description": "Mobile-only permissions",
  "windows": ["main"],
  "platforms": ["iOS", "android"],
  "permissions": [
    "nfc:allow-scan",
    "biometric:allow-authenticate",
    "barcode-scanner:allow-scan"
  ]
}
```

## 远程来源

默认只有随应用打包的前端代码能访问 Tauri API。只有在明确需要远程页面使用 Tauri API 时才配置 `remote`，并且必须限定 HTTPS 域名：

```json
{
  "$schema": "../gen/schemas/remote-schema.json",
  "identifier": "remote-tags",
  "description": "Allow trusted remote tag scanning pages",
  "windows": ["main"],
  "remote": {
    "urls": ["https://*.example.com"]
  },
  "platforms": ["iOS", "android"],
  "permissions": ["nfc:allow-scan", "barcode-scanner:allow-scan"]
}
```

不要给远程来源授予 `fs`、`shell`、`process`、`opener:allow-open-path` 等高风险权限，除非有额外业务级鉴权和审计。

## 查看可用权限

运行一次 Tauri 构建或 dev 后查看生成的 schema：

```bash
ls src-tauri/gen/schemas/
```

优先按 schema 自动补全选择权限 ID，不要凭记忆写插件权限名。

## 调试权限问题

```
症状: Permission denied 或功能无响应
排查:
1. 检查 capabilities/*.json 是否声明了对应 core/plugin 权限
2. 检查窗口 label 是否命中 windows 或通配符
3. 检查 platforms 是否排除了当前平台
4. 检查 allow/deny scope 是否覆盖目标路径，deny 是否覆盖了 allow
5. 修改 Capability 后重启 tauri dev
6. 查看 DevTools 控制台和 Rust 终端日志
```

## 常见错误

| 错误做法 | 正确做法 |
|---------|---------|
| 所有窗口共用高权限 Capability | 按窗口角色拆分权限 |
| 递归路径只写 `$APPDATA/**` | 写 `$APPDATA` 和 `$APPDATA/**/*` |
| 忘记 `description` 和 `$schema` | 保留 schema 与说明，便于 IDE 和审计 |
| 桌面权限给移动端 | 用 `platforms` 拆分桌面/移动端 |
| 远程来源直接授予高权限 | 只给最小权限，并限定可信 HTTPS 域名 |
| 修改权限后不重启 | Capabilities 变更需重启 dev server |
