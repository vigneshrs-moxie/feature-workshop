// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { job } from '../../state/test-fixtures';
import { jobStatus } from './jobStatus';
import { STAGE_NAMES } from '../../theme/tokens';
import { STAGE_INFO, stageFamily, stageHint, stageLabel } from './stages';

const now = new Date(2026, 9, 15, 15, 0);

describe('jobStatus', () => {
  it('always gives a glyph and a text label', () => {
    for (const g of ['needs-you', 'running', 'paused', 'idle', 'done'] as const) {
      const s = jobStatus(job('x', g), now);
      expect(s.glyph).toBeTruthy();
      expect(s.label).toBeTruthy();
      expect(s.hint).toMatch(/\.$/);
    }
  });

  it('says what a Needs-you job is waiting for', () => {
    expect(jobStatus(job('x', 'needs-you', { permissions: 1 }), now).label).toBe('Permission');
    expect(jobStatus(job('x', 'needs-you', { permissions: 3 }), now).label).toBe('3 permissions');
    expect(jobStatus(job('x', 'needs-you', { waitingFor: 'answers' }), now).label).toBe('Question');
    expect(jobStatus(job('x', 'needs-you', { waitingFor: 'approval' }), now).label).toBe('Go-ahead');
    expect(jobStatus(job('x', 'needs-you'), now).label).toBe('Your turn');
  });

  it('says when a usage-paused job resumes', () => {
    const resets = new Date(2026, 9, 15, 15, 42).toISOString();
    expect(jobStatus(job('x', 'paused', { limitPaused: resets }), now).label).toBe('resumes 3:42pm');
    expect(jobStatus(job('x', 'paused', { limitPaused: resets, limitAuto: false }), now).label).toBe('limit resets 3:42pm');
    expect(jobStatus(job('x', 'paused'), now).label).toBe('Paused');
  });

  it('tells starting from working, stopped from idle, dropped from done', () => {
    expect(jobStatus(job('x', 'running', { starting: true }), now).label).toBe('Starting');
    expect(jobStatus(job('x', 'running'), now).label).toBe('Working');
    expect(jobStatus(job('x', 'idle', { stageState: 'paused' }), now).label).toBe('Stopped');
    expect(jobStatus(job('x', 'done', { closed: { as: 'dropped' } }), now).label).toBe('Dropped');
    expect(jobStatus(job('x', 'done', { closed: { as: 'done' } }), now).label).toBe('Done');
  });
});

describe('stages', () => {
  it('names stages, and shows an unknown id as it is', () => {
    expect(stageLabel('implement')).toBe('Build');
    expect(stageLabel('mystery')).toBe('mystery');
    expect(stageLabel(undefined)).toBe('');
    expect(stageHint('plan')).toMatch(/^Stage: Plan\. /);
  });

  it('matches the dashboard’s stage list', () => {
    const src = readFileSync(fileURLToPath(new URL('../../../../dashboard/lib/stages.js', import.meta.url)), 'utf8');
    const dashboard = [...src.matchAll(/\{ id: '([^']+)', label: '([^']+)'/g)].map((m) => [m[1], m[2]]);
    expect(dashboard.length).toBeGreaterThan(5);
    expect(Object.entries(STAGE_INFO).map(([id, s]) => [id, s.label])).toEqual(dashboard);
  });

  it('puts every stage in one of the six themed families, in workflow order', () => {
    expect(stageFamily('spec')).toBe('spec');
    expect(stageFamily('refine')).toBe('spec');
    expect(stageFamily('spec-update')).toBe('spec');
    expect(stageFamily('investigate')).toBe('investigate');
    expect(stageFamily('plan')).toBe('plan');
    expect(stageFamily('implement')).toBe('build');
    expect(stageFamily('test')).toBe('test');
    for (const ship of ['review', 'pr1', 'pr2', 'staging-qa', 'pr3']) expect(stageFamily(ship)).toBe('review');
    expect(stageFamily('mystery')).toBe('spec');
    expect(stageFamily(null)).toBe('spec');
    for (const id of Object.keys(STAGE_INFO)) expect(STAGE_NAMES).toContain(stageFamily(id));
  });
});
