# 外部 Wiki 快照数据包（wiki-snapshot bundle）

本仓库的知识导入 CLI（`npm run import:bundle`）支持两种输入：

1. **遗留单页夹具**：`--fixture` 指向 `pages/<名称>` 或 `pages/<名称>.html`（需同目录有 `.meta.json`）。
2. **外部采集数据包（推荐）**：`--bundle` 指向一个目录，供本机 `wiki:probe`、另一 bot 或离线采集脚本产出。

数据包进入同一解析与发布管线：`parseBuilding` → `buildKnowledgeBundle` → `importKnowledgeBundle`（默认 **staged**，加 `--publish` 才切换激活知识版本）。生产配方仍为 `draft`，需人工审核，见 `docs/acceptance.md`。

## 目录布局

```text
my-wiki-bundle/
  manifest.json          # 必填：包级元数据与页面清单
  robots.txt             # 强烈建议：采集当时的 robots 快照，用于复验 sourceUrl
  pages/
    农田.html            # MediaWiki parse 或允许来源的 HTML 快照
    农田.meta.json       # 页面元数据（见下）
    餐馆.html
    餐馆.meta.json
```

### `manifest.json`

| 字段 | 说明 |
| --- | --- |
| `formatVersion` | 固定 `"1"` |
| `bundleKind` | 固定 `"wiki-snapshot"` |
| `producedAt` | ISO 8601，采集/打包时间 |
| `producer` | 产出方标识，如 `jnbjt-wiki-probe`、`my-collector-bot/0.2` |
| `origin` | 允许的来源站，如 `https://wiki.biligame.com` |
| `wikiPath` | Wiki 根路径，如 `/jiangnan` |
| `license` | 资料许可说明，如 `CC BY-NC-SA 3.0` |
| `pages` | 数组：`{ "title": "农田", "baseName": "农田" }`；`baseName` 可省略，默认等于 `title` |

示例见仓库内 `tests/fixtures/wiki/bundles/sample/manifest.json`。

### `pages/<baseName>.meta.json`

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `title` | 是 | 与 manifest 中 `title` 一致（不一致时 CLI 会警告） |
| `sourceUrl` | 是 | 实际抓取 URL；须在 `origin` + `wikiPath` allowlist 内 |
| `fetchedAt` | 是 | ISO 8601 |
| `revision` | 否 | MediaWiki revision id |
| `robotsAllowed` | 否 | 若为 `false`，导入拒绝 |
| `pageId` / `notes` | 否 | 追溯用，不参与解析 |

`snapshotId` 由导入器按 `snap_<title>` 生成，与 `--fixture` 行为一致。

### 边界与约束

- 不做游戏登录、私有游戏 API 或 token 抓取；只导入 **允许访问的 Wiki 快照** 与确定性解析结果（见 `docs/design.md`）。
- 缺少 `robots.txt` 时仍校验来源域/路径，但 **不会** 复验 robots 规则（CLI 的 `validation.warnings` 会提示）。
- 解析未知字段保持 `null` / `unknown`，不得填 0。

## 命令

```bash
# 仅校验 + 暂存（不切换激活版本）
npm run import:bundle -- --bundle path/to/my-wiki-bundle

# 校验通过后发布知识版本（配方仍为 draft）
npm run import:bundle -- --bundle path/to/my-wiki-bundle --publish

# 与旧用法等价：多页 --fixture
npm run import:bundle -- --fixture tests/fixtures/wiki/pages/农田 --fixture tests/fixtures/wiki/pages/餐馆
```

需要 `DATABASE_URL`（可先 `npm run db:migrate`）。stdout 为 JSON，包含：

- `bundle`：`bundleId`、`contentHash`、草稿数量
- `validation`（使用 `--bundle` 时）：每包的 `errors` / `warnings` / `summary`（页数、建筑数、配方数、unknown 字段计数）
- `import`：`ImportReport`（`staged` | `published` | `rejected`）

## 仓库内可复现样例

```bash
npm run import:bundle -- --bundle tests/fixtures/wiki/bundles/sample
npm test -- tests/wiki-snapshot-bundle.test.ts tests/knowledge-import.test.ts
```

## 后续批次（本 PR 不包含）

- 采集 bot 自动写 manifest 的 CLI（`wiki-sync`）
- 管理端 Wiki 包上传与 Web 审核 UI
- 与激活版本的结构化 diff 报告、配方批量审核工作流
