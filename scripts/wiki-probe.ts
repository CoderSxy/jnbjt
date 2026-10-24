#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { probeWiki, type ProbeConfig, type ProbeSeed } from '@jnbjt/knowledge-import';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_ORIGIN = 'https://wiki.biligame.com';
const DEFAULT_WIKI_PATH = '/jiangnan';

/** Curated seeds only — do not expand beyond audited titles to chase coverage. */
const SEEDS: ProbeSeed[] = [
  { title: '首页', kind: 'home' },
  { title: '生产', kind: 'category' },
  { title: '应天府', kind: 'city' },
  { title: '农田', kind: 'building' },
  { title: '餐馆', kind: 'building' },
  { title: '织布坊', kind: 'building' },
  { title: '伐木场', kind: 'building' },
  { title: '采石场', kind: 'building' },
  { title: '铁匠铺', kind: 'building' },
  { title: '酒楼', kind: 'building' },
  { title: '客栈', kind: 'building' },
  { title: '绸缎庄', kind: 'building' },
  { title: '当铺', kind: 'building' },
  { title: '钱庄', kind: 'building' },
  { title: '学塾', kind: 'building' },
  { title: '医馆', kind: 'building' },
  { title: '寺庙', kind: 'building' },
  { title: '道观', kind: 'building' },
  { title: '园林', kind: 'building' },
  { title: '城门', kind: 'building' },
];

function parseArgs(argv: string[]): { limit: number; outDir: string } {
  let limit = 20;
  let outDir = join(ROOT, 'data', 'wiki-snapshots', 'probe');
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--limit' && argv[i + 1]) {
      limit = Number(argv[++i]);
    } else if (arg === '--out' && argv[i + 1]) {
      outDir = resolve(argv[++i]!);
    }
  }
  if (!Number.isFinite(limit) || limit < 1 || limit > 100) {
    throw new Error('--limit must be an integer between 1 and 100');
  }
  return { limit, outDir };
}

async function main(): Promise<void> {
  const { limit, outDir } = parseArgs(process.argv.slice(2));
  const contact =
    process.env.WIKI_CONTACT?.trim() ||
    'local-personal-use; set WIKI_CONTACT for a real contact address';

  const config: ProbeConfig = {
    origin: DEFAULT_ORIGIN,
    wikiPath: DEFAULT_WIKI_PATH,
    seeds: SEEDS.slice(0, limit),
    limit,
    userAgent: `jnbjt-planner-probe/0.1 (+${contact}; read-only sample; concurrency 1)`,
    minIntervalMs: 3_000,
    jitterMs: 500,
    timeoutMs: 20_000,
    maxRetries: 3,
  };

  console.error(`Probing ${config.origin}${config.wikiPath} (limit=${limit})…`);
  const report = await probeWiki(config);
  await mkdir(outDir, { recursive: true });
  const stamp = report.generatedAt.replace(/[:.]/g, '-');
  const reportPath = join(outDir, `probe-report-${stamp}.json`);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const coveragePath = join(ROOT, 'docs', 'data-coverage.md');
  await writeFile(coveragePath, renderCoverageMarkdown(report, reportPath), 'utf8');

  console.error(`Wrote ${reportPath}`);
  console.error(`Wrote ${coveragePath}`);
  console.error(
    `requests=${report.requestCount} samples=${report.samples.length} gaps=${report.gaps.length}`,
  );
  console.log(JSON.stringify({ reportPath, coveragePath, gaps: report.gaps.length }, null, 2));
}

function renderCoverageMarkdown(
  report: Awaited<ReturnType<typeof probeWiki>>,
  reportPath: string,
): string {
  const lines: string[] = [
    '# Wiki 资料覆盖报告（探针）',
    '',
    `生成时间：${report.generatedAt}`,
    '',
    '## 来源与许可',
    '',
    `- Origin：\`${report.origin}\``,
    `- Wiki path：\`${report.wikiPath}\``,
    `- robots：${report.robotsSummary}`,
    ...report.licenseNotes.map((n) => `- ${n}`),
    '',
    '## API 能力',
    '',
    `- siteinfo：${report.apiCapabilities.siteinfo ? '是' : '否'}`,
    `- parse：${report.apiCapabilities.parse ? '是' : '否'}`,
    `- MediaWiki：${report.apiCapabilities.mediaWikiVersion ?? '未知'}`,
    ...(report.apiCapabilities.errors.length
      ? report.apiCapabilities.errors.map((e) => `- 错误：${e}`)
      : ['- 错误：无']),
    '',
    '## 样本页',
    '',
    '| 标题 | 类型 | 允许 | revision | 表格 | 城市线索 | 缺失字段 |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ];

  for (const sample of report.samples) {
    lines.push(
      `| ${sample.title} | ${sample.kind} | ${sample.allowed ? '是' : '否'} | ${sample.revision ?? '-'} | ${sample.hasTables ? '是' : '否'} | ${sample.applicableCities.join('、') || '-'} | ${sample.missingFields.join(', ') || (sample.rejectReason ?? '-')} |`,
    );
  }

  lines.push('', '## 缺口与拒绝', '');
  if (report.gaps.length === 0) {
    lines.push('- （本次探针未记录缺口）');
  } else {
    for (const gap of report.gaps) lines.push(`- ${gap}`);
  }

  lines.push(
    '',
    '## 原始报告',
    '',
    `- JSON 报告（默认不提交 Git）：\`${reportPath}\``,
    `- 请求次数：${report.requestCount}`,
    '',
    '## 说明',
    '',
    '- 本报告只读采样，未扩大抓取范围。',
    '- 页面抓取成功 ≠ 解析正确；任务 2 需用真实快照验证导航/图片单位/合并单元格。',
    '- 缺失数值不得填 0；未确认字段不进入精确计算。',
    '',
  );
  return lines.join('\n');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
