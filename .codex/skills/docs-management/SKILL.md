---
name: docs-management
description: |
  Tauri/VitePress 文档站维护技能，指导首次初始化、增量同步代码变更、全量重建、下载页版本数据、文档元数据和发布后文档刷新。

  触发场景:
  - 需要为 Tauri 项目创建或维护 VitePress 文档站
  - 需要把代码、配置、Command、Capabilities、发布产物或下载链接同步到文档
  - 需要维护 .docs-meta.json、versions.json、download 页面或用户手册
  - 需要发布后触发文档站重建并验证下载页

  触发词: 文档站、VitePress、docs、用户手册、下载页、版本列表、versions.json、update-docs、文档同步、.docs-meta.json
---

<!-- @author kongweiguang -->

# VitePress 文档站管理

## 使用原则

- 先判断文档站是否已经存在：常见目录为 `docs/`、`website/`、`*-docs/` 或独立文档仓库。
- 同一事实只维护在一个稳定位置；代码注释、README、用户手册和下载页不要重复展开。
- 文档更新跟随真实代码和构建产物，不凭记忆写 API、权限或文件名。
- 面向用户的文档写“能做什么、怎么操作、结果是什么”；面向开发者的文档写“入口、契约、验证方式”。

## 文档放置决策

| 内容 | 推荐位置 | 说明 |
|------|----------|------|
| 启动、构建、调试 | `README.md` 或 `docs/dev/` | 开发者入口 |
| 用户功能说明 | `docs/guide/` | 按用户任务组织 |
| Command/API 契约 | `docs/reference/commands.md` | 与 `src-tauri/src/commands` 对齐 |
| Capabilities/插件 | `docs/reference/permissions.md` | 与 `src-tauri/capabilities` 对齐 |
| 下载与版本 | `docs/download.md`、`versions.json` | 与 release 产物对齐 |
| 常见问题 | `docs/faq.md` | 只放稳定问题 |
| 变更记录 | `docs/changelog.md` 或 release notes | 只记录用户可见变化 |

## `.docs-meta.json`

有增量同步需求时，在文档站根目录维护元数据：

```json
{
  "version": 1,
  "sourceRoot": "../app",
  "updatedAt": "2026-06-16T00:00:00Z",
  "files": {
    "src-tauri/src/commands/user.rs": {
      "doc": "docs/reference/commands.md",
      "section": "user",
      "sha256": "<source file hash>"
    }
  }
}
```

用途：

- 判断某个源文件变更后应更新哪篇文档。
- 避免全量重写导致人工编辑丢失。
- 为发布后下载页、版本列表、Command 文档提供可追踪入口。

## 首次初始化流程

1. 确认文档站目录、目标受众、部署平台和语言。
2. 初始化 VitePress：

```bash
pnpm add -D vitepress
```

3. 建立最小结构：

```text
docs/
├── .vitepress/config.ts
├── index.md
├── guide/
├── reference/
├── download.md
└── changelog.md
```

4. 从真实项目读取 `package.json`、`src-tauri/tauri.conf.json`、`src-tauri/capabilities`、`src-tauri/src/commands`，生成导航和第一批页面。
5. 写入 `.docs-meta.json`，记录源文件到文档章节的映射。
6. 运行 `pnpm docs:build` 或项目已有文档构建命令，修复死链和构建错误。

## 增量同步流程

1. 找出本次代码变更：

```bash
git diff --name-only HEAD
```

2. 按映射决定更新范围：

| 变更文件 | 文档动作 |
|----------|----------|
| `src-tauri/src/commands/*.rs` | 更新 Command/API 参考 |
| `src-tauri/capabilities/*.json` | 更新权限说明 |
| `src-tauri/tauri.conf.json` | 更新配置、窗口、打包、更新说明 |
| `src/pages/**`、`src/components/**` | 更新用户功能指南或截图 |
| release 产物、`update.json`、`versions.json` | 更新下载页和版本记录 |

3. 只修改受影响章节，保留人工写作内容。
4. 更新 `.docs-meta.json` 中的 hash 和时间。
5. 构建文档站并检查关键页面。

## 全量重建流程

仅在文档结构腐化、项目大重构或用户明确要求时执行：

1. 备份现有文档或确认能从 Git 恢复。
2. 读取所有源入口，重建导航和页面结构。
3. 保留 `changelog`、人工 FAQ、部署配置和下载页稳定链接。
4. 重新生成 `.docs-meta.json`。
5. 构建并人工检查首页、指南、API、下载页。

## 发布后文档刷新

发布桌面或移动端版本后，文档站至少同步：

- 最新版本号、发布日期、更新说明。
- 下载表格中的平台、架构、文件名、大小、校验信息。
- `versions.json` / `mobile-versions.json` 这类构建时拉取的数据。
- `.last-release.json` 或项目约定的触发文件，用于强制静态站重新构建。

验证：

```bash
pnpm docs:build
```

如果下载页在构建时抓取远程版本数据，发布后要验证远程 JSON 返回 200，并触发文档站重新构建。

## 写作风格

- 中文项目优先中文；标题短，h2/h3 层级清晰。
- 表格适合 Command、权限、配置、平台支持矩阵。
- 用户操作按步骤写，开发者参考按入口文件和契约写。
- 不在用户手册暴露密钥、私有仓库、内网路径或 CI token。

## 常见错误

| 错误做法 | 正确做法 |
|---------|---------|
| 代码改了但文档仍写旧 Command | 按变更文件更新对应参考页 |
| 全量覆盖人工文档 | 增量更新受影响章节 |
| 下载页文件名凭猜测 | 从 release 产物和 update JSON 读取 |
| 版本数据只改本地不部署 | 上传远程 `versions.json` 并触发重建 |
| 文档站构建不跑 | 至少跑 `pnpm docs:build` 或项目等价命令 |
| 文档写入真实密钥/私有路径 | 使用配置变量和参数说明 |
