# 验收记录

日期：2026-10-24（更新：任务 4–7）

## 已通过（本地）

- [x] 任务 1–3：探针、知识库、登录存档、生产计算
- [x] 任务 4：jobs 并发 1 / 排队 10 / 幂等 / 租约恢复 / 取消不落盘；模型客户端有限重试；`embedding: false`
- [x] 任务 5：布局校验（旋转/边界/碰撞/不可建/道路/雕像 unknown）；保存 409；Konva 编辑器；`npm run test:e2e`（history 契约）
- [x] 任务 6：30 条问题离线 grounding 测试；伪造引用过滤；注入过滤；布局 unsupported；jobs 异步入口
- [x] 任务 7：上传校验/去重/越权；识别草稿确认前不改存档；`proposeLayout` 锁定/校验/超时/种子
- [x] `npm test`（37）、`tsc -b`、`npm run build -w @jnbjt/web`

## 未执行 / 未标完成

- [ ] 生产 ECS / Nginx 切换与公网验收
- [ ] 真实 20 张用户截图视觉评估报告（需自有截图 + 模型网关）
- [ ] 完整 Playwright 浏览器 smoke（当前 e2e 为编辑器 history 契约）
- [ ] 模型网关实时 30 题评估报告（需配置 `MODEL_*`）

## 已知限制

- Wiki 夹具仍为结构忠实样本；567 限流后未替换 live HTML
- 布局建议为局部启发式，不宣称全局最优
- 截图识别在无视觉模型时字段保持 unknown/needs_review
