# jnbjt-planner

江南百景图个人规划工具。设计：`docs/design.md`；计划：`docs/implementation-plan.md`。

## 本地启动

```bash
cp .env.example .env
npm install
npm run db:migrate
npm run import:bundle -- --bundle tests/fixtures/wiki/bundles/sample --publish
# 或单页夹具：npm run import:bundle -- --fixture tests/fixtures/wiki/pages/农田 --publish
npm run create-user -- <user> <password> admin
npm test
npm run typecheck
npm run build -w @jnbjt/web
npm run dev:api
npm run dev:web
```

可选模型：`MODEL_BASE_URL` / `MODEL_API_KEY` / `MODEL_ID`（不配置时资料/计算/存档仍可用）。

## 验证与当前范围

```bash
npm test
npm run build
npm run test:e2e
```

`test:e2e` 使用 Playwright；本机 macOS 已安装 Chrome 时会直接使用。其他环境先执行 `npx playwright install chromium`，也可设置 `PLAYWRIGHT_CHANNEL=chrome`。

地图按城市加载并保留版本冲突保护。生产计算只使用有来源、已人工审核的配方；导入知识版本不会自动审核配方。助手计算需明确目标总库存和上线次数，例如“粮食到10000，每天上线4次”。

截图通过异步任务生成待确认草稿；未配置模型时明确提示手动校正。更新后需执行 `npm run db:migrate`（新增迁移 006）。

本地回归、已实现功能和未完成的实时/生产验收见 [验收记录](docs/acceptance.md)。
