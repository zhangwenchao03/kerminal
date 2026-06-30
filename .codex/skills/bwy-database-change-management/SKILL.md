---
name: bwy-database-change-management
description: 用于数据库和 SQL 变更任务，例如 MySQL/PostgreSQL/PostGIS 诊断、连库查询、受控写入、建表改表、数据修复、初始化脚本、JSON/数组字段、MyBatis Mapper 查询、分页计数、索引、回滚方案、生产执行清单或 `.updeng/docs/sql/` 脚本维护。
---

# 数据库变更管理能力

## 操作授权默认值

- 用户提出数据库查询、诊断、建表、改表、插入、更新、修复、回填或迁移时，直接使用本 skill 的数据源脚本和流程执行；不要再为了非删除数据库操作反复询问是否允许操作。
- 删除类操作必须先单独询问用户确认，包括 `DELETE`、`DROP`、`TRUNCATE`、清空表、删表、删库、删除索引、删除约束、删除字段或任何等价的破坏性移除动作。
- 非删除操作仍要执行必要的环境识别、执行前校验、边界条件、回滚口径和执行后校验；需要补充缺失的环境、target、业务条件或 SQL 时，可以询问这些具体信息。

## 先读什么

1. 在必载技能完成入口读取后，补读相关 `.updeng/docs/biz/**`。
2. `.updeng/docs/sql/` 中已有脚本和命名方式。
3. 最近似 Mapper、Entity、Bo、Vo、TypeHandler 和业务 Service。
4. 涉及空间数据时配合 `bwy-gis-development`。
5. 涉及发布执行时配合当前仓库的发布交付能力或交付清单；涉及生产远程操作时配合 `bwy-remote-ops-safety`。
6. 需要连库诊断时，先读 `AGENTS.md` 中的配置入口约定和本 skill 的“数据源脚本”规则。

## 变更分类

- 结构变更：表、列、索引、约束、默认值、枚举或字典。
- 数据变更：补数、修复、清洗、重算、迁移或回填。
- 查询变更：Mapper SQL、分页、聚合、权限过滤、排序、空间函数。
- 运行脚本：一次性 Java/PowerShell/SQL 脚本或 dry-run 工具。
- 连库诊断：按环境连接 MySQL/PostgreSQL，执行 ping、schema、query 或执行前后校验。
- 受控写入：用户请求即视为对 `INSERT`、`UPDATE`、`ALTER`、`CREATE` 等非删除写 SQL 的操作授权；`DELETE`、`DROP`、`TRUNCATE` 和删除结构对象必须单独询问用户确认。

## 工作流程

1. 明确业务目标、影响表、数据规模、执行环境、是否可回滚和是否需要停机窗口。
2. 优先定位已有表结构和最近似 SQL，不凭字段名猜业务语义。
3. 写出最小变更：
   - 结构变更给出正向 SQL 和回滚思路。
   - 数据变更优先支持 dry-run、数量预估和幂等条件。
   - 批量更新必须有明确 where 条件和执行前后校验查询。
4. 执行数据库写入前必须形成执行包：
   - 环境、target、SQL 来源和预期影响行数。
   - 执行前校验 SQL、执行后校验 SQL。
   - 回滚 SQL 或人工回滚步骤；无法回滚时明确说明原因和确认点。
   - 是否需要事务、锁评估、停机窗口、备份或发布审批。
5. Mapper 变更要同步检查分页计数、join 放大、排序稳定性、数据权限和空值。
6. SQL 脚本放入 `.updeng/docs/sql/`，文件名包含日期、目标和执行意图。
7. 业务口径变化写入 `.updeng/docs/biz/**`，发布执行事项写入交付清单。

## 数据源脚本

本 skill 提供 MySQL/PostgreSQL 受控诊断脚本：

```powershell
node .codex/skills/bwy-database-change-management/scripts/db_ops.js list --env dev
node .codex/skills/bwy-database-change-management/scripts/db_ops.js validate --env dev
node .codex/skills/bwy-database-change-management/scripts/db_ops.js ping --env dev --target master
node .codex/skills/bwy-database-change-management/scripts/db_ops.js schema --env dev --target master --table public.sys_user
node .codex/skills/bwy-database-change-management/scripts/db_ops.js query --env dev --target master --sql "select count(*) from sys_user"
node .codex/skills/bwy-database-change-management/scripts/db_ops.js query --env dev --target master --allow-write --sql "update sys_user set remark = 'checked' where user_id = 1"
```

配置按环境读取当前仓库的 Spring Boot `application*.yml`：

