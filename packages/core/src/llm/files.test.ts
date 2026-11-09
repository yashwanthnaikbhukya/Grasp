import { describe, expect, it } from 'vitest';
import { fileKind, filesFor, readsAll } from './gateway';
import type { ChatMessage, ProviderAdapter } from './types';

const adapter = (reads?: ProviderAdapter['reads']) =>
  ({ name: 'gemini', reads, available: () => true, modelFor: () => 'm', chat: async () => ({}) }) as unknown as ProviderAdapter;

const png = { mime: 'image/png', base64: 'AAAA', name: 'q.png' };
const pdf = { mime: 'application/pdf', base64: 'BBBB', name: 'notes.pdf' };

describe('inline files through the gateway', () => {
  it('knows images and PDFs, and nothing else', () => {
    expect(fileKind('image/webp')).toBe('image');
    expect(fileKind('application/pdf')).toBe('pdf');
    expect(fileKind('text/plain')).toBeNull();
  });

  it('sends files only to a provider that reads them', () => {
    const turn: ChatMessage[] = [{ role: 'user', content: 'solve this\n\n[Attached: q.png]', files: [png, pdf] }];
    expect(filesFor(turn, adapter(['image', 'pdf']))[0]?.files).toEqual([png, pdf]);
    expect(filesFor(turn, adapter(['image']))[0]?.files).toEqual([png]);
    // A text-only provider gets the text — which carries the transcript — and no files key at all.
    const textOnly = filesFor(turn, adapter())[0];
    expect(textOnly).toEqual({ role: 'user', content: 'solve this\n\n[Attached: q.png]' });
  });

  it('filters a chain down to providers that can read every file, when reading is the point', () => {
    expect(readsAll(adapter(['image', 'pdf']), [png, pdf])).toBe(true);
    expect(readsAll(adapter(['image']), [png, pdf])).toBe(false);
    expect(readsAll(adapter(), [png])).toBe(false);
  });
});
