---
name: rust-tauri-development-standards
description: |
  Rust / Tauri 开发规范技能，融合 Rust Style Guide、Rust API Guidelines、Rust Book 错误处理、Clippy、作者标识、rustfmt、模块边界、API 类型设计、中文注释、错误处理、rustdoc 与测试要求。适用于 Rust 后端、Tauri 命令、本机能力、外部协议、数据库、文件系统和配套脚本变更。

  触发场景：
  - 新增或修改 Rust 源文件、Tauri Command、模块结构、公开类型、serde 数据传输类型、错误类型或配套脚本
  - 需要处理 Rust 命名、trait、From/TryFrom、Result、panic、unwrap、日志、用户可见错误或 rustdoc
  - 需要按规范补充 cargo fmt、cargo clippy、Rust/Tauri 单元测试或集成测试

  触发词：Rust、Tauri、tauri::command、cargo fmt、cargo clippy、Result、panic、unwrap、serde、rustdoc、Rust开发规范
---

<!-- @author kongweiguang -->

# Rust / Tauri 开发规范

## 作者标识

- 所有新增或重写的 Rust 源文件、Tauri 配套脚本和可写注释的配置文件，都需要在文件头或模块级文档注释中标注 `@author kongweiguang`。
- 不支持注释的 JSON、锁文件、机器生成文件和二进制资源除外。
- 同时遵守 `general-development-standards` 中的文档、注释、测试和对外边界要求。
- Rust / Tauri 开发规范以本技能为准；修改规范时直接维护本技能。
- 需要解释规范来源、统一团队规则或处理“官方规则 vs 项目惯例”争议时，先读 `references/standards-sources.md`。

## 规范来源与执行等级

- 优先级：用户最新要求 > `AGENTS.md` 和当前目录规则 > 当前项目既有实现 > 本技能 > Rust 官方与一手资料 > 第三方风格建议。
- P0 正确性规则必须满足：`cargo fmt`、项目约定的 `cargo clippy`、编译和相关测试通过；可恢复错误返回 `Result`；生产路径不随意 `unwrap()`；Tauri 命令不泄露底层实现和敏感信息。
- P1 API 设计规则默认满足：命名遵循 Rust 约定；转换用 `From`/`TryFrom`/`AsRef`/`AsMut`；公共类型按语义实现常用 trait；错误类型可定位、可展示、可记录。
- P2 文档与风格规则按项目统一执行：rustdoc、中文注释、模块拆分、测试命名、日志上下文、文件头作者标识和脚本格式。
- 如果 P0 与项目旧代码冲突，新代码按 P0 修正；旧代码只在本次影响范围内最小修复，不顺手大规模重写。
- Clippy 的 `restriction`、`pedantic` 和 `nursery` 类 lint 只逐条启用，不整组打开；启用前说明收益、误报和回滚方式。

## 开发手册化检查

- 格式：默认遵循 Rust Style Guide 和 `rustfmt`；不为个人偏好新增 `rustfmt.toml`；已有 `rustfmt.toml` 时按项目配置执行。
- 命名：模块、函数、变量用 `snake_case`，类型和 trait 用 `UpperCamelCase`，常量用 `SCREAMING_SNAKE_CASE`；同一语义保持一致词序。
- 模块：命令入口、领域服务、本机数据、外部协议、存储、窗口能力和测试按职责分层；Tauri Command 只暴露前端需要的语义化能力。
- 类型：用枚举、newtype 和结构体字段可见性表达状态与不变量，避免用散落字符串、裸布尔值或临时 Map 传递长期协议。
- API：会失败的构造和转换返回 `Result` 或实现 `TryFrom`；不会失败的转换使用 `From`；集合访问按 `iter`、`iter_mut`、`into_iter` 表达所有权。
- 错误：用户可恢复问题返回友好错误；开发者定位信息写日志；不可恢复的内部不变量错误才使用 `panic!`，并在公开 API 文档中说明。
- 文档：公共函数、类型、trait、命令和 unsafe 边界写 rustdoc；返回错误、可能 panic 或涉及安全不变量时必须说明条件。
- 测试：新增序列化、路径、数据库、子进程、外部协议、权限、窗口或 Tauri Command 行为时，至少覆盖正常路径、异常输入和资源清理。

## 格式化与工具

- Rust 代码格式以 `rustfmt` 默认风格为基准，除非项目已有明确 `rustfmt.toml`。
- 提交前优先运行 `cargo fmt` 和项目约定的 `cargo clippy`；Clippy 提示应优先修复，确需忽略时写明原因并缩小 `allow` 范围。
- 模块、文件、函数和测试名称遵循 Rust 常用命名：模块和函数使用 `snake_case`，类型和 trait 使用 `UpperCamelCase`，常量使用 `SCREAMING_SNAKE_CASE`。

