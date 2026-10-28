# 运维说明（首版 P0–P2）

## 本地 / 共享 Postgres

- 复用 `nero-agent-postgres`（`127.0.0.1:5433`），**独立库** `jnbjt`、角色 `jnbjt`。
- 测试库：`jnbjt_test`（`TEST_DATABASE_URL`）。
- 连接池上限：`DATABASE_POOL_MAX=3`。

```bash
cp .env.example .env
npm install
npm run db:migrate
npm run import:bundle -- --fixture tests/fixtures/wiki/pages/农田 --fixture tests/fixtures/wiki/pages/餐馆 --publish
npm run create-user -- <user> <password> admin
npm run dev:api    # 127.0.0.1:3100
npm run dev:web    # 5173，代理 /api
```

## 健康检查

- `GET /api/v1/health` → 进程存活
- `GET /api/v1/ready` → 数据库可达，否则非 200

## 部署注意（尚未执行生产切换）

- 后端建议 `127.0.0.1:3100`，部署前检查端口占用。
- 不覆盖 nero-agent 库表；Nginx 仅增加 `/api/` 反代与静态根切换。
- Cookie 省略 Domain；生产设 `COOKIE_SECURE=true`。
- 本地已实现长任务/AI/截图链路；生产尚未部署。更新先运行迁移（含 006），长任务全局并发 1、每用户活动任务上限 10。
- 截图解码使用 sharp，生产安装需要匹配服务器平台的原生依赖；Linux/amd64 发布包仍需实际验收。
- 生产计算仅允许 active 且人工审核（reviewed/published）、具有来源快照且数值完整的配方；审核 CLI/API 见 [production-recipe-review.md](production-recipe-review.md)。
