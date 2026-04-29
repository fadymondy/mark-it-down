import { describe, expect, it } from 'vitest';
import { buildSlideshow } from '../../../src/slideshow/slideshowGenerator';

describe('slideshow live-reload bridge', () => {
  const baseInput = { markdown: '# A\n\n---\n\n# B', fallbackTitle: 'doc' };
  const baseOpts = { theme: 'black', transition: 'slide', speakerNotes: true };

  it('does not inject the bridge when liveReload is omitted', () => {
    const html = buildSlideshow(baseInput, baseOpts).html;
    expect(html).not.toContain('slideshow.position');
    expect(html).toContain('hash: true');
  });

  it('injects acquireVsCodeApi + slidechanged listener when liveReload is set', () => {
    const html = buildSlideshow(baseInput, { ...baseOpts, liveReload: {} }).html;
    expect(html).toContain('acquireVsCodeApi');
    expect(html).toContain('slidechanged');
    expect(html).toContain('slideshow.position');
    expect(html).toContain('slideshow.ready');
  });

  it('disables hash-based routing in live mode', () => {
    const html = buildSlideshow(baseInput, { ...baseOpts, liveReload: {} }).html;
    expect(html).toContain('hash: false');
  });

  it('bakes the initial index into the page', () => {
    const html = buildSlideshow(baseInput, {
      ...baseOpts,
      liveReload: { initialIndex: { h: 2, v: 1, f: 0 } },
    }).html;
    expect(html).toContain('"h":2');
    expect(html).toContain('"v":1');
    expect(html).toContain('Reveal.slide(initial.h, initial.v || 0, initial.f || 0)');
  });

  it('handles a missing initialIndex gracefully', () => {
    const html = buildSlideshow(baseInput, { ...baseOpts, liveReload: {} }).html;
    expect(html).toContain('var initial = null');
  });
});
