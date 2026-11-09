import { describe, expect, it } from 'vitest';
import { checkUpload, composeTurn, queryForRetrieval, sniff } from './index';

const bytes = (...xs: number[]) => new Uint8Array([...xs, ...new Array(16).fill(0x20)]);
const text = (s: string) => new TextEncoder().encode(s);

describe('sniff — the type comes from the bytes', () => {
  it('recognises the accepted image formats and PDF', () => {
    expect(sniff(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), 'x.bin')).toEqual({ kind: 'image', mime: 'image/png' });
    expect(sniff(bytes(0xff, 0xd8, 0xff, 0xe0), 'photo')).toEqual({ kind: 'image', mime: 'image/jpeg' });
    expect(sniff(bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50), 'a.webp')).toEqual({ kind: 'image', mime: 'image/webp' });
    expect(sniff(text('%PDF-1.7\n...'), 'notes.pdf')).toEqual({ kind: 'pdf', mime: 'application/pdf' });
  });

  it('ignores a lying filename', () => {
    // A PNG named .pdf is a PNG; a text file named .png is nothing we accept.
    expect(sniff(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), 'fake.pdf')?.mime).toBe('image/png');
    expect(sniff(text('hello'), 'fake.png')).toBeNull();
  });

  it('accepts text only with a text extension and clean UTF-8', () => {
    expect(sniff(text('# Notes\nsin²θ + cos²θ = 1'), 'notes.md')).toEqual({ kind: 'text', mime: 'text/markdown' });
    expect(sniff(text('<svg onload="x()"></svg>'), 'pic.svg')).toBeNull();
    expect(sniff(new Uint8Array([0x68, 0x00, 0x69]), 'a.txt')).toBeNull();
    expect(sniff(new Uint8Array([0xc3, 0x28]), 'bad.txt')).toBeNull();
  });
});

describe('checkUpload', () => {
  it('enforces type and per-kind size', () => {
    expect(checkUpload(null, 10)).toMatch(/not supported/);
    expect(checkUpload({ kind: 'image', mime: 'image/png' }, 6 * 1024 * 1024)).toMatch(/over 5 MB/);
    expect(checkUpload({ kind: 'pdf', mime: 'application/pdf' }, 1024)).toBeNull();
    expect(checkUpload({ kind: 'text', mime: 'text/plain' }, 0)).toMatch(/empty/);
  });
});

describe('composeTurn — how a turn carries its files', () => {
  it('appends each transcript under a label, and sends images and PDFs inline', () => {
    const turn = composeTurn('solve q2', [
      { filename: 'sheet.jpg', kind: 'image', mime: 'image/jpeg', text: '2. Find $x$ if $2x = 6$', bytes: new Uint8Array([1, 2]) },
      { filename: 'notes.txt', kind: 'text', mime: 'text/plain', text: 'sin is opposite over hypotenuse' },
    ]);
    expect(turn.text).toContain('solve q2');
    expect(turn.text).toContain('[Attached image: sheet.jpg]\n2. Find $x$ if $2x = 6$');
    expect(turn.text).toContain('[Attached file: notes.txt]');
    expect(turn.files).toEqual([{ mime: 'image/jpeg', base64: 'AQI=', name: 'sheet.jpg' }]);
  });

  it('gives a file-only turn a question to answer, and says when a file was unreadable', () => {
    const turn = composeTurn('', [{ filename: 'blurry.png', kind: 'image', mime: 'image/png', text: null, bytes: new Uint8Array([1]) }]);
    expect(turn.text).toMatch(/^Help me with the attached file\./);
    expect(turn.text).toContain('could not be read');
  });

  it('shares one transcript budget across the files', () => {
    const big = 'x'.repeat(20_000);
    const turn = composeTurn('q', [
      { filename: 'a.txt', kind: 'text', mime: 'text/plain', text: big },
      { filename: 'b.txt', kind: 'text', mime: 'text/plain', text: big },
    ]);
    expect(turn.text.length).toBeLessThan(13_000);
    expect(turn.text).toContain('the rest of the file is not shown');
  });

  it('gives retrieval the message plus the start of each transcript', () => {
    expect(queryForRetrieval('', [{ text: 'Prove that tan θ = sin θ / cos θ' }])).toBe('Prove that tan θ = sin θ / cos θ');
    expect(queryForRetrieval('', [{ text: null }])).toBe('the attached file');
  });
});
