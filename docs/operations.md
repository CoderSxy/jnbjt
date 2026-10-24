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
- 长任务并发与 AI 模块尚未上线（任务 4+）。
