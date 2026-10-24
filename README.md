# jnbjt-planner

江南百景图个人规划工具。设计：`docs/design.md`；计划：`docs/implementation-plan.md`。

## 本地启动

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

可选模型：`MODEL_BASE_URL` / `MODEL_API_KEY` / `MODEL_ID`（不配置时资料/计算/存档仍可用）。

## 进度

- [x] 任务 1–3：探针、知识、登录存档、生产计算
- [x] 任务 4：长任务与模型适配
- [x] 任务 5：地图编辑与布局校验
- [x] 任务 6：带来源 AI 助手
- [x] 任务 7：截图草稿与局部布局建议
- [ ] 任务 8：生产 ECS/Nginx 切换（文档与 health 已具备）

详见 `docs/acceptance.md`。
