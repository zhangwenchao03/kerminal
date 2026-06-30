---
name: file-storage
description: |
  Tauri 2 文件操作技能，覆盖 Rust std::fs、Tauri FS Plugin、Dialog 文件选择、应用目录和文件拖放。

  触发场景:
  - 需要读写本地文件
  - 需要选择文件/目录(对话框)
  - 需要管理应用数据、配置、缓存或日志目录
  - 需要处理文件拖放或排查文件权限问题

  触发词: 文件、读写、保存、打开、目录、文件系统、fs、拖放、导入、导出、BaseDirectory
---

# Tauri 文件操作

## 选择方案

| 方式 | 技术 | 适用场景 |
|------|------|---------|
| Rust Command | `std::fs` / `tokio::fs` | 需要业务校验、批处理、权限控制、复杂路径逻辑 |
| FS Plugin | `@tauri-apps/plugin-fs` | 前端直接读写应用配置、导入导出、小文件 |
| Dialog Plugin | `@tauri-apps/plugin-dialog` | 用户主动选择文件或保存路径 |

优先把安全敏感和复杂文件逻辑放 Rust 侧；前端 FS Plugin 只给最小 scope。

## Rust 文件操作

```rust
use std::path::{Path, PathBuf};

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("读取失败: {e}"))
}

#[tauri::command]
fn write_text_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| format!("写入失败: {e}"))
}

#[tauri::command]
fn read_json_file(path: String) -> Result<serde_json::Value, String> {
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_directory(path: String) -> Result<Vec<String>, String> {
    let entries = std::fs::read_dir(&path).map_err(|e| e.to_string())?;
    Ok(entries
        .filter_map(Result::ok)
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .collect())
}
```

### 安全路径校验

用户提供的路径必须规范化并限制在允许根目录内：

```rust
fn resolve_inside(root: &Path, rel_path: &str) -> Result<PathBuf, String> {
    if rel_path.contains("..") || rel_path.starts_with('/') || rel_path.starts_with('\\') {
        return Err("非法路径".into());
    }

    let root = root.canonicalize().map_err(|e| e.to_string())?;
    let target = root.join(rel_path).canonicalize().map_err(|e| e.to_string())?;
    if !target.starts_with(&root) {
        return Err("路径越界".into());
    }
    Ok(target)
}
```

### 应用目录

```rust
use tauri::Manager;

#[derive(serde::Serialize)]
struct AppDirs {
    data: String,
    config: String,
    cache: String,
    log: String,
}

#[tauri::command]
fn get_app_dirs(app: tauri::AppHandle) -> Result<AppDirs, String> {
    let path = app.path();
    Ok(AppDirs {
        data: path.app_data_dir().map_err(|e| e.to_string())?.to_string_lossy().into(),
        config: path.app_config_dir().map_err(|e| e.to_string())?.to_string_lossy().into(),
        cache: path.app_cache_dir().map_err(|e| e.to_string())?.to_string_lossy().into(),
        log: path.app_log_dir().map_err(|e| e.to_string())?.to_string_lossy().into(),
    })
}
```

## FS Plugin

### 安装与注册

```bash
pnpm tauri add fs
```

手动方式：

```toml
tauri-plugin-fs = "2"
```

```bash
pnpm add @tauri-apps/plugin-fs
```

```rust
tauri::Builder::default()
    .plugin(tauri_plugin_fs::init())
```

### Capability

按实际需要选择命令权限，并用 `fs:scope` 收窄路径：

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "fs-config",
  "description": "Read and write app config files",
  "windows": ["main"],
  "permissions": [
    "fs:read-files",
    "fs:allow-write-text-file",
    "fs:allow-exists",
    "fs:allow-mkdir",
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

递归 scope 写 `$APPCONFIG` 和 `$APPCONFIG/**/*`；只写 `$APPCONFIG/**` 容易漏掉目录本身。

### TypeScript 使用

```typescript
import {
  BaseDirectory,
  exists,
  mkdir,
  readTextFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";

const dir = "profiles";
const file = `${dir}/default.json`;

if (!(await exists(dir, { baseDir: BaseDirectory.AppConfig }))) {
  await mkdir(dir, { baseDir: BaseDirectory.AppConfig, recursive: true });
}

const content = await readTextFile(file, { baseDir: BaseDirectory.AppConfig });
await writeTextFile(file, JSON.stringify({ theme: "dark" }, null, 2), {
  baseDir: BaseDirectory.AppConfig,
});
```

## Dialog 文件选择

```bash
pnpm tauri add dialog
```

```json
{
  "permissions": ["dialog:default"]
}
```

```typescript
import { open, save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";

const selected = await open({
  multiple: false,
  filters: [{ name: "Text", extensions: ["txt", "md"] }],
});

if (typeof selected === "string") {
  const content = await invoke<string>("read_text_file", { path: selected });
}

const savePath = await save({
  defaultPath: "output.txt",
  filters: [{ name: "Text", extensions: ["txt"] }],
});

if (savePath) {
  await invoke("write_text_file", { path: savePath, content: "data" });
}
```

## 常见路径 API

```typescript
import {
  appCacheDir,
  appConfigDir,
  appDataDir,
  appLogDir,
  desktopDir,
  documentDir,
  homeDir,
  join,
} from "@tauri-apps/api/path";

const configFile = await join(await appConfigDir(), "settings.json");
const dataDir = await appDataDir();
const cacheDir = await appCacheDir();
const logDir = await appLogDir();
const home = await homeDir();
const desktop = await desktopDir();
const documents = await documentDir();
```

## 文件拖放

Tauri 窗口默认开启 OS 原生文件拖放识别。需要页面内 HTML5 拖拽、react-dnd、antd Tree 拖拽时，把窗口配置设为：

```json
{
  "app": {
    "windows": [
      {
        "label": "main",
        "dragDropEnabled": false
      }
    ]
  }
}
```

如果必须接受从系统文件管理器拖入文件，就保留 `dragDropEnabled: true`，并在 Rust 侧监听窗口 drag/drop 事件或改用 Dialog 让用户选择文件。页面内拖拽和系统文件拖入通常不能同时无冲突保留。

## 常见错误

| 错误做法 | 正确做法 |
|---------|---------|
| 硬编码 `C:\Users\...` | 使用 Tauri path API 或 `AppHandle.path()` |
| 前端 FS 不声明 capability | 声明命令权限和 `fs:scope` |
| 递归 scope 只写 `$DIR/**` | 写 `$DIR` 和 `$DIR/**/*` |
| 从前端直接传任意路径给 Rust 读写 | Rust 侧规范化并限制根目录 |
| Dialog 返回值不判空或不判类型 | `open()` 可能返回 `null`、字符串或数组 |
| 路径拼接用字符串 | Rust 用 `PathBuf`，TS 用 `join()` 或 BaseDirectory |
| 修改窗口 `dragDropEnabled` 后只等 HMR | 重启 `pnpm tauri dev` |
