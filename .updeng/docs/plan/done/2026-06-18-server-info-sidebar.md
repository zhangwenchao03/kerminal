---
id: PLAN-20260618-000028-server-info-sidebar
status: done
created_at: 2026-06-18T00:00:28+08:00
started_at: 2026-06-18T00:00:28+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# 右栏服务器信息增强

## 目标
- 远程 SSH 主机稳定显示每核 CPU 占用，并补齐成熟终端常见的系统统计信息。
- 右侧系统面板默认折叠详情卡片。
- 切换右侧工具后保留上一次服务器信息，首次采集后不因组件重挂载清空内容。
- 缩短采集脚本的 CPU 采样等待，并限制慢 GPU 探测对首屏速度的影响。

## 非目标
- 不实现长期后台常驻监控或实时流式曲线。
- 不引入新的远端 agent、daemon 或 sudo 权限依赖。
- 不改 SSH 凭据、远程主机管理和终端连接流程。

## 影响范围
- Rust/Tauri：`src-tauri/src/models/server_info.rs`、`src-tauri/src/services/server_info_service.rs`、相关测试。
- 前端：`src/lib/serverInfoApi.ts`、`src/features/tool-panel/ServerInfoToolContent.tsx`。
- 验证：Rust 测试、前端类型检查/测试或构建。

## 执行步骤
- [x] 调整远端 shell 采集脚本与 Rust 解析模型。
- [x] 增加解析测试覆盖新增字段和每核 CPU 稳定输出。
- [x] 更新右栏系统 UI 和缓存策略。
- [x] 运行格式化与匹配范围验证。

## 验证
- `cargo test --test server_info_service`
- `pnpm typecheck`
- 视改动结果补充相关前端测试或 `pnpm test -- --run`

## 风险
- 远端非 Linux 或受限容器仍可能缺少 `/proc`、`df`、`ps`、`nvidia-smi`，界面需要显示已采集部分而不是报错。
- 新增字段必须保持可选，避免旧快照或部分输出导致前端崩溃。


