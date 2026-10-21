import { render, renderHook, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../api/client';
import type { Settings } from '../api/types';
import { createStore, WorkshopContext } from '../state/store';
import { snapshot } from '../state/test-fixtures';
import { CREW, CREW_STATES, CREW_TYPES, crewInfo, crewRarity, dexNumber, MOTION, rarityOf, STAGE_CHARACTER } from './crew';
import { CrewMember } from './CrewMember';
import { usePlay } from './usePlay';

// The dashboard's AGENTS (dashboard/lib/stages.js), in Crew-dex order.
const AGENTS: [string, string][] = [
  ['conductor', 'Foreman'], ['feature-spec-writer', 'Scribe'], ['feature-investigator', 'Sleuth'], ['feature-planner', 'Draftsman'],
  ['feature-implementer', 'Builder'], ['feature-tester', 'Tester'], ['feature-reviewer', 'Head inspector'],
  ['feature-review-permissions', 'Locksmith'], ['feature-review-tests', 'Gauge'], ['feature-review-conventions', 'Stickler'],
  ['feature-review-errors', 'Fuse'], ['feature-review-db', 'Mason'], ['feature-review-performance', 'Stopwatch'],
  ['feature-review-ui', 'Painter'], ['feature-fable-check', 'Oracle'],
];

function reducedMotion(on: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: on && q.includes('reduce'), media: q, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  }));
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('the crew roster', () => {
  it('has all 15, numbered #001–#015, with the dashboard’s names, a role and a bio each', () => {
    expect(CREW.map((c) => [c.type, c.name])).toEqual(AGENTS);
    expect(CREW_TYPES).toHaveLength(15);
    expect(CREW.map((c) => dexNumber(c.number))).toEqual(Array.from({ length: 15 }, (_, i) => `#${String(i + 1).padStart(3, '0')}`));
    for (const c of CREW) {
      expect(c.role.length, c.type).toBeGreaterThan(5);
      expect(c.bio.length, c.type).toBeGreaterThan(10);
      expect(c.bio.length, c.type).toBeLessThan(90);
      expect(MOTION[c.tool], c.type).toBeTruthy();
    }
    expect(new Set(CREW.map((c) => c.bio)).size).toBe(15);
    expect(crewInfo('feature-review-permissions').bio).toBe('Has never met a door it trusted.');
  });

  it('rarity by model: Haiku common, Sonnet uncommon, Opus rare, Fable legendary', () => {
    expect(rarityOf('claude-haiku-5-5')).toBe('common');
    expect(rarityOf('sonnet')).toBe('uncommon');
    expect(rarityOf('claude-opus-5-5')).toBe('rare');
    expect(rarityOf('claude-fable-5-1')).toBe('legendary');
    expect(rarityOf(null)).toBeNull();
    // From the agent files (meta.crewModels) first, else the member's usual model.
    expect(crewRarity('feature-review-conventions', { 'feature-review-conventions': { model: 'opus' } })).toBe('rare');
    expect(crewRarity('feature-review-conventions', {})).toBe('common');
    expect(crewRarity('feature-fable-check')).toBe('legendary');
    expect(crewRarity('conductor')).toBe('rare');
  });

  it('stands a crew member at every stage', () => {
    for (const stage of ['clarify', 'spec', 'refine', 'wireframe', 'investigate', 'spec-update', 'plan', 'implement', 'test', 'review', 'pr1', 'pr2', 'staging-qa', 'pr3']) {
      expect(CREW_TYPES).toContain(STAGE_CHARACTER[stage]);
    }
    // The wireframer worker is drawn as the Painter; the crew stays 15.
    expect(crewInfo('feature-wireframer').name).toBe('Painter');
    expect(STAGE_CHARACTER.wireframe).toBe('feature-review-ui');
    expect(STAGE_CHARACTER.clarify).toBe('conductor');
    expect(CREW_TYPES).toHaveLength(15);
  });

  it('an unknown helper gets a plain look and its type as its name', () => {
    expect(crewInfo('general-purpose')).toMatchObject({ name: 'general-purpose', number: 0, hat: 'cap', tool: 'clipboard' });
  });
});

