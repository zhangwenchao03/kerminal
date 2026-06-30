---
name: bwy-updeng-workflow
description: |
  必载技能。用于 updeng coding 全流程总控，负责任务分类、流程深度、技能编排、上下文分层、验证门禁、文档收口、worker 使用边界和自进化信号判断；不替代 Java、前端、数据库、运维、评审等专项技能。
---

# Updeng 工作流总控

## 使用边界

- 每次开发、修改、排查、评审、重构、文档、技能维护或多模型协作任务都先使用本技能。
- 本技能只负责“怎么组织这轮工作”：任务分类、技能组合、流程深度、证据要求和收口标准。
- 具体实现细节交给专项技能，例如 `bwy-development-governance`、`bwy-requirement-discovery`、`bwy-domain-context`、`bwy-diagnose`、`bwy-tdd-development`、`bwy-prototype`、`bwy-architecture-deepening`、`bwy-issue-planning`、`bwy-java-backend-development`、`bwy-frontend-development`、`bwy-database-change-management`、`bwy-remote-ops-safety`、`bwy-code-review` 和 `bwy-skill-evolution`。

## 总原则

1. 先分类，再行动；不要直接跳到搜索、编码或命令执行。
2. 先加载最小必要技能组合；不要把所有 skill 都读进上下文。
3. 按风险决定流程深度；小事轻流程，大事完整证据链。
4. 所有完成声明必须有验证证据、跳过原因或人工检查口径。
5. 长任务把状态写进文件，不依赖对话记忆；每轮都从项目真相源和任务台账恢复现场。
6. 关键风险必须进入工具层门禁，例如 hook、git guard、CI 或审批记录；提示词只做解释，不承担拦截职责。
7. 长循环必须有轮数、token 或成本上限；超过上限先汇报，不继续消耗。
8. 自进化默认先产出候选，再由 AI 整理受限修改边界；用户确认后才能改正式 skill 或 hook，且必须验证、可审查、可回滚。
9. 生产代码改动默认先做质量边界识别：若包含决策逻辑、UI 状态派生、副作用编排、外部 API、异步流程或高频路径，必须在实现前考虑纯模型、policy、facade 或 adapter，并用聚焦测试锁定行为；禁止为了套设计模式扩大范围。

## 默认智能模式

- 用户不需要每轮说明“按 Updeng”。只要目标项目已经初始化，本技能就是默认入口。
- 用户可以用 `/skills <需求>`、`/updeng <需求>` 或直接描述需求触发同一套路由；命令前缀只表示“显式走技能路由”，不改变需求本身。
- 需求足够明确且风险低时，不要为了流程向用户追问；记录必要假设后直接实现、验证并收口。
- 简单任务走 `direct`：不创建 plan 或 audit package、不登记 in-progress；只在行为、接口、启动方式、业务规则或长期约定变化时更新对应文档。
- 普通功能、跨文件修改、缺陷修复、技能维护和需要持续上下文的任务走 `plan`，以 `.updeng/docs/plan/INDEX.md` 和 `plan/active/*.md` 为默认台账。
- 并行、长任务、共享文件、脏工作区或 worker-assisted 任务叠加 `lane`，必须登记 `.updeng/docs/coordination/lanes.json` 并读取/刷新 `coordination/status.md`。
- 数据库、权限、安全、生产、发布、公共契约、迁移、强审计或长期多人协作任务仍以 plan 为执行入口，但要叠加 `audit package`，使用 `.updeng/docs/changes/<change-id>/` 的完整证据包。
- 用户明确要求“只讨论、先别改、给方案、不要动文件”时，只做分析和建议，不自动进入实现。

## 自主轮次协议

用于 plan、lane、audit package、evolution 和长 direct 任务；很小的 direct 任务可压缩执行，但不能降低验证和 git 边界。

