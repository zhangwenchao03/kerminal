---
name: project-init
description: |
  Tauri 模板项目初始化技能，指导从模板仓库创建新应用、收集项目元信息、替换产品名/identifier/package、配置 Git/upstream、更新端点、签名密钥和启动验证。

  触发场景:
  - 需要基于现有 Tauri 模板创建新项目
  - 需要批量替换应用名称、包名、identifier、作者、描述或更新端点
  - 需要保留模板仓库为 upstream 并初始化新项目 Git 仓库
  - 需要为新项目准备图标、自动更新签名和首次启动验证

  触发词: 新项目、创建项目、初始化项目、模板项目、project init、new project、identifier、package rename、upstream
---

<!-- @author kongweiguang -->

# Tauri 模板项目初始化

## 核心原则

- 模板仓库只读；所有替换和初始化都在新目录中完成。
- 初始化前先检查模板仓库是否干净、是否落后远端；不要把模板的临时改动带入新项目。
- 先收集信息并确认映射表，再执行替换。
- 替换顺序先长后短，避免短包名误伤依赖名、路径或普通文本。

## 信息收集

初始化前确认：

| 信息 | 示例 | 规则 |
|------|------|------|
| 项目目录 | `D:/work/my-app` | 不存在或用户确认可覆盖 |
| 产品名 | `My App` | 用于窗口标题、安装包名、页面标题 |
| 产品短名 | `my-app` | 用于目录、文件名前缀、下载路径 |
| Tauri identifier | `com.company.myapp` | 反向域名，不能包含下划线 |
| Rust package name | `my_app` | `snake_case`，用于 crate/lib |
| npm package name | `my-app` | `kebab-case` |
| 作者/版权 | `Company` | 写入配置和文档 |
| 更新端点 | `https://.../update.json` | 可后续配置 |
| Git 远端 | `origin` URL | 可先不推送 |

## 创建目录

优先用 `git archive` 导出模板，避免复制 `.git`：

```bash
git -C <template-repo> archive --format=tar HEAD | tar -x -C <new-project-dir>
```

Windows PowerShell 环境也可使用 Git 自带 tar；如果不可用，退回受控复制，但必须排除 `.git`、`target`、`node_modules`、`dist`、临时日志和本地密钥。

## Git 初始化

```bash
cd <new-project-dir>
git init
git remote add upstream <template-repo-url>
git remote add origin <new-project-url>
```

保留 `upstream` 的作用是后续同步模板更新：

```bash
git fetch upstream
git log --oneline HEAD..upstream/main
git diff HEAD..upstream/main -- <path>
```

## 替换映射

建立明确的旧值到新值映射：

| 类型 | 旧值 | 新值 |
|------|------|------|
| 产品名 | `<Template Product>` | `<New Product>` |
| identifier | `com.example.template` | `com.company.myapp` |
| Rust package | `template_app` | `my_app` |
| Rust lib crate | `template_app_lib` | `my_app_lib` |
| npm package | `template-app` | `my-app` |
| 下载前缀 | `Template.App_` | `My.App_` |

常见替换位置：

- `package.json`
- `src-tauri/Cargo.toml`
- `src-tauri/tauri.conf.json`
- `src-tauri/src/main.rs`
- `src-tauri/src/lib.rs`
- `index.html`
- `README.md`
- `.github/workflows/*.yml`
- 文档站下载页和版本文件

替换后扫描旧值：

```bash
rg "Template Product|com\\.example\\.template|template_app|template-app" .
```

## 自动更新和签名

如果新项目启用自动更新：

1. 运行 `pnpm tauri signer generate -w <user-key-path>` 生成密钥。
2. 只把公钥写入 `tauri.conf.json -> plugins.updater.pubkey`。
3. 私钥放本机安全目录或 CI secret，不提交仓库。
4. 配置 `bundle.createUpdaterArtifacts: true`。
5. 配置一到多个更新端点，生产环境优先 HTTPS。

如果暂不启用更新，禁用 updater 插件，不要写假的 pubkey/endpoint。

## 图标和资源

- 准备 1024x1024 PNG 源图。
- 运行 `pnpm tauri icon <icon.png>` 生成多平台图标。
- 检查 `bundle.icon` 是否指向生成文件。
- Windows 产品名含中文或空格时，优先验证 NSIS；WiX/MSI 对名称和本地化更敏感。

## 首次验证

```bash
pnpm install
pnpm typecheck
cd src-tauri && cargo check
pnpm tauri dev
```

根据项目实际脚本替换 `typecheck`。验证点：

- 应用窗口标题、侧边栏、托盘、关于页显示新产品名。
- `identifier`、包名和 crate 名编译通过。
- `capabilities`、插件注册和 updater 配置没有旧值。
- `rg` 扫描不到需要替换的模板旧值。

## 初始提交

```bash
git add .
git commit -m "chore: initialize project from tauri template"
```

推送前确认没有密钥、token、本地路径和大体积构建产物。

## 常见错误

| 错误做法 | 正确做法 |
|---------|---------|
| 直接复制模板 `.git` | 用 `git archive` 或排除 `.git` |
| 先替换短包名 | 先替换长 crate/lib 名，再替换短名 |
| identifier 用下划线 | 使用反向域名格式 |
| 私钥写入仓库 | 只提交 updater 公钥 |
| 替换后不扫描旧值 | 用 `rg` 验证旧产品名/包名/identifier |
| 不保留 upstream | 添加模板 remote 方便后续同步 |
| Cargo.lock 处理不清 | 应用项目通常保留/重新生成并提交，库模板按项目约定 |
