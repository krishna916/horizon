import { describe, expect, it } from 'vitest';
import { getTaskDescriptionText } from './taskDescriptionText';
import { toTaskDescriptionDocument } from './taskDescriptionDocument';

describe('toTaskDescriptionDocument', () => {
  it('returns null for blank text', () => {
    expect(toTaskDescriptionDocument('   \n\t  ')).toBeNull();
  });

  it('encodes a single paragraph in the JSON document format', () => {
    expect(toTaskDescriptionDocument('Hello')).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }],
    });
  });

  it('encodes multiple lines as ordered paragraphs and round trips through the reader', () => {
    const document = toTaskDescriptionDocument('First line\nSecond paragraph');

    expect(document).toEqual({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'First line' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Second paragraph' }] },
      ],
    });
    expect(getTaskDescriptionText(document)).toBe('First line\nSecond paragraph');
  });

  it('keeps HTML-like input as literal text', () => {
    expect(toTaskDescriptionDocument('<b>literal</b>')).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '<b>literal</b>' }] }],
    });
  });
});
