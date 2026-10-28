import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  buildKnowledgeBundle,
  importKnowledgeBundle,
  parseBuilding,
} from '@jnbjt/knowledge-import';
import { answerQuestion } from '../apps/api/src/modules/ai/assistant.js';
import { filterCitations } from '../apps/api/src/modules/ai/citations.js';
import { resetKnowledgeTables, testDatabaseUrl, withTestPool } from './helpers/db.js';

const root = dirname(fileURLToPath(import.meta.url));
const questions = JSON.parse(
  readFileSync(join(root, 'fixtures/assistant/questions.json'), 'utf8'),
) as Array<{ id: number; q: string; tag: string }>;

beforeAll(() => {
  execFileSync(process.execPath, ['--import', 'tsx', 'scripts/migrate.ts'], {
    env: { ...process.env, DATABASE_URL: testDatabaseUrl() },
    stdio: 'pipe',
  });
});

describe('assistant grounding', () => {
  it('grounds answers with real citations and production results across 30 questions', async () => {
    await withTestPool(async (pool) => {
      await resetKnowledgeTables(pool);
      const pages = join(root, 'fixtures/wiki/pages');
      const drafts = [];
      const htmlBySnapshotId: Record<string, string> = {};
      for (const title of ['农田', '餐馆']) {
        const html = readFileSync(join(pages, `${title}.html`), 'utf8');
        const meta = JSON.parse(readFileSync(join(pages, `${title}.meta.json`), 'utf8')) as {
          title: string;
          revision: number;
          sourceUrl: string;
          fetchedAt: string;
        };
        const snap = {
          snapshotId: `snap_${title}`,
          title: meta.title,
          sourceUrl: meta.sourceUrl,
          revision: meta.revision,
          html,
          fetchedAt: meta.fetchedAt,
        };
        htmlBySnapshotId[snap.snapshotId] = html;
        drafts.push(parseBuilding(snap));
      }
      await importKnowledgeBundle(pool, buildKnowledgeBundle(drafts), {
        publish: true,
        htmlBySnapshotId,
      });

      let citationOk = 0;
      let refusedForge = 0;
      for (const item of questions) {
        const answer = await answerQuestion(
          { question: item.q },
          {
            pool,
            userId: 'user-test',
            modelAnswer: async () => ({
              text: item.tag === 'forged_citation' ? 'see snap_fake' : '基于资料的简要说明',
              citationIds:
                item.tag === 'forged_citation' ? ['snap_fake_001'] : ['snap_农田', 'snap_餐馆'],
            }),
          },
          new AbortController().signal,
        );

        expect(answer.citations.every((c) => c.snapshotId.startsWith('snap_'))).toBe(true);
        expect(answer.citations.some((c) => c.snapshotId === 'snap_fake_001')).toBe(false);
        if (item.tag === 'forged_citation') refusedForge += 1;
        if (answer.citations.length > 0) citationOk += 1;
        if (item.tag === 'calc') {
          expect(answer.calculations).toEqual([]);
          expect(answer.missing.length).toBeGreaterThan(0);
        }
        if (item.tag === 'unsupported_layout') {
          expect(answer.unsupported.length).toBeGreaterThan(0);
        }
        if (item.tag === 'injection') {
          expect(answer.suggestions.join(' ')).not.toMatch(/删除数据库/);
        }
        if (item.tag === 'diff_only') {
          expect(answer.suggestions.join(' ')).toMatch(/不直接写回|差异|建议/);
        }
      }

      expect(questions).toHaveLength(30);
      expect(citationOk).toBeGreaterThan(5);
      expect(refusedForge).toBeGreaterThan(0);

      const filtered = filterCitations(['snap_农田', 'nope'], [
        { snapshotId: 'snap_农田', entityName: '农田', sourceUrl: null, snippet: 'x' },
      ]);
      expect(filtered).toHaveLength(1);
    });
  });
});
