# jnbjt-planner

江南百景图个人规划工具（资料查询、城市存档、生产计算等）。设计见 `docs/design.md`，实现计划见 `docs/implementation-plan.md`。

## 本地要求

- Node.js ≥ 22.13
- 与 nero-agent 共用本机 Docker Postgres（`nero-agent-postgres`，`127.0.0.1:5433`），使用**独立库** `jnbjt` / 角色 `jnbjt`（勿写入 `nero_agent` 表）

```bash
cp .env.example .env   # 填入 DATABASE_URL
npm install
npm test -- tests/wiki-policy.test.ts tests/wiki-probe.test.ts
npm run wiki:probe -- --limit 20   # 只读采样；原始快照默认不提交
```

## 当前进度

- [x] 任务 1：Wiki 采集探针与覆盖报告（`docs/data-coverage.md`）
- [ ] 任务 2–3：知识导入、登录存档、生产计算（首版）
