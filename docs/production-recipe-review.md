# 应天府生产配方人工审核

生产计算**只使用**同时满足以下条件的配方：

- 所属 **active 且已发布** 的知识版本；
- `confirmation` 为 **`reviewed` 或 `published`**（Wiki 导入默认为 `draft`）；
- 绑定 **来源快照**（`snapshot_id`）；
- 耗时、工人、投入/产出均为**已确认正整数**（条件表达式、未知值不能精确计算）。

助手工作流（检索→计算→草稿→确认）在后续批次实现；本阶段仅提供审核与计算通路。

## 1. 导入 Wiki（仍为 draft）

```bash
npm run db:migrate
npm run import:bundle -- --fixture tests/fixtures/wiki/pages/农田 --fixture tests/fixtures/wiki/pages/餐馆 --publish
```

`--publish` 只激活**知识版本**，不会把配方标为已审核。

## 2. 查看待审核（应天府）

```bash
npm run review:recipes -- --city 应天府 --list
```

输出 JSON 中每条 draft 含 `exactCalculationReady` 与 `unknownReasons`，便于决定能否精确计算。

## 3. 批量审核

仓库提供已核对样例清单（3 条可精确计算的应天府配方，对应 Wiki 夹具规模）：

```bash
npm run review:recipes -- --manifest tests/fixtures/production/yingtian-review-manifest.json
```

也可按 ID 单条确认：

```bash
npm run review:recipes -- --confirm reviewed --id <recipe-uuid>
```

默认 **跳过** 数值未完整的配方；若仅标记状态、接受无法精确计算，加 `--allow-incomplete`（不会出现在生产页下拉列表）。

## 4. 管理员 API（可选）

需 **admin** 账号（`npm run create-user -- admin pass admin`）并登录 Cookie + CSRF：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/v1/admin/recipes/pending?city=应天府` | 列出 draft |
| POST | `/api/v1/admin/recipes/review` | body 同 manifest（`city`、`confirmation`、`recipes[]`） |

## 5. 验证计算只用已审核数据

```bash
npm test -- tests/production-recipe-review.test.ts tests/production-saved.test.ts
```

浏览器：登录 → 应天府 → 生产页；审核前应无配方可选；执行 manifest 审核后应出现「农田 · 应天府 · 普通」等项并可算出轮次。

## 本批未做

- 配方审核 Web UI、审核历史表字段
- 助手自动审核或批量 diff 报告
- 第三批助手端到端工作流