- 默认资源目录优先读取 `AGENTS.md` 的 `PROJECT_START_MODULE/src/main/resources`，未配置时自动发现 `*-start/src/main/resources`；也可通过 `--resources-dir` 指定。
- 默认环境选择顺序：`--env`、`SPRING_PROFILES_ACTIVE`、`application.yml` 的 `spring.profiles.active`、`local`。
- 读取 `application.yml` 与 `application-<env>.yml` 后合并，支持普通 `spring.datasource` 和动态数据源 `spring.datasource.dynamic.datasource`。
- 密码来自 YAML 中的 `password`；若使用 `${ENV_NAME}` 或 `${ENV_NAME:default}` 环境变量引用，脚本优先从环境变量读取。
- `read_only=true` 只作为环境摘要信息，不阻断 `--allow-write` 下的非删除写 SQL。
- 写 SQL 必须通过命令传入 `--allow-write`；用户请求数据库操作时，非删除写 SQL 已具备操作授权。
- 删除/清空/销毁类 SQL 必须单独询问用户确认；确认后执行时除 `--allow-write` 外，还必须传入 `--confirm-delete`。典型包括 `DELETE`、`DROP`、`TRUNCATE`、清空表、删表、删库、删除索引、删除约束、删除字段或任何等价的破坏性移除动作。
- `db_ops.js` 不用关键字白名单限制非删除 SQL；脚本只做单语句、写入授权、删除确认和审计，SQL 能否执行由目标数据库返回结果决定。
- 单次执行只允许一条 SQL 语句；需要多步变更时拆成执行包中的多条命令和逐步校验。
- target 可使用 `read_only`、`read-only` 或 `readOnly` 标记只读状态，供环境摘要和人工判断使用。
- 写入执行优先使用 `--file .updeng/docs/sql/<date>-<target>-<intent>.sql`，临时短 SQL 才使用 `--sql`。
- 每次执行写入本地 `tmp/data-source-audit/*.jsonl` 审计日志，只记录目标、动作、允许结果和 SQL hash，不记录查询结果。

## 常用例子

执行包模板：

```markdown
## 数据库执行包

- 环境：<dev/test/prod>
- target：<master/read-only 等>
- 目标：<结构变更/数据修复/回填>
- 影响表：<schema.table>
- 预期影响：<行数或对象>
- 执行前校验：
  - `<select ...>`
- 正向 SQL：
  - `<update/alter/insert ...>`
- 执行后校验：
  - `<select ...>`
- 回滚口径：
  - `<rollback sql 或人工步骤>`
- 风险：
  - <锁、耗时、不可逆、外部依赖>
```

幂等回填示例：

```sql
update biz_item
set status = 'enabled'
where status is null
  and deleted = 0;
```

执行前后校验示例：

```sql
select count(*) from biz_item where status is null and deleted = 0;
select status, count(*) from biz_item group by status;
```

## 写入执行规则

- 真实写入前先跑只读校验，确认目标环境、目标表、候选行数和关键字段样例。
- `UPDATE` 必须有业务键、主键、时间范围或状态条件；`DELETE` 除了有明确边界外，还必须在执行前单独询问用户确认。
- `INSERT` 必须说明唯一键、幂等条件和重复执行结果。
- `ALTER`、`CREATE` 必须说明调用方影响、锁风险、索引构建影响和回滚口径。
- 高风险写入先输出执行包；删除类操作必须等待用户单独确认，其他非删除操作可直接执行。
- 执行后必须运行校验 SQL，并把影响行数、审计文件位置和剩余风险写入最终回复或交付清单。

## PostgreSQL 与空间字段约束

- JSON/JSONB、UUID、数组、几何字段优先复用项目已有 TypeHandler 和工具类。
- WKT、经纬度、SRID 和空间函数的语义必须写清，避免经纬度顺序互换。
- 大字段或几何字段不要在列表接口无差别查询；参考已有 no-wkt 查询模式。
- 索引建议说明适用查询条件，不为一次性小数据补重索引。
- 生产数据修复默认先只读查询；执行包完整后可直接执行非删除写操作，删除类操作必须单独确认。

## 禁止项

- 不写无 where 的更新或删除。
- 不把生产账号、密码、连接串写入仓库。
- 不在未确认环境时生成会直接改生产数据的脚本。
- 不用字符串拼接承载未校验的外部 SQL 条件。
- 不把无法回滚的数据变更包装成普通代码改动。
- 不在缺少执行包、回滚口径或目标环境确认时执行写 SQL；删除类 SQL 必须有用户针对删除动作的单独确认。
- 不用数据库脚本绕过发布、远程运维或生产授权流程。
- 不把查询结果中的敏感数据贴入长期文档；只记录必要摘要和证据入口。

## 验证

- 至少提供执行前查询、执行命令或脚本入口、执行后校验。
- Mapper 变更优先跑受影响模块编译和相关测试。
- 高风险 SQL 说明事务、锁、数据量、耗时、回滚和人工确认点。
- 脚本变更需运行 `node --check` 和脚本自测；真实环境连通性只在本地配置齐备且授权时执行。