1. **每轮回读真相源**：重新读取 `AGENTS.md`、`README.md`、`.updeng/docs/README.md`、`.updeng/docs/in-progress.md`、`.updeng/docs/BLOCKERS.md`、`.updeng/docs/plan/INDEX.md`、当前 `plan/active/*.md`、`coordination/status.md`、必要 checkpoint、audit package 下的 `proposal.md`、`specs/*/spec.md`、`design.md`、`tasks.md`、`verification.md|json`，再读取最近 diff；有 `.codegraph/` 时先用 CodeGraph。
2. **任务台账优先**：人工计划先读 `.updeng/docs/plan/INDEX.md`，再读 `plan/active/*.md`；audit package 使用 `.updeng/docs/changes/<change-id>/tasks.md` 作为审计台账。每条任务至少写清涉及文件、验证命令、验收标准和 commit_hint。
3. **一轮一个最小单元**：选择第一个依赖已满足的未勾选 `TASK-*`，只完成这一项；不要把多个独立功能塞进同一轮。
4. **验证先于提交**：实现后先跑任务列出的最窄有效验证；红了当场修绿。验证无法运行时记录原因、替代检查和残余风险，不进入“已完成”口径。
5. **运行态 UI 证据**：涉及页面、组件、样式、交互或桌面窗口时，先运行真实界面并截图；有原型、设计图或参考 HTML 时并排比对，关键视觉偏差视为验证失败。
6. **提交边界收窄**：提交前只 stage 本轮实际修改的具体文件，禁止 `git add -A`、宽泛 `git add .` 或混入未归因改动；audit package 用 `updeng task complete <change-id> <task-id> --sha <sha|HEAD>` 绑定证据，人工计划在 Round Log 记录 commit 或未提交原因。
7. **完成即写回**：任务完成后勾选 checkbox，并在 `tasks.md` 或人工计划 Round Log 追加实际修改文件、验证结果、截图/视觉检查证据、提交 SHA 或未提交原因、踩坑和后续待办；人工计划状态变化时同步移动文件并更新 `plan/INDEX.md`。
8. **模糊点按风险分流**：可逆、低风险的命名、目录、等价写法按合理默认继续，并记到 `.updeng/docs/BLOCKERS.md` 或任务台账；不可逆、合规、安全、架构级、生产、凭据缺失和外部授权问题必须停下询问或 `updeng block`。
9. **熔断和终点**：连续 3 轮没有实质进展，或同一任务连续 2 轮验证修不绿，停止并汇报阻塞；全部任务勾选、验证/评审/发布门禁通过后输出完成报告并停止。

## 生产代码质量前置门禁

用于开发、修改、重构、性能优化和缺陷修复。目标是在写代码时直接写出可维护实现，避免事后再靠大规模 code-quality lane 补救。

1. **边界先识别**：开工前判断本次改动是否包含业务决策、UI 状态派生、菜单/快捷键/按钮动作、异步副作用、外部 API、缓存、队列、文件/网络 IO 或高频路径。
2. **模型优先**：命中复杂决策或 UI 状态派生时，优先抽小型纯模型、view model、policy 或 command model；组件和运行时代码主要负责渲染、事件转发和副作用调用。
3. **副作用隔离**：命中外部 API、运行时环境、平台能力或异步流程时，优先用 facade、adapter 或可注入依赖隔离；测试覆盖成功、失败、空值、取消、重复触发和顺序边界。
4. **性能保守**：命中高频路径时，只优化可解释的瓶颈；必须证明语义不变，尤其是同步可见性、事件顺序、错误传播、资源释放和回调次数。不确定的性能候选先登记，不直接落地。
5. **模式服务边界**：可以使用 Strategy、Policy、Facade、Adapter、Presenter/View Model、Command Model 等模式，但只在它们降低耦合、提升测试性或隔离变化点时使用；不要为了模式名称重写稳定代码。
6. **共享文件克制**：共享热点文件只做最小兼容修改，不做宽泛格式化、重排或顺手重构；需要治理大文件时优先抽局部 model/parts/helper，并保留现有 public 契约。
7. **验证随切片走**：纯模型必须有聚焦单测；UI 只测桥接、可见性和关键交互；性能或队列改动必须补顺序、边界、批量和资源释放测试。每轮仍按任务风险运行相邻回归、typecheck、build 和真实启动验证。

## 并行 Lane 协议

用于多个 Codex 会话同时开发同一仓库。目标是允许并行，而不是把所有任务串行化。

