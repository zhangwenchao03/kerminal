<!-- @author kongweiguang -->

# Rust / Tauri 规范来源

## 读取时机

- 当团队需要把 Rust/Tauri 规范解释成“开发手册”时读取。
- 当项目约定、Rust 官方建议和 Clippy lint 出现冲突时读取。
- 普通 Rust/Tauri 开发只按 `SKILL.md` 执行，不需要加载本文件。

## 一手来源

- Rust Style Guide：定义默认 Rust 风格，是 `rustfmt` 默认风格的依据；本项目默认不为个人偏好定制格式化。
- Rust API Guidelines：用于公共 API 设计，覆盖命名、转换 trait、常用 trait、serde、错误类型、文档、类型安全、可预测性和未来兼容性。
- Rust Book Error Handling：区分可恢复错误和不可恢复错误；可恢复错误用 `Result<T, E>`，不可恢复内部错误才用 `panic!`。
- Rust Book Test Organization：单元测试通常放在 `src` 中与被测代码同处，集成测试放在 crate 顶层 `tests` 目录并作为独立 crate 编译。
- Cargo Test：`cargo test` 统一运行单元测试、集成测试和文档测试；测试工作目录是所属 package 根目录，便于稳定使用相对路径。
- Clippy Documentation：Clippy 用 lint 捕获常见错误并改进 Rust 代码；默认关注 correctness、suspicious、style、complexity、perf，不整组启用 restriction。
- Tauri 官方 API 与当前项目实现：Tauri Command 是前端和 Rust 能力的语义边界，前端不应依赖数据库、文件系统、sidecar 或外部协议细节。

## 本项目取舍

- `cargo fmt`、编译、相关测试和项目约定的 `cargo clippy` 属于 P0 验证门禁。
- Rust API Guidelines 属于 P1 公共接口规范；内部小函数可以保持简单，但不能让公开类型泄露临时实现。
- Clippy `pedantic`、`nursery`、`restriction` 属于按需规则；每条启用都要能说明收益和误报成本。
- `unwrap()`、`expect()`、`panic!` 不是绝对禁止，但生产路径只能用于已证明的不变量；公开 API 需要文档说明 panic 条件。
- 中文注释、`@author kongweiguang`、Tauri 模块边界和用户可见错误口径是本项目补充规则。

## 参考链接

- https://doc.rust-lang.org/style-guide/
- https://rust-lang.github.io/api-guidelines/checklist.html
- https://rust-lang.github.io/api-guidelines/documentation.html
- https://doc.rust-lang.org/book/ch09-00-error-handling.html
- https://doc.rust-lang.org/book/ch11-03-test-organization.html
- https://doc.rust-lang.org/cargo/commands/cargo-test.html
- https://doc.rust-lang.org/clippy/