## 模块边界

- Rust 模块需要按职责拆分，例如命令入口、领域服务、本机数据、外部协议、窗口能力、日志、配置和测试。
- Tauri 命令应暴露语义化能力，不直接泄漏底层数据库、文件系统、子进程、网络协议或第三方 SDK 细节给前端页面层。
- 外部进程、JSON-RPC / HTTP / WebSocket 协议、本地服务、数据库和文件系统操作都需要有明确的错误边界与日志。
- 复杂状态应使用清晰的结构体、枚举和小函数表达，避免用散落字符串和布尔值隐式驱动流程。

## API 与类型设计

- 公开类型优先实现常用 trait，例如 `Debug`、`Clone`、`Default`、`PartialEq`、`Eq`、`Hash`、`Serialize`、`Deserialize`，具体按语义和成本决定。
- 转换能力优先使用标准 trait，例如 `From`、`TryFrom`、`AsRef`、`AsMut`，避免自造不一致的转换方法名。
- 会失败的转换使用 `TryFrom` 或返回 `Result` 的构造函数；不会失败的转换使用 `From`。
- 集合访问遵循 `iter`、`iter_mut`、`into_iter` 语义；不要用含糊方法名隐藏所有权变化。
- 优先用类型系统表达状态和约束，例如枚举表示有限状态、newtype 表示已校验值、结构体字段可见性保护不变量。
- 公共 API 需要为未来演进留余地，避免把内部结构、临时字段或第三方库细节直接暴露为稳定接口。

## 注释与错误

- 公开结构体、字段、枚举、函数和命令需要补充中文注释，说明协议含义、调用时机和生命周期边界。
- 用户可见错误需要转成友好提示；底层错误码、路径、sidecar 细节和协议上下文写入日志或开发者控制台。
- 涉及路径、进程、网络、数据库、序列化和外部协议的复杂流程，需要在关键分支补充中文注释。
- 错误类型需要保留足够定位信息，但不要把敏感 token、密钥、完整用户输入或内部路径直接暴露给普通用户。
- 可恢复错误默认返回 `Result<T, E>`，不要用 `panic!` 代替调用方可以处理的错误。
- `panic!` 只用于违反内部不变量、调用方契约或继续执行会不安全的场景；公开 API 可能 panic 时需要在文档中说明。
- 生产代码避免随意 `unwrap()`；能提供上下文且确实已证明不可能失败时才使用 `expect(...)`，并在消息中说明不变量。

## 文档

- 公共模块、公共类型、公共函数、trait、枚举和宏需要有 rustdoc，说明用途、参数语义、返回值和生命周期边界。
- 可能返回错误的公共函数需要说明错误条件；可能 panic 的公共函数需要说明 panic 条件；`unsafe` API 必须说明调用方需要维护的安全不变量。
- 示例代码应尽量可运行，并优先使用 `?` 传播错误，避免让 `unwrap()` 成为复制粘贴后的默认做法。

## 测试

- Rust 回归测试位置按项目既有结构执行；单元测试优先贴近被测模块，使用 `#[cfg(test)] mod tests` 验证私有函数和模块内不变量。
- 当单个生产文件因内联测试变得臃肿时，把测试拆到同目录 `tests.rs`、`*_tests.rs` 或测试专用子模块中，并通过 `#[cfg(test)]` 挂载；生产文件底部只保留必要模块声明。
- 集成测试、Tauri Command 行为、跨 service/database 的流程测试放在当前 crate 的 `tests/` 目录；本项目 Tauri crate 对应 `src-tauri/tests/*.rs`。
- 跨测试共享 fixture、临时目录、mock server、断言 helper 放在 `src-tauri/tests/common/` 或语义清晰的测试辅助模块，不放进生产服务模块。
- 新增配置写入、事件归一化、本机数据表结构、窗口行为、外部协议、路径处理、序列化或子进程管理时，需要补充对应测试。
- 测试应覆盖正常路径、异常输入、边界状态、跨平台路径和资源清理。
- Rust 生产文件和测试文件同样遵守通用规范的 1000 行硬上限；超过 800 行要按领域服务、协议适配器、fixture、集成场景或断言 helper 拆分。

## 官方参考

- Rust Style Guide：https://doc.rust-lang.org/style-guide/
- Rust API Guidelines：https://rust-lang.github.io/api-guidelines/checklist.html
- Rust API Guidelines Documentation：https://rust-lang.github.io/api-guidelines/documentation.html
- Rust Book Error Handling：https://doc.rust-lang.org/book/ch09-00-error-handling.html
- Rust Book Test Organization：https://doc.rust-lang.org/book/ch11-03-test-organization.html
- Cargo Test：https://doc.rust-lang.org/cargo/commands/cargo-test.html
- Clippy Documentation：https://doc.rust-lang.org/clippy/