1. **先登记 lane**：多个 active plan、长任务、共享路径、脏工作区、worker-assisted、evolution 或带 audit package 的任务开始实现前，必须在 `.updeng/docs/coordination/lanes.json` 登记 lane id、计划文件、thread/session、branch/worktree、owned paths、shared paths 和 sync protocol。
2. **默认隔离实现**：新并行任务默认使用独立 worktree/分支；只有历史脏工作区、用户明确要求或迁移成本过高时，才允许多个 lane 暂时共用一个工作区，并把例外写入 `lanes.json`。
3. **多个 active 合法**：人工计划不再假设最多一个 active。`plan/INDEX.md` 可以列多个 active lane，但每个 active 都必须在 `in-progress.md` 和 `coordination/lanes.json` 中可见。
4. **状态先刷新**：每轮开始并行开发前，读取 `.updeng/docs/coordination/status.md`；缺失或过旧时运行 `node .codex/hooks/lane-coordination.cjs refresh <project>` 生成最新视图。
5. **同文件不静默**：写入其他 active lane 的 `ownedPaths` 或任何 `sharedPaths` 前，先读对方计划、最新文件、当前 diff 和 `.updeng/docs/coordination/checkpoints/<lane-id>.json`，再做最小兼容改动；不要宽泛格式化共享文件。
6. **checkpoint 让别人看见**：每个 lane 完成一个可验证切片后，优先提交，或运行 `node .codex/hooks/lane-coordination.cjs checkpoint <lane-id> <project>` 生成 patch/snapshot，并在 Round Log 记录 touched paths、验证和 checkpoint 路径。其他 lane 继续前要同步这些 checkpoint。
7. **冲突策略**：低风险文本/注册追加用最小合并；迁移版本、公共 API、command registry、AppState、数据库 schema、全局 store 等共享热点文件需要在 lane log 记录“同步了哪个 lane 的哪个改动”。无法判断时停下汇报。
8. **hook 只提醒不替代判断**：PreToolUse hook 命中共享路径时注入 warning；它不会自动解决冲突，也不会替代 agent 读取代码、计划、status 和 checkpoint。

## 执行护栏模型

1. **策略由工具执行**：宽泛 staging、敏感文件提交、危险删除、强推主分支和生产写操作属于工具层门禁范围；普通远端 push 和常规发版不作为默认工具层拦截项。技能文本只说明意图，实际阻断交给 Codex PreToolUse hook、Git hook、CI 或 `updeng approve`。
2. **自主循环受预算约束**：自主执行前明确本轮最大轮数、同一任务修复次数、上下文 token 或成本预算。默认遵循“3 轮无实质进展 / 2 轮修不绿就停”；用户或计划给了更低预算时以更低者为准。
3. **外部副作用由人拥有**：普通远端 push 和常规发版可在用户意图明确、工作区状态清楚时执行；生成签名密钥、删除大量文件、迁移/清空数据、生产写操作、付费外部服务和影响外部状态的不可逆动作，由 AI 准备命令、影响范围、回滚和验证清单，等待人工授权或人工执行。

## 任务分类

| 任务类型 | 触发信号 | 应加载技能 |
| --- | --- | --- |
| 通用开发/修改 | 新增、修改、修复、重构、实现、联调 | `bwy-development-governance` |
| 模糊需求/头脑风暴 | 想做但不确定、brainstorm、头脑风暴、帮我想想、先讨论、先聊清楚、明确问题、方案候选 | `bwy-requirement-discovery`，再按结论路由到后续技能 |
| 需求/术语澄清 | 拷问、追问、澄清、统一语言、领域词汇、上下文、CONTEXT、业务术语冲突 | `bwy-domain-context`，必要时再接 `bwy-development-governance` 或 `bwy-tech-decision` |
| PRD/Issue 规划 | PRD、拆 issue、拆任务、AFK、HITL、ready for agent、垂直切片、agent brief | `bwy-issue-planning` + `bwy-domain-context` |
| 原型探索 | prototype、原型、试一下、让我玩一下、状态模型、UI 变体、技术 spike | `bwy-prototype` + 必要专项技能 |
| 架构深化 | 架构优化、技术债、难测试、耦合、模块太浅、deep module、重构方向 | `bwy-architecture-deepening` + `bwy-tech-decision` |
| 缺陷诊断 | 诊断、debug、排查、为什么失败、偶发、不稳定、性能变慢、复现不了 | `bwy-diagnose` + 必要专项技能 |
| 测试先行 | TDD、测试先行、红绿重构、先写测试、补回归、行为测试 | `bwy-tdd-development` + 必要专项技能 |
| Java 后端 | Java、Spring、Controller、Service、Mapper、Maven、接口 | `bwy-development-governance` + `bwy-java-backend-development` |
| bwy 脚手架 | CRUD、生成器、common、auth、system、job | Java 后端技能 + 对应 `bwy-java-scaffold-*` |
| 前端 | 页面、组件、表单、表格、路由、React、Vite、浏览器验证 | `bwy-development-governance` + `bwy-frontend-development` |
| 数据库/SQL | 表、字段、索引、Mapper SQL、数据修复、迁移、PostGIS | `bwy-development-governance` + `bwy-database-change-management` |
| Redis/缓存 | Redis、缓存、TTL、key、scan、队列 | `bwy-development-governance` + `bwy-redis-diagnostics` |
| 远程/生产 | 服务器、部署、Nginx、Docker、日志、systemctl、端口 | `bwy-development-governance` + `bwy-remote-ops-safety` |
| GIS | 空间数据、PostGIS、GeoServer、WMS、WFS、坐标系 | `bwy-development-governance` + `bwy-gis-development` |
| Dify 集成 | Dify、Chat、Workflow、Dataset、流式事件 | `bwy-development-governance` + `bwy-dify-integration` |
| 实现评审 | review、检查 diff、交付前审查、找问题 | `bwy-code-review` |
| 技能/流程维护 | skill、hooks、workflow、updeng、初始化工具、自进化 | `bwy-development-governance` + `bwy-project-skill-maintenance` + `bwy-skill-evolution`；新增或重写复杂 skill 时参考 `bwy-domain-context` 的触发边界和 `bwy-tdd-development` 的验证闭环 |
| 多模型协作 | Claude、Codex worker、多代理、第二意见 | 对应协作技能，leader 必须复核 |

