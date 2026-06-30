---
id: PLAN-YYYYMMDD-HHMMSS-short-slug
status: next
flow: plan
lane:
formal_change:
created_at: YYYY-MM-DDTHH:MM:SS+/-HH:MM
started_at:
completed_at:
updated_at: YYYY-MM-DDTHH:MM:SS+/-HH:MM
owner: ai
---

# <任务名称>

## 目标
- <要实现的用户可见结果>

## 非目标
- <本次明确不做的内容>

## 影响范围
- <模块、接口、表、页面、配置>

## 文件归属
- lane: <无并行时留空；并行/长任务填写 coordination lane id>
- owned paths:
  - <本计划主要负责的文件或目录>
- shared paths:
  - <可能与其他 lane 共同修改的热点文件>
- unclaimed policy: <发现未归属脏文件时如何处理>

## 执行步骤
- [ ] TASK-001 <步骤标题>
  - files: <预计涉及文件>
  - acceptance: <验收标准>
  - verify: <验证命令或人工检查>
  - commit_hint: <建议提交边界>

## 验证
- <命令或人工验证步骤>

## 风险
- <数据、权限、发布、调用方影响>

## Evidence
- verification: <验证记录路径或命令输出摘要>
- review: <评审记录路径；无则说明原因>
- screenshots: <UI/桌面任务截图路径；无则说明原因>
- commits: <commit SHA；未提交则说明原因>
- formal change: <升级到 changes/<id> 时填写链接>

## Round Log
- <YYYY-MM-DD HH:MM> <实际改了什么、验证结果、踩坑、后续事项>
