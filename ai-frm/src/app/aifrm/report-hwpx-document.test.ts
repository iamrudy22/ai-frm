import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FinancialReport } from './report-model';
import { projectReport } from './report-hwpx-document';
const fixture = JSON.parse(readFileSync('scripts/hwpx-sample/fixtures/report-contract.json', 'utf8'));
const report = fixture.report as FinancialReport;
describe('projectReport', () => {
    it('preserves the shared saved-value contract, summary input order and fixed body order', () => {
        const before = structuredClone(report);
        const doc = projectReport(report);
        expect({ reportMonth: doc.reportMonth, generatedOn: doc.generatedOn, styleProfile: doc.styleProfile }).toEqual({ reportMonth: fixture.expected.reportMonth, generatedOn: fixture.expected.generatedOn, styleProfile: 'report' });
        expect(doc.pages.map(p => p.blocks.filter(b => b.kind === 'text').map(({ text, style }) => ({ text, style })))).toEqual(fixture.expected.textPages);
        expect(doc.pages.flatMap(p => p.blocks).find(b => b.kind === 'summary')).toEqual({ kind: 'summary', items: fixture.expected.summary });
        expect(doc.pages.map(p => p.blocks.filter(b => b.kind === 'metric').map(b => ({ title: b.title, value: b.value, status: b.status, narrative: b.narrative, basis: b.basis, formula: b.formula, image_role: b.imageRole, tone: b.tone })))).toEqual(fixture.expected.metricPages);
        expect(doc.pages.flatMap(p => p.blocks.flatMap(b => b.kind === 'metric' ? [b.imageRole] : b.kind === 'image' ? [b.role] : []))).toEqual(fixture.expected.imageRoles);
        expect(report).toEqual(before);
        expect(Object.isFrozen(doc.pages[0].blocks)).toBe(true);
        expect(Object.isFrozen(doc.pages[0].blocks[3])).toBe(true);
    });
    it.each(['가', '😀', 'e\u0301', '👩‍💻'])('uses code point boundaries only for unavailable/loading reasons (%s)', token => {
        for (const status of ['산출 불가', '산출 중', '정상']) {
            for (const count of [59, 60, 61]) {
                const narrative = Array.from(token.repeat(61)).slice(0, count).join('');
                const changed = structuredClone(report);
                changed.metrics = changed.metrics.map(m => m.id === 'recovery' ? { ...m, status, narrative } : m);
                const block = projectReport(changed).pages[0].blocks.find(b => b.kind === 'metric');
                expect(block?.kind === 'metric' && block.narrative).toBe(status !== '정상' && count > 60 ? Array.from(narrative).slice(0, 59).join('') + '… (상세는 HTML 참고)' : narrative);
            }
        }
    });
    it('preserves empty construction basis and rejects missing or duplicate metric IDs', () => {
        const changed = structuredClone(report);
        changed.metrics = changed.metrics.map(m => m.id === 'construction' ? { ...m, basis: '' } : m);
        expect(projectReport(changed).pages[1].blocks[0]).toMatchObject({ basis: '', value: '0' });
        expect(() => projectReport({ ...report, metrics: report.metrics.slice(1) })).toThrow(/five unique/);
        expect(() => projectReport({ ...report, metrics: [...report.metrics.slice(1), report.metrics[1]] })).toThrow(/five unique/);
    });
});