## 流程深度

| 深度 | 适用场景 | 要求 |
| --- | --- | --- |
| `direct` | 只读回答、单文件小改、小文案、小配置、明确的小修复、无契约变化 | 不建 plan/audit package/in-progress；直接处理，完成时说明验证或不验证原因 |
| `plan` | 普通功能、跨文件修改、接口变更、缺陷修复、技能维护、需要持续上下文 | 登记 `.updeng/docs/plan/INDEX.md` 与状态目录；用 `plan/active/*.md` 作为默认任务台账 |
| `lane` | 多个 active、长任务、共享路径、脏工作区、worker-assisted | 登记 `.updeng/docs/coordination/lanes.json`，刷新 `status.md`，确保 changed paths 有归属 |
| `audit package` | 数据库写入、生产远程、认证权限、删除、迁移、公共契约、发布、强审计、长期多人协作 | 不是独立执行类型；在 plan 上叠加 `.updeng/docs/changes/<change-id>/` 完整证据包，必须有影响范围、回滚、验证、确认点和必要人工授权 |
| `worker-assisted` | 范围清晰、需要并行复核或外部模型第二意见 | leader 限定范围、worker 输出只作证据，最终由 leader 复核 |
| `evolution` | 反复出现的流程缺陷、skill 漏触发、用户纠正 | 先生成学习候选，再整理受限修改边界；用户确认后才能改正式 skill |

## 标准工作流

1. **Intake**：复述目标、非目标、约束、影响域和风险等级。
2. **Route**：列出必载技能和命中技能，说明每个技能的使用理由。
3. **Context**：每轮按 CodeGraph、AGENTS、README、`.updeng/docs`、当前 plan、coordination status、audit package artifact、领域上下文、ADR、最近似实现和当前 diff 的顺序加载上下文；没有 `.codegraph/` 时才使用 `rg` 和文件读取。
4. **Discover**：需求模糊、用户要求先讨论或需要候选方案时使用 `bwy-requirement-discovery`；清楚的小任务跳过。
5. **Clarify**：术语、业务边界或验收含糊时使用 `bwy-domain-context`；清楚的小任务跳过。
6. **Shape**：复杂需求用 `bwy-issue-planning` 拆 PRD/issue；设计未知时用 `bwy-prototype`；架构摩擦明显时用 `bwy-architecture-deepening`。
7. **Plan**：根据流程深度决定是否创建 plan、登记 lane 或叠加 audit package；`direct` 跳过正式计划；普通持续任务默认使用 `plan/INDEX.md` 和 `next|active|blocked|done` 状态目录。
8. **Build**：按任务台账选择第一个未完成 `TASK-*`，按专项 skill 约束实现；缺陷先用 `bwy-diagnose` 复现，复杂逻辑优先用 `bwy-tdd-development` 红绿推进。
9. **Verify**：运行最窄有效验证；无法运行时说明环境缺口和残余风险；验证失败先修复，达到熔断条件再停止汇报。
10. **Commit Evidence**：验证通过后只 stage 本轮具体文件，提交或记录未提交原因，并用 task-to-commit 证据绑定当前任务。
11. **Review**：非平凡变更使用 `bwy-code-review` 口径做交付前评审。
12. **Closeout**：更新任务台账 Round Log、业务文档和 blocker，清理 in-progress，人工计划移到 `plan/done/` 或删除并更新 `plan/INDEX.md`，最终说明改动、验证和风险。
13. **Learn**：如果出现可复用经验，按 `bwy-skill-evolution` 记录候选；需要落到 skill/hook 时，先让 AI 说明修改边界并等用户确认。

