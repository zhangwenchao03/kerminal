# `docs/` 目录说明

`docs/` 只保留面向仓库入口的静态素材和少量需要直接被根 `README.md` 引用的文件。

当前约定：

- `docs/assets/`：README 和发布展示用图片素材。
- 过程文档、计划、设计、验证记录、业务规则：统一放到 [`.updeng/docs/`](C:/dev/rust/kerminal/.updeng/docs/README.md)。

不要再把临时计划、草案 spec、浏览器 profile 或一次性调研稿直接放到 `docs/` 根下；这类内容要么进入 `.updeng/docs/` 的对应目录，要么在任务结束后清理。
