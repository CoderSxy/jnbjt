# 验收记录（首版）

日期：2026-10-24

## 已通过（本地）

- [x] 任务 1：Wiki 探针单测 + `--limit 20` 覆盖报告（见 `docs/data-coverage.md`）；567 限流已记录，未扩范围
- [x] 任务 2：解析/导入/检索单测；`jnbjt` / `jnbjt_test` 隔离；`npm run typecheck`（tsc -b）、`npm run build -w @jnbjt/web`
- [x] 任务 3：鉴权隔离、409 版本冲突、生产计算单测；管理员可用 `npm run create-user`
- [x] `GET /api/v1/health`、`GET /api/v1/ready` 已实现

## 未执行 / 未标完成

- [ ] 生产 ECS 安装、Nginx 切换、公网 HTTPS 验收
- [ ] 数据库/图片备份恢复演练
- [ ] 任务 4–7（jobs、地图、AI、截图）
- [ ] Playwright e2e smoke（待补）

## 已知限制

- Wiki 真实 HTML 二次抓取遇 HTTP 567；解析夹具为结构忠实样本，待站点恢复后替换
- 生产计算首版使用显式配方规则；页面演示含 synthetic 样例，需人工核验后才可当真实规则
- 复杂地图编辑、AI、截图导入未交付