## 上下文分层

| 层级 | 内容 | 默认位置 |
| --- | --- | --- |
| 项目入口 | AGENTS、README、启动方式、项目变量 | `AGENTS.md`、`README.md` |
| 人工文档 | 计划、业务事实、决策、完成能力 | `.updeng/docs/`；人工计划入口是 `plan/INDEX.md` |
| 阻塞与假设 | 低风险默认选择、待用户确认点、不可逆阻塞 | `.updeng/docs/BLOCKERS.md` |
| 发现记录 | 模糊需求讨论结论、候选方案、未决问题、下一步 | `.updeng/docs/discovery/` |
| 领域上下文 | 共享语言、术语、业务边界、待确认语义 | `.updeng/docs/domain/` 或项目已有 CONTEXT |
| 流程证据 | 当前 workflow 状态、plan、lane、事件、评估、演化候选和严格审计提案 | `.updeng/docs/plan|coordination|changes|metrics|audit|context/` |
| 技能规则 | 实际项目可用技能 | `.codex/skills/` |
| 代码证据 | 最近似实现、调用链、测试、diff | 仓库代码与测试 |

## 完成门禁

- 没有验证证据，不说“已完成验证”。
- 当前轮没有回读真相源和任务台账，不开始长任务的下一步。
- 人工计划没有更新 `plan/INDEX.md`、状态目录和 frontmatter，不宣称计划状态已变更。
- 当前 plan 或 audit package 的 task 没有勾选、实际修改记录、验证结果和 commit/未提交原因，不标记任务完成。
- 宽泛 `git add -A/.`、敏感文件提交、危险删除、强推主分支和生产写操作没有工具层门禁，不开启自主循环。
- 没有轮数/token/成本上限的长循环，不进入无人值守执行。
- 用户要求先讨论或需求明显模糊时，没有发现结论和下一步，不直接开工。
- 诊断任务没有可重复反馈回路，不进入修复。
- TDD 任务没有失败测试或跳过理由，不直接写实现。
- 原型任务没有问题、运行方式和删除/吸收条件，不把原型当交付。
- UI 任务没有真实运行截图、原型/参考对照或明确的无法截图原因，不标记完成；关键视觉差异没有消除时不提交。
- PRD/issue 拆分没有验收标准和依赖关系，不标记为 ready for agent。
- 没有读过相关专项 skill，不擅自按通用经验实现。
- plan/lane/audit package 任务没有计划、影响范围、验证口径；高风险任务没有回滚和确认点，不进入编码或执行。
- 不可逆、合规、安全、架构级、生产或凭据类 blocker 没有确认，不继续执行。
- 签名密钥生成、批量删除、数据库迁移/清空、生产写操作和付费外部服务调用没有人工授权或人工手动执行，不继续；普通远端 push 和常规发版按用户明确意图、当前工作区状态和发布计划执行。
- 同一任务连续 2 轮验证不绿或连续 3 轮没有实质进展，必须停止汇报，不继续空转。
- worker 输出没有被 leader 复核，不作为最终结论。
- skill 自进化候选没有明确修改边界、用户确认和验证结果，不修改正式技能。

## 自进化信号

遇到以下情况时，记录或提示进入 `bwy-skill-evolution`：

- 用户纠正了流程、技能选择、验证方式或项目惯例。
- 用户说“说了很多遍”“反复”“又出现”“还是这样”“没有体验到”，说明同类反馈没有沉淀。
- 用户指出多个会话、并行任务、同文件修改、看不到对方改动、计划状态和实际不一致等工作流缺口。
- AI 自己触发工具失败、构建失败、验证失败，或 Stop/交付阶段缺验证、评审、发布证据。
- 同一类任务多次漏加载正确 skill。
- Stop/交付阶段多次发现缺计划、缺验证、缺文档收口。
- 代码评审反复指出同类缺陷。
- 某条 skill 规则存在误触发、漏触发或执行成本过高。
- hook 阻止了危险操作，说明现有 skill 需要补前置提醒。
