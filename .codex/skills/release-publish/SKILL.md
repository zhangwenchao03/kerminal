---
name: release-publish
description: |
  Tauri 发布执行技能，指导版本号同步、CI 构建触发、Release asset 获取、update.json 生成、多端点分发、移动端独立发布、下载页刷新和发布验收。

  触发场景:
  - 需要发布 Tauri 桌面或移动端新版本
  - 需要生成或校验 update.json、签名、Release assets、版本列表或下载页
  - 需要用 CI 构建并把产物同步到 GitHub/Gitee/R2/S3/CDN 等分发端点
  - 需要处理便携版、Android APK/AAB 或发布后文档站重建

  触发词: 发布版本、release、publish、update.json、versions.json、R2、CDN、GitHub Release、Gitee、APK、AAB、便携版
---

<!-- @author kongweiguang -->

# Tauri 发布执行

## 发布原则

- 本地只做版本、配置、说明和校验；跨平台安装包优先交给 CI 构建和签名。
- CI 完成前不要推送不完整的 release 仓库或下载页。
- 所有下载链接、签名和文件名都从真实构建产物读取，不手写猜测。
- 私钥、token、rclone 配置、keystore 只放本机安全目录或 CI secrets。
- 发布结束必须验证已发布版本更新、新版安装、下载页和更新端点。

## 版本号同步

桌面版本通常同步三处：

```text
package.json
src-tauri/Cargo.toml
src-tauri/tauri.conf.json
```

移动端如有单独配置，还要同步：

```text
src-tauri/tauri.android.conf.json
src-tauri/gen/android/app/build.gradle.kts
```

发布前运行：

```bash
rg '"version"|^version\\s*=' package.json src-tauri/Cargo.toml src-tauri/*.conf.json
```

## 桌面发布流程

1. 运行本地快速校验：

```bash
pnpm typecheck
cd src-tauri && cargo check
```

2. 更新版本号、release notes、必要文档。
3. 提交源码并打 tag：

```bash
git add package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json
git commit -m "release: vX.Y.Z"
git tag vX.Y.Z
git push origin main
git push origin vX.Y.Z
```

4. 等 CI 生成安装包、updater artifacts 和 `.sig`。
5. 下载 Release assets 到受控目录，核对平台矩阵。
6. 生成 `update.json`，每个平台写真实 URL 和 `.sig` 文件内容。
7. 上传产物和 `update.json` 到主分发端点；可同步备份端点。
8. 发布 GitHub Release 或等价发布页。
9. 更新文档站下载页、`versions.json` 和 `.last-release.json`。
10. 安装已发布版本，验证应用内检查更新、下载、安装、重启。

## 平台矩阵

| 平台 | 常见安装包 | Updater URL 常见产物 |
|------|------------|----------------------|
| Windows x64 | `.exe` NSIS 或 `.msi` | `*-setup.exe` + `.sig` |
| macOS arm64 | `.dmg` | `.app.tar.gz` + `.sig` |
| macOS x64 | `.dmg` | `.app.tar.gz` + `.sig` |
| Linux x64 | `.AppImage` / `.deb` | `.AppImage.tar.gz` + `.sig` |

不要把 Tauri 2 Windows updater 主路径写成 `.nsis.zip`。

## update.json 生成要点

```json
{
  "version": "X.Y.Z",
  "notes": "更新说明",
  "pub_date": "2026-06-16T00:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "url": "https://cdn.example.com/my-app/vX.Y.Z/MyApp_X.Y.Z_x64-setup.exe",
      "signature": "<sig file content>"
    },
    "darwin-aarch64": {
      "url": "https://cdn.example.com/my-app/vX.Y.Z/MyApp.app.tar.gz",
      "signature": "<sig file content>"
    }
  }
}
```

规则：

- `signature` 是 `.sig` 文件内容，不是路径。
- 只包含实际构建并验证过的平台。
- 多端点版本只改变 URL base，版本、notes、signature 保持一致。
- 上传后用 `curl -I` 或等价工具验证 200、content-type 和缓存策略。

## 分发端点策略

| 层级 | 作用 | 要求 |
|------|------|------|
| 主 CDN/R2/S3 | 默认下载和自动更新 | 国内外可访问、HTTPS、可缓存 |
| GitHub Release/raw | 备份和公开归档 | 文件名稳定、release notes 完整 |
| Gitee/GitCode/raw | 国内兜底 | 注意 raw URL、分支名和文件大小限制 |

不要在 CI 中直接推送 release 仓库，除非凭据、重试、冲突和回滚策略都已经固化。更稳妥的模式是 CI 只构建并上传 draft release，本地或受控后处理流程统一生成分发元数据。

## versions.json 和下载页

文档站或下载页常用版本索引：

```json
{
  "versions": [
    {
      "version": "vX.Y.Z",
      "notes": "更新说明",
      "pub_date": "2026-06-16T00:00:00Z",
      "downloads": {
        "windows-x86_64": "https://cdn.example.com/..."
      }
    }
  ]
}
```

发布后：

- 新版本插入数组头部。
- 去重，保留历史版本。
- 上传远程版本索引。
- 触发文档站重建，尤其是构建时抓取版本索引的站点。

## 便携版

便携版不是 Tauri 标准安装包，建议作为可选产物：

- 从已构建的 Windows 安装包提取程序文件，不重新编译。
- 添加项目约定的 portable 标记文件，如 `portable.txt`。
- 删除卸载器、安装器临时文件和注册表相关脚本。
- 只上传到 CDN，不一定放进 GitHub Release，避免超大资产拖慢发布。
- 明确便携版的数据目录语义，并做一次干净目录启动测试。

## Android 独立发布

移动端建议使用独立 tag 和发布元数据：

```bash
pnpm tauri android build --apk --aab
git tag mobile-vX.Y.Z
git push origin mobile-vX.Y.Z
```

发布材料：

- release 签名 APK。
- AAB，用于应用商店。
- `update-mobile.json`，供应用内检查更新。
- `mobile-versions.json`，供文档站下载页展示历史。
- 稳定链接如 `mobile-latest.apk`，可选。

移动端 `update-mobile.json` 可用简化结构，依赖 APK 自身签名校验：

```json
{
  "version": "X.Y.Z",
  "notes": "更新说明",
  "pub_date": "2026-06-16T00:00:00Z",
  "url": "https://cdn.example.com/my-app/mobile-vX.Y.Z/MyApp_X.Y.Z_android-arm64.apk"
}
```

## 发布验收清单

- [ ] 三处桌面版本号一致。
- [ ] tag 指向预期 commit。
- [ ] CI 成功，产物平台矩阵完整。
- [ ] `.sig` 存在且写入 `update.json`。
- [ ] 主端点和备端点 HTTP 可访问。
- [ ] 已发布版本能检查到新版本并完成重启。
- [ ] 新版安装包在干净环境能启动。
- [ ] 下载页、versions 文件和 release notes 已更新。
- [ ] 私钥、token、keystore、rclone 配置没有进入 Git。

## 常见错误

| 错误做法 | 正确做法 |
|---------|---------|
| CI 未完成就推 release 仓库 | 等真实 assets 完整后统一后处理 |
| 手写文件名和签名 | 从产物目录读取文件名和 `.sig` 内容 |
| 多端点 JSON 签名不一致 | 同一产物签名复用，只替换 URL base |
| tag 推多个 CI 远端重复构建 | 选择一个 CI 远端触发，其他远端同步代码即可 |
| 发布后不触发文档站 | 更新版本索引并触发重建 |
| Android 复用桌面 updater JSON | 移动端使用独立 APK/AAB 流程 |
