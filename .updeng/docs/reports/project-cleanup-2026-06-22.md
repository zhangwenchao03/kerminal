# 项目目录整理记录

整理时间：2026-06-22T16:14:55+08:00。

## 已处理

- 将根目录 `prototypes/kerminal-logo-canvas.prototype.html` 移到 `.updeng/docs/prototypes/kerminal-logo-canvas.prototype.html`。这是已标记 `PROTOTYPE` 的 logo canvas 原型，不属于生产入口。
- 删除根目录 `target/`。该目录包含 `codex-smoke` 浏览器 profile 和独立 smoke target，属于可再生成验证产物。
- 删除 `src-tauri/target-port-forward-worker/`。该目录是 Cargo target 形态的临时构建产物，不应进入 Git 未跟踪清单。
- 删除 `dist/`、`tmp/`、`.tmp/` 和根目录 Vite smoke 日志。这些都是构建或验证运行产物，可由对应命令重新生成。
- 更新 `.gitignore`，补充 `/target/`、`/src-tauri/target-port-forward-worker/` 和 `.tmp/`，避免同类产物再次污染工作区。

## 保留

- `src-tauri/target/` 保留。它是 Tauri/Rust 的正常 Cargo 编译缓存，当前还有 `src-tauri/target/debug/kerminal.exe` 在运行；删除会释放大量空间，但会强制后续全量重编译，并且当前可能被占用。
- `node_modules/` 保留。它是前端依赖目录，已被 `.gitignore` 忽略；删除只会节省本地空间，后续需要重新 `npm install`。
- `.codegraph/`、`.codex/`、`.updeng/` 保留。它们是当前工作流、索引和项目规则目录。
- `docs/`、`LICENSE`、`TRADEMARKS.md` 保留。`README.md` 已引用 `docs/assets/*` 和许可证/商标文档，它们不是垃圾文件。

## 验证

- `git check-ignore` 确认 `/target/`、`/src-tauri/target-port-forward-worker/`、`.tmp/`、`tmp/`、`dist/` 会被忽略。
- 引用扫描未发现 `target-port-forward-worker`、`codex-smoke`、`kerminal-logo-canvas` 或 `prototypes` 被 `README.md`、`package.json`、`scripts/`、`src/`、`src-tauri/`、`.github/`、`docs/` 下的源码/脚本引用。

