---
name: security-permissions
description: |
  Tauri 2 安全与权限管理技能，指导 Capabilities、插件权限、文件 scope、CSP、远程来源和最小权限实践。

  触发场景:
  - 需要配置 Capabilities 权限
  - 需要理解 Tauri 2 安全模型
  - 需要处理 CSP(内容安全策略)
  - 需要排查 Permission denied、插件功能不可用或远程页面权限问题

  触发词: 权限、Capabilities、安全、CSP、permission、安全策略、sandbox、scope、remote
---

# Tauri 安全与权限管理

## Tauri 2 安全基线

Tauri 2 使用 Capabilities 取代 v1 allowlist。核心 API 和插件能力需要在 `src-tauri/capabilities/*.json` 中声明权限；注册到 `invoke_handler` 的自定义 Command 默认可被前端调用，敏感 Command 仍要在 Rust 侧做输入校验、业务鉴权和审计。

最小默认模板：

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

目录中的 Capability 默认启用；如果 `tauri.conf.json -> app.security.capabilities` 显式列出文件名，则只启用列出的 Capability。

## 权限添加流程

### 1. 安装插件

优先使用官方 CLI，让 Cargo、npm 包和基础配置一起更新：

```bash
pnpm tauri add fs
```

手动安装时同时改 Rust 与前端依赖：

```toml
# src-tauri/Cargo.toml
tauri-plugin-fs = "2"
```

```bash
pnpm add @tauri-apps/plugin-fs
```

### 2. 注册插件

```rust
// src-tauri/src/lib.rs
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![/* commands */])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

移动端不支持的桌面插件要用 `#[cfg(desktop)]` 或在 `setup` 中条件注册。

### 3. 声明权限和 scope

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "file-access",
  "description": "Allow app config file access",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "fs:read-files",
    "fs:allow-write-text-file",
    "fs:allow-exists",
    {
      "identifier": "fs:scope",
      "allow": [
        { "path": "$APPCONFIG" },
        { "path": "$APPCONFIG/**/*" }
      ]
    }
  ]
}
```

递归路径要同时覆盖目录本身和子路径：`$APPCONFIG` + `$APPCONFIG/**/*`。

## 常见权限 ID

权限名来自对应插件生成的 schema，先查看 `src-tauri/gen/schemas/*`，再写 Capability。

| 能力 | 常用权限 | 场景 |
|------|----------|------|
| Core | `core:default` | 基础应用 API |
| 窗口控制 | `core:window:allow-minimize`、`core:window:allow-close`、`core:window:allow-start-dragging` | 自定义标题栏、无边框窗口 |
| WebView 窗口 | `core:webview:allow-create-webview-window` | 前端创建多窗口 |
| Menu/Tray | `core:menu:default`、`core:tray:default` | 菜单与系统托盘 |
| Opener | `opener:default`、`opener:allow-open-path` | 打开 URL 或本地路径 |
| Store | `store:default` | 键值配置持久化 |
| Log | `log:default` | 日志 |
| FS | `fs:read-files`、`fs:allow-write-text-file`、`fs:allow-exists`、`fs:scope` | 文件访问 |
| Dialog | `dialog:default`、`dialog:allow-open`、`dialog:allow-save` | 打开/保存对话框 |
| Notification | `notification:default` | 系统通知 |
| Process | `process:default` | 退出/重启 |
| Updater | `updater:default` | 自动更新 |
| Shell | `shell:default` 或更细权限 | 外部命令，必须收窄 scope |
| HTTP | `http:default` 或 scoped URL | 前端 HTTP 请求 |
| Global Shortcut | `global-shortcut:allow-register`、`allow-unregister` | 全局快捷键 |
| Window State | `window-state:default` | 保存窗口大小位置 |

## 文件 scope

常用路径变量：

| 变量 | 说明 |
|------|------|
| `$APPDATA` | 应用数据目录 |
| `$APPCACHE` | 应用缓存目录 |
| `$APPCONFIG` | 应用配置目录 |
| `$APPLOCALDATA` | 应用本地数据目录 |
| `$APPLOG` | 应用日志目录 |
| `$HOME` | 用户主目录 |
| `$DESKTOP` | 桌面 |
| `$DOCUMENT` | 文档 |
| `$DOWNLOAD` | 下载 |
| `$RESOURCE` | 应用资源 |
| `$TEMP` | 临时目录 |

安全示例：

```json
{
  "identifier": "fs:scope",
  "allow": [
    { "path": "$APPDATA" },
    { "path": "$APPDATA/**/*" },
    { "path": "$DOCUMENT/my-app/**/*" }
  ],
  "deny": [
    { "path": "$HOME/.ssh/**/*" },
    { "path": "$HOME/.gnupg/**/*" }
  ]
}
```

不要在生产环境给 `fs` 或 `opener:allow-open-path` 配 `"**"`，除非这是明确的文件管理器类产品且有额外校验。

## 多窗口和平台差异

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "editor",
  "description": "动态编辑器窗口权限",
  "windows": ["editor-*"],
  "platforms": ["linux", "macOS", "windows"],
  "permissions": [
    "core:default",
    "dialog:default",
    "fs:read-files",
    "fs:allow-write-text-file",
    {
      "identifier": "fs:scope",
      "allow": [{ "path": "$DOCUMENT/projects/**/*" }]
    }
  ]
}
```

