---
name: bwy-redis-diagnostics
description: |
  用于 Redis 只读诊断与缓存排查，例如按环境连接 Redis、ping/info、scan key、查看 key 类型、TTL、长度或受控读取样例值。禁止清库、删除、写入或执行 Lua/配置修改等高风险操作。
---

# Redis 诊断能力

## 工作原则

- 只做 Redis 只读诊断，不做写入、删除、清库、配置修改、Lua 执行或批量危险操作。
- 配置按环境读取当前仓库 Spring Boot `application*.yml`，具体资源目录由 `AGENTS.md` 或自动发现决定。
- 默认按 `--env`、`SPRING_PROFILES_ACTIVE` 或 `application.yml` 的 active profile 选择环境；无法识别时使用 `local`。
- 生产或准生产环境默认只读；如需要 Redis 写操作，必须另走人工授权和专门脚本，不在本 skill 中提供。
- 输出限制数量和长度；涉及 token、验证码、会话、个人信息时只输出类型、长度、TTL 和少量脱敏摘要。

## 配置入口

- 默认资源目录优先读取 `AGENTS.md` 的 `PROJECT_START_MODULE/src/main/resources`，未配置时自动发现 `*-start/src/main/resources`；也可通过 `--resources-dir` 指定。
- 读取 `application.yml` 与 `application-<env>.yml` 后合并。
- 读取 `spring.data.redis`。
- Redis 密码来自 YAML 中的 `password`；若使用 `${ENV_NAME}` 或 `${ENV_NAME:default}` 环境变量引用，脚本优先从环境变量读取。

## 脚本命令

```powershell
node .codex/skills/bwy-redis-diagnostics/scripts/redis_ops.js list --env dev
node .codex/skills/bwy-redis-diagnostics/scripts/redis_ops.js validate --env dev
node .codex/skills/bwy-redis-diagnostics/scripts/redis_ops.js ping --env dev --target main
node .codex/skills/bwy-redis-diagnostics/scripts/redis_ops.js info --env dev --target main --section keyspace
node .codex/skills/bwy-redis-diagnostics/scripts/redis_ops.js scan --env dev --target main --pattern "sys:*" --limit 50
node .codex/skills/bwy-redis-diagnostics/scripts/redis_ops.js inspect --env dev --target main --key "sys:config"
```

## 允许操作

- `ping`：连通性检查。
- `info`：读取 Redis info 指定 section。
- `scan`：使用 SCAN 分批查 key，必须限制数量，不使用 `KEYS *`。
- `inspect`：查看 key 类型、TTL、长度；默认不展示完整值。
- `inspect --show-value`：只在确认不含敏感数据时使用，并受 `--max-value-bytes` 限制。

## 常用例子

缓存排查路径：

```markdown
1. `list/validate` 确认 Redis target。
2. `ping` 确认连通性。
3. `scan --pattern "<prefix>:*"` 找候选 key。
4. `inspect --key "<key>"` 看类型、TTL、长度。
5. 对照业务代码的缓存 key、过期时间和失效逻辑。
```

输出摘要模板：

```markdown
- target：<env/target/db>
- key：<脱敏 key 或前缀>
- 类型：<string/hash/list/set/zset>
- TTL：<seconds/-1/-2>
- 长度：<len/hlen/llen>
- 结论：<不存在/过期异常/结构不符/值疑似历史数据>
- 风险：<未展示敏感原值/未连接生产/样例数量限制>
```

## 禁止项

- 不执行 `FLUSHALL`、`FLUSHDB`、`DEL`、`UNLINK`、`SET`、`MSET`、`HSET`、`CONFIG`、`EVAL`、`SCRIPT`、`MIGRATE` 等写入或危险命令。
- 不使用 `KEYS *` 扫全库；必须用 `SCAN` 并设置 `--limit`。
- 不把 Redis 密码写入示例文件、长期文档或提交文件。
- 不把疑似 token、验证码、session、手机号、身份证号等敏感值原样输出。

## 输出口径

- 说明 target、database、key 类型、TTL、长度、样例数量、是否截断。
- 无法连接时说明目标、配置路径、缺失的环境变量或网络错误摘要。
- 排查出缓存口径变化时，同步提醒更新对应 `.updeng/docs/biz/**` 或问题记录。
