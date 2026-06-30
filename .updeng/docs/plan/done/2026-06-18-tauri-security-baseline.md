---
id: PLAN-20260618-000036-tauri-security-baseline
status: done
created_at: 2026-06-18T00:00:36+08:00
started_at: 2026-06-18T00:00:36+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# Tauri 安全基线收紧

## 目标

- 为生产构建启用明确 CSP，不再使用 `csp: null`。
- 为开发模式单独配置 `devCsp`，允许 Vite 1425 热更新所需的本地 HTTP/WebSocket 来源。
- 显式锁定启用的 Tauri capability，避免后续新增 capability 文件被默认自动启用。
- 移除当前前端未使用的 opener 插件权限和依赖，降低默认 WebView API 面。
- 增加配置回归测试，防止 CSP、capability 和 opener 权限回退。

## 非目标

- 本次不做签名证书、自动更新、安装包发布或跨平台真实安装验收。
- 本次不引入 fs/dialog/shell/process 等新插件权限。
- 本次不限制自定义 Tauri Command；AI/SSH/SFTP 等业务权限仍由 Rust policy、参数校验和审计控制。

## 影响范围

- Tauri 配置：`src-tauri/tauri.conf.json`。
- Tauri capability：`src-tauri/capabilities/default.json`。
- Rust 入口和依赖：`src-tauri/src/lib.rs`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`。
- 前端依赖锁：`package.json`、`package-lock.json`。
- 测试：`src-tauri/tests/tauri_security_config.rs`。
- 文档：本计划、`.updeng/docs/in-progress.md`、总产品计划 slice 22。

## 执行步骤

- [x] 配置生产 CSP、开发 `devCsp` 和 `freezePrototype`。
- [x] 在 `app.security.capabilities` 显式只启用 `default`。
- [x] 从 default capability 移除未使用的 `opener:default`。
- [x] 移除未使用的 opener 插件注册和依赖。
- [x] 增加 Rust 配置测试，覆盖 CSP、devCsp、capabilities 和 opener 权限禁用。
- [x] 运行最窄测试、`npm run check` 和 `http://127.0.0.1:1425/` 浏览器 smoke。
- [x] 更新总计划和本计划状态。

## 验证

- `cd src-tauri && cargo test --test tauri_security_config`：3 个测试通过。
- `npm run check`：前端 32 个测试文件 / 212 个测试通过，Rust fmt、clippy、全量测试和生产构建通过。
- 浏览器打开 `http://127.0.0.1:1425/`：工作台加载成功，日志工具可打开，控制台 error 为 0，页面无 `Next Terminal` 文案。

## 结果

- Tauri 生产 CSP 已启用，开发 CSP 单独允许 `localhost:1425`、`127.0.0.1:1425` 和 HMR WebSocket。
- 默认 capability 显式锁定为 `default`，主窗口默认只授予 `core:default`。
- 未使用的 opener 插件已从 Rust 注册、Cargo/npm 依赖和默认 capability 中移除。
- 本次只完成安全基线收紧；三平台真实安装包、签名和自动更新发布验收仍属于后续打包切片。

## 风险

- CSP 过严可能影响 Tauri dev 热更新或生产资源加载；用单独 `devCsp` 和生产构建验证降低风险。
- 移除 opener 插件后，未来如果要从前端直接打开外部 URL，需要重新引入插件、权限和测试；当前代码未使用该插件。