describe('<CrewMember>', () => {
  it('draws each of the 15 in every state, as an image named by its label', () => {
    for (const type of CREW_TYPES) {
      for (const state of CREW_STATES) {
        const { container, unmount } = render(<CrewMember type={type} state={state} size={40} label={`${crewInfo(type).name}, ${state}`} />);
        const svg = container.querySelector('svg')!;
        expect(svg).toHaveAttribute('role', 'img');
        expect(svg).toHaveAccessibleName(`${crewInfo(type).name}, ${state}`);
        expect(svg).toHaveClass('crew', `crew-${type}`, `is-${state}`);
        expect(svg).toHaveAttribute('width', '40');
        expect(svg.querySelector('.hat')?.childElementCount).toBeGreaterThan(0);
        expect(svg.querySelector('.tool')?.childElementCount).toBeGreaterThan(0);
        unmount();
      }
    }
  });

  it('names itself "<Name>, <mood>" when no label is given; an empty label makes it decoration', () => {
    render(<CrewMember type="feature-implementer" state="working" />);
    expect(screen.getByRole('img', { name: 'Builder, working' })).toBeInTheDocument();
    render(<CrewMember type="conductor" />);
    expect(screen.getByRole('img', { name: 'Foreman, idle' })).toBeInTheDocument();
    const { container } = render(<CrewMember type="feature-tester" label="" />);
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).not.toHaveAttribute('role');
    expect(svg.querySelector('title')).toBeNull();
  });

  it('moves only when asked (Full), never under reduced motion; Subtle holds a still pose', () => {
    reducedMotion(false);
    const { container, rerender } = render(<CrewMember type="feature-implementer" state="working" animated />);
    expect(container.querySelector('svg')).toHaveClass('is-animated', 'm-strike');
    rerender(<CrewMember type="feature-implementer" state="working" animated={false} />);
    expect(container.querySelector('svg')).toHaveClass('is-still');
    expect(container.querySelector('svg')).not.toHaveClass('is-animated');
  });

  it('with reduced motion asked for, an animated crew member still holds still', () => {
    reducedMotion(true);
    const { container } = render(<CrewMember type="feature-tester" state="waiting" animated />);
    expect(container.querySelector('svg')).toHaveClass('is-still');
    expect(container.querySelector('svg')).not.toHaveClass('is-animated');
  });

  it('shows the mood in the drawing: sparks working, z’s asleep, confetti celebrating', () => {
    const { container, rerender } = render(<CrewMember type="feature-implementer" state="working" />);
    expect(container.querySelector('.sparks')).not.toBeNull();
    rerender(<CrewMember type="feature-implementer" state="asleep" />);
    expect(container.querySelector('.zzz')).not.toBeNull();
    rerender(<CrewMember type="feature-implementer" state="celebrating" />);
    expect(container.querySelector('.confetti')).not.toBeNull();
    rerender(<CrewMember type="feature-implementer" state="idle" />);
    expect(container.querySelector('.fx')?.childElementCount).toBe(0);
  });

  it('draws nothing with Play mode Off; follows Full (moving) and Subtle (still) when not told', () => {
    reducedMotion(false);
    const provider = (mode: 'off' | 'subtle' | 'full') => {
      const store = createStore();
      store.dispatch({ type: 'snapshot', snapshot: snapshot({ meta: { token: 't', settings: { policy: 'hands-off', play: { mode, questDone: 'first-pr', sounds: false } } } }) });
      return ({ children }: { children: ReactNode }) => <WorkshopContext.Provider value={{ store, api: {} as ApiClient }}>{children}</WorkshopContext.Provider>;
    };
    const off = render(<CrewMember type="feature-tester" state="working" />, { wrapper: provider('off') });
    expect(off.container.innerHTML).toBe('');
    const subtle = render(<CrewMember type="feature-tester" state="working" />, { wrapper: provider('subtle') });
    expect(subtle.container.querySelector('svg')).toHaveClass('is-still');
    const full = render(<CrewMember type="feature-tester" state="working" />, { wrapper: provider('full') });
    expect(full.container.querySelector('svg')).toHaveClass('is-animated');
  });

  it('celebrating holds the tool up beside the head, upright in its grip', () => {
    const { container } = render(<CrewMember type="feature-implementer" state="celebrating" />);
    expect(container.querySelector('.arm-r .tool > .grip')?.childElementCount).toBeGreaterThan(0);
  });

  it('takes every colour from --crew-* tokens', () => {
    const { container } = render(<CrewMember type="feature-planner" state="working" />);
    const colours = [...container.querySelectorAll('[fill], [stroke]')].flatMap((el) => [el.getAttribute('fill'), el.getAttribute('stroke')]).filter((c) => c && c !== 'none');
    expect(colours.length).toBeGreaterThan(10);
    for (const c of colours) expect(c).toMatch(/^var\(--crew-[a-z0-9-]+\)$/);
  });
});

describe('usePlay', () => {
  function wrapper(settings?: Settings) {
    const store = createStore();
    store.dispatch({ type: 'snapshot', snapshot: snapshot({ meta: { token: 't', settings } }) });
    const api = {} as ApiClient;
    return ({ children }: { children: ReactNode }) => <WorkshopContext.Provider value={{ store, api }}>{children}</WorkshopContext.Provider>;
  }

  it('Subtle by default: on, still', () => {
    const { result } = renderHook(() => usePlay(), { wrapper: wrapper() });
    expect(result.current).toMatchObject({ mode: 'subtle', on: true, full: false, animated: false, sounds: false });
  });

  it('Full animates unless reduced motion is asked for; Off is off', () => {
    reducedMotion(false);
    const full = { policy: 'hands-off' as const, play: { mode: 'full' as const, questDone: 'first-pr' as const, sounds: true } };
    expect(renderHook(() => usePlay(), { wrapper: wrapper(full) }).result.current).toMatchObject({ full: true, animated: true, sounds: true });
    reducedMotion(true);
    expect(renderHook(() => usePlay(), { wrapper: wrapper(full) }).result.current).toMatchObject({ full: true, animated: false, reducedMotion: true });
    const off = { policy: 'hands-off' as const, play: { mode: 'off' as const, questDone: 'first-pr' as const, sounds: false } };
    expect(renderHook(() => usePlay(), { wrapper: wrapper(off) }).result.current).toMatchObject({ on: false, animated: false });
  });
});
