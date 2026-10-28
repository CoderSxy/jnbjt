# 手机号 + 短信验证码登录

本应用的账号体系与**游戏账号无关**，仅用于规划工具私有存档、助手等功能。沿用现有 **HttpOnly Cookie + `sessions` 表** 会话，不引入第二套 JWT。

## 流程

1. `POST /api/v1/auth/sms/send-code` — body: `{ "phone": "13800138000", "purpose": "login" }`
   - 手机号规范化为 E.164（中国大陆 `+86` + 11 位）
   - 频率限制：同号冷却（默认 60s）、每小时上限（默认 5 次）
   - 验证码 SHA-256 存储（含 `SESSION_SECRET` 作 pepper），默认 **5 分钟**有效，最多 **5 次**校验尝试
2. `POST /api/v1/auth/sms/verify` — body: `{ "phone", "code", "displayName?" }`
   - 验证通过 → **自动注册或登录** → 下发与密码登录相同的 session Cookie
3. `GET /api/v1/auth/me` / `POST /api/v1/auth/logout` — 行为不变

管理员/脚本开户仍可用 `npm run create-user -- <user> <pass> [admin]`（密码登录 Tab）。

## 本地 / 测试（Mock SMS）

```env
SMS_PROVIDER=mock
SMS_MOCK_EXPOSE_CODE=true   # 可选；NODE_ENV=test 时 send-code 响应含 debugCode
SMS_CODE_TTL_SECONDS=300
```

Mock 实现：`apps/api/src/modules/auth/sms/mock.ts`，验证码会打到 stderr（`[mock-sms]`）。

## 切换阿里云（后续由 Nero 配置）

```env
SMS_PROVIDER=aliyun
ALIYUN_SMS_ACCESS_KEY_ID=
ALIYUN_SMS_ACCESS_KEY_SECRET=
ALIYUN_SMS_SIGN_NAME=
ALIYUN_SMS_TEMPLATE_CODE=
ALIYUN_SMS_REGION=cn-hangzhou
```

桩实现：`apps/api/src/modules/auth/sms/aliyun-stub.ts` — 校验 env 后 **`sendVerificationCode` 仍抛出 `SmsNotConfiguredError`**，并注明接入 `@alicloud/dysmsapi20170525` 的位置；**本仓库不调用真实阿里云 API**。

## 数据模型（迁移 `008_sms_auth.sql`）

| 字段 | 说明 |
| --- | --- |
| `users.phone` | 唯一，E.164 |
| `users.display_name` | 可选昵称 |
| `users.status` | `active` / `disabled` |
| `users.password_hash` | 可空（纯短信用户） |
| `sms_verification_codes` | 哈希验证码、过期、尝试次数 |

## 安全说明

- 写请求仍需 CSRF Origin 校验（与现有 API 一致）
- 响应中的手机号为脱敏展示（`+86138****8000`）
- 停用账号无法发码/登录

## 验证

```bash
npm run db:migrate
npm test -- tests/auth-sms.test.ts tests/auth-isolation.test.ts
npm run typecheck
```
