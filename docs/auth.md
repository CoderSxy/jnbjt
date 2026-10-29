# 规划工具账号与登录

本应用账号与**游戏账号无关**。统一使用 **HttpOnly Cookie + `sessions` 表** + `requireUser`，无第二套 JWT。

支持两种方式（可并存于同一 `users` 行）：

| 方式 | 注册 | 登录 |
| --- | --- | --- |
| **手机号 + 短信** | 验证码首次验证自动开户 | `POST /auth/sms/verify` |
| **用户名 + 密码** | `POST /auth/register` | `POST /auth/login` |

密码哈希与 `npm run create-user` 相同：**scrypt**（`scrypt$salt$hash`）。

## 用户名 + 密码

### 注册

`POST /api/v1/auth/register`

```json
{ "username": "my_planner", "password": "至少8位", "displayName": "可选昵称" }
```

- 用户名 3–32 位，`[a-zA-Z0-9_]`，不可用 `sms_` 前缀（保留给短信自动用户名）
- 密码 8–128 位，不得与用户名相同
- 成功 → 创建 `users` 行并 **直接下发 session Cookie**（与登录相同）

### 登录

`POST /api/v1/auth/login` — `{ "username", "password" }`

- 失败次数过多 → **429**（按用户名+IP 桶，默认 15 分钟内 10 次失败后锁定 15 分钟）
- 纯短信用户无 `password_hash` 时无法用此接口登录

### 已登录后设置密码

`POST /api/v1/auth/set-password` — `{ "password", "currentPassword?" }`

- 短信注册用户首次设置密码：**只需 `password`**
- 已有密码用户修改：**需 `currentPassword`**

### 绑定手机号

1. `POST /api/v1/auth/sms/send-code`（已登录 Cookie + CSRF）
2. `POST /api/v1/auth/bind-phone` — `{ "phone", "code" }`

仅当当前账号尚未绑定其他手机号；号码已被其他账号占用则 **409**。

## 手机号 + 短信

1. `POST /api/v1/auth/sms/send-code` — `{ "phone", "purpose": "login" }`
2. `POST /api/v1/auth/sms/verify` — `{ "phone", "code", "displayName?" }`

频率与验证码规则见下文「SMS 环境变量」。Mock 默认 `SMS_PROVIDER=mock`。

## 通用

- `GET /api/v1/auth/me` / `POST /api/v1/auth/logout`
- 写请求需 **CSRF Origin**（与现有 API 一致）
- 响应中手机号为脱敏展示

## 管理员 CLI

```bash
npm run create-user -- <username> <password> [admin]
```

与 Web 注册使用相同密码策略。

## 环境变量

```env
# SMS
SMS_PROVIDER=mock
SMS_MOCK_EXPOSE_CODE=true
SMS_CODE_TTL_SECONDS=300
SMS_SEND_COOLDOWN_SECONDS=60
SMS_MAX_SENDS_PER_HOUR=5

# 密码登录限速（009 迁移）
AUTH_LOGIN_WINDOW_MINUTES=15
AUTH_LOGIN_MAX_FAILURES=10
AUTH_LOGIN_LOCK_MINUTES=15

# 阿里云 SMS 桩（见 apps/api/src/modules/auth/sms/aliyun-stub.ts）
# SMS_PROVIDER=aliyun
# ALIYUN_SMS_ACCESS_KEY_ID= ...
```

## 数据表

- `008_sms_auth.sql` — `phone`、`display_name`、`status`、可空 `password_hash`、`sms_verification_codes`
- `009_auth_login_attempts.sql` — `auth_login_failures`

## 验证

```bash
npm run db:migrate
npm run typecheck
npm test -- tests/auth-sms.test.ts tests/auth-password.test.ts tests/auth-isolation.test.ts
```
