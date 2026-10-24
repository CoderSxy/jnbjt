# jnbjt-planner

江南百景图个人规划工具。设计：`docs/design.md`；计划：`docs/implementation-plan.md`。

## 本地要求

- Node.js ≥ 22.13
- 与 nero-agent 共用 Docker Postgres（`127.0.0.1:5433`），独立库 `jnbjt`

```bash
cp .env.example .env
npm install
npm run db:migrate
npm run import:bundle -- --fixture tests/fixtures/wiki/pages/农田 --fixture tests/fixtures/wiki/pages/餐馆 --publish
npm run create-user -- <user> <password> admin
npm test
npm run typecheck
npm run build -w @jnbjt/web
npm run dev:api
npm run dev:web
```

## 首版进度（P0–P2）

- [x] 任务 1：Wiki 探针与覆盖报告
- [x] 任务 2：知识导入与资料检索 UI
- [x] 任务 3：登录、城市存档、生产计算
- [x] 任务 8：适用部分（health/ready、运维/验收文档、deploy 占位）
- [ ] 任务 4–7：长任务 / 地图 / AI / 截图

运维与验收：`docs/operations.md`、`docs/acceptance.md`。