移动端权限单独放进 mobile schema：

```json
{
  "$schema": "../gen/schemas/mobile-schema.json",
  "identifier": "mobile",
  "description": "Mobile-only permissions",
  "windows": ["main"],
  "platforms": ["iOS", "android"],
  "permissions": ["barcode-scanner:allow-scan", "biometric:allow-authenticate"]
}
```

## 远程来源

默认本地打包页面可访问 Tauri API。给远程页面授权时必须用 `remote.urls` 绑定可信 HTTPS 域名：

```json
{
  "$schema": "../gen/schemas/remote-schema.json",
  "identifier": "trusted-remote",
  "description": "Trusted remote feature page",
  "windows": ["main"],
  "remote": {
    "urls": ["https://*.example.com"]
  },
  "permissions": ["core:default"]
}
```

远程来源不要授予 `fs`、`shell`、`process`、`updater`、`opener:allow-open-path` 等高风险权限。

## CSP

生产环境不要禁用 CSP。允许 IPC、必要资源和明确的远程 API：

```json
{
  "app": {
    "security": {
      "csp": "default-src 'self'; connect-src 'self' ipc: https://api.example.com; img-src 'self' asset: https://asset.localhost; style-src 'self' 'unsafe-inline'; script-src 'self'"
    }
  }
}
```

| 策略 | 说明 |
|------|------|
| `default-src 'self'` | 默认只允许本地资源 |
| `connect-src 'self' ipc:` | 保留 Tauri IPC，并显式添加远程 API |
| `img-src 'self' asset:` | 允许本地资源和 asset 协议图片 |
| `script-src 'self'` | 不允许远程脚本 |

## Rust 侧安全校验

Capabilities 不能替代业务校验。敏感 Command 必须验证参数、路径、权限和数据范围。

```rust
#[tauri::command]
pub fn read_project_file(root: String, rel_path: String) -> Result<String, String> {
    if rel_path.contains("..") || rel_path.starts_with('/') || rel_path.starts_with('\\') {
        return Err("非法路径".into());
    }

    let root = std::path::PathBuf::from(root)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let target = root.join(rel_path)
        .canonicalize()
        .map_err(|e| e.to_string())?;

    if !target.starts_with(&root) {
        return Err("路径越界".into());
    }

    std::fs::read_to_string(target).map_err(|e| e.to_string())
}
```

## 排查权限问题

| 症状 | 可能原因 | 处理 |
|------|----------|------|
| `Permission denied` | Capability 未声明权限或 scope 不匹配 | 查 `src-tauri/gen/schemas`，补权限和 scope |
| 插件 API 无响应 | 插件未注册或 npm 包未安装 | 检查 `Cargo.toml`、`package.json`、`.plugin()` |
| 动态窗口无权限 | `windows` 没有匹配动态 label | 使用 `editor-*` 等通配符 |
| 只在某平台失败 | `platforms` 配置排除了当前平台 | 拆分桌面/移动端 Capability |
| 远程页面无法调用 | 未配置 `remote.urls` | 使用 remote schema，并只授权可信域名 |
| CSP 报错 | `connect-src`、`img-src` 等缺少来源 | 按报错补最小来源 |
| 修改权限没生效 | dev server 未重启 | 重启 `pnpm tauri dev` |

## 常见错误

| 错误做法 | 正确做法 |
|---------|---------|
| 把 v1 `allowlist` 迁到 v2 | 使用 `src-tauri/capabilities` |
| 给所有窗口全部权限 | 按窗口和平台拆分 |
| 文件 scope 写 `"**"` | 限制到 `$APPDATA`、`$APPCONFIG` 或业务目录 |
| 递归路径只写 `$DIR/**` | 写 `$DIR` 和 `$DIR/**/*` |
| 密钥放前端 | 密钥只放 Rust 侧或系统密钥链 |
| 只依赖前端校验 | Rust Command 重做校验 |
| 生产环境禁用 CSP | 配置最小可用 CSP |
