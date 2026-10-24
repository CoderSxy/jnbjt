# 部署产物说明

首版尚未切换线上静态站。准备步骤：

1. `npm run build` 产出 `apps/web/dist` 与可运行 API（tsx/Node 22）。
2. 上传至 `/opt/jnbjt/releases/<release>/`，配置 `/etc/jnbjt/jnbjt.env`（勿提交）。
3. `npm run db:migrate` 只跑未登记迁移。
4. systemd 绑定 `127.0.0.1:3100`；Nginx 反代 `/api/`，静态根指向 web dist。
5. 验收 `health`/`ready`、未登录私人 API 401、现有 agent 站点不受影响。

示例 unit / nginx 片段见同目录（占位，上线前按实机改路径）。
