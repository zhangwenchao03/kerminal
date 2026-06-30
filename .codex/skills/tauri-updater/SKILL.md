---
name: tauri-updater
description: |
  Tauri 2 应用自动更新技能，使用 tauri-plugin-updater 实现版本检查、签名、更新端点、下载安装和重启流程。

  触发场景:
  - 需要实现应用自动更新
  - 需要配置更新服务器
  - 需要处理更新 UI 和流程
  - 需要管理更新签名和安全
  - 需要排查 updater artifact、signature 或 endpoint 问题

  触发词: 更新、update、自动更新、版本更新、升级、updater、OTA、签名、createUpdaterArtifacts
---

# Tauri 应用自动更新

## 安装

优先使用官方 CLI：

```bash
pnpm tauri add updater
pnpm tauri add process
```

手动安装：

```toml
# src-tauri/Cargo.toml
tauri-plugin-updater = "2"
tauri-plugin-process = "2"
```

```bash
pnpm add @tauri-apps/plugin-updater @tauri-apps/plugin-process
```

## 注册

Updater 是桌面更新能力。面向 Tauri 2 移动端项目时，建议只在桌面注册：

```rust
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            #[cfg(desktop)]
            {
                app.handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())?;
                app.handle().plugin(tauri_plugin_process::init())?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

纯桌面项目也可以直接链式 `.plugin(...)` 注册。

## Capability

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "updater",
  "description": "Allow update checks and app relaunch",
  "windows": ["main"],
  "platforms": ["linux", "macOS", "windows"],
  "permissions": ["updater:default", "process:default"]
}
```

## tauri.conf.json

```json
{
  "bundle": {
    "createUpdaterArtifacts": true
  },
  "plugins": {
    "updater": {
      "endpoints": [
        "https://releases.myapp.com/{{target}}/{{arch}}/{{current_version}}"
      ],
      "pubkey": "YOUR_PUBLIC_KEY_HERE"
    }
  }
}
```

要点：

- `bundle.createUpdaterArtifacts: true` 会为各平台生成 updater artifact 和 `.sig`。
- `pubkey` 是 `tauri signer generate` 输出的公钥，私钥绝不能提交仓库。
- endpoint 可用静态 JSON，也可用带变量的动态 URL。
- 构建产物和 update JSON 要保持平台、架构和版本一致。

## 更新端点

### 动态端点

动态端点可按 `{{target}}`、`{{arch}}`、`{{current_version}}` 返回对应平台更新信息：

```
https://api.example.com/{{target}}/{{arch}}/{{current_version}}
```

### 静态 JSON

```json
{
  "version": "1.1.0",
  "notes": "修复了若干问题，提升了性能",
  "pub_date": "2026-03-05T12:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "url": "https://github.com/user/repo/releases/download/v1.1.0/MyApp_1.1.0_x64-setup.exe",
      "signature": "CONTENT_OF_SIG_FILE"
    },
    "darwin-aarch64": {
      "url": "https://github.com/user/repo/releases/download/v1.1.0/MyApp.app.tar.gz",
      "signature": "CONTENT_OF_SIG_FILE"
    },
    "darwin-x86_64": {
      "url": "https://github.com/user/repo/releases/download/v1.1.0/MyApp.app.tar.gz",
      "signature": "CONTENT_OF_SIG_FILE"
    },
    "linux-x86_64": {
      "url": "https://github.com/user/repo/releases/download/v1.1.0/MyApp_1.1.0_amd64.AppImage.tar.gz",
      "signature": "CONTENT_OF_SIG_FILE"
    }
  }
}
```

`signature` 填 `.sig` 文件内容，不是文件路径。

## 前端更新检查

```typescript
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";

export async function checkForUpdate() {
  const update = await check();

  if (!update) {
    return { available: false as const };
  }

  let downloaded = 0;
  let contentLength = 0;

  await update.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        contentLength = event.data.contentLength ?? 0;
        downloaded = 0;
        break;
      case "Progress":
        downloaded += event.data.chunkLength;
        break;
      case "Finished":
        break;
    }
  });

  return {
    available: true as const,
    version: update.version,
    body: update.body,
    downloaded,
    contentLength,
    relaunch,
  };
}
```

UI 层应在下载前确认用户意愿，下载失败时允许重试，安装完成后提示重启：

```typescript
const result = await checkForUpdate();
if (result.available) {
  await result.relaunch();
}
```

## 生成签名密钥

```bash
pnpm tauri signer generate -w ~/.tauri/myapp.key
```

构建时提供私钥和可选密码：

```bash
TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/myapp.key)" pnpm tauri build
```

CI 中使用 secrets：

| Secret | 说明 |
|--------|------|
| `TAURI_SIGNING_PRIVATE_KEY` | 私钥内容 |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 私钥密码，无密码时可留空 |

## GitHub Actions CI 模板

```yaml
name: Release
on:
  push:
    tags: ["v*.*.*"]

jobs:
  release:
    strategy:
      fail-fast: false
      matrix:
        include:
          - platform: windows-latest
            args: "--bundles nsis"
          - platform: macos-latest
            args: "--bundles app,dmg"
            target: aarch64-apple-darwin
          - platform: macos-latest
            args: "--bundles app,dmg"
            target: x86_64-apple-darwin
          # - platform: ubuntu-22.04
          #   args: "--bundles appimage,deb"
    runs-on: ${{ matrix.platform }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: lts/*
      - uses: dtolnay/rust-toolchain@stable
        with:
          targets: ${{ matrix.target }}
      - run: pnpm install
      - uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
        with:
          tagName: ${{ github.ref_name }}
          releaseName: "MyApp ${{ github.ref_name }}"
          releaseDraft: true
          args: ${{ matrix.args }}
```

发布流程：

1. 同步 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 版本号。
2. 构建并上传安装包、updater artifact 和 `.sig`。
3. 将 `.sig` 文件内容写入更新端点响应。
4. 在干净环境安装已发布版本，验证检查、下载、安装、重启流程。

## 常见错误

| 错误做法 | 正确做法 |
|---------|---------|
| Windows update URL 写 `.nsis.zip` | 使用 `createUpdaterArtifacts: true` 生成的 artifact |
| 不签名更新包 | 必须配置 `pubkey` 并使用私钥签名 |
| 私钥提交到仓库 | 私钥只放本地或 CI secrets |
| 只装 updater 不装 process | 安装完成后用 process 插件 relaunch |
| 移动端也直接注册 updater | 桌面专用注册加 `#[cfg(desktop)]` |
| 不处理下载失败 | catch 错误并允许重试 |
| 不做真实更新链路测试 | 发布前用已发布安装包验证完整链路 |
