import { describe, expect, it } from 'vitest';
import { getTaskDescriptionText } from './taskDescriptionText';

describe('getTaskDescriptionText', () => {
  it('returns null when the description is absent or has no text', () => {
    expect(getTaskDescriptionText(null)).toBeNull();
    expect(getTaskDescriptionText({ type: 'doc', content: [] })).toBeNull();
    expect(getTaskDescriptionText({ type: 'doc', content: [{ type: 'paragraph' }] })).toBeNull();
  });

  it('preserves paragraph and hard break separation as plain text', () => {
    expect(
      getTaskDescriptionText({
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'First line' }] },
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Second' },
              { type: 'hardBreak' },
              { type: 'text', text: 'paragraph' },
            ],
          },
        ],
      })
    ).toBe('First line\nSecond\nparagraph');
  });

  it('keeps nested list and unknown wrapper text in document order', () => {
    expect(
      getTaskDescriptionText({
        type: 'doc',
        content: [
          {
            type: 'bulletList',
            content: [
              { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First' }] }] },
              {
                type: 'listItem',
                content: [
                  { type: 'paragraph', content: [{ type: 'text', text: 'Second' }] },
                  { type: 'customWrapper', content: [{ type: 'text', text: 'Nested text' }] },
                ],
              },
            ],
          },
        ],
      })
    ).toBe('First\nSecond\nNested text');
  });

  it('keeps markup-looking text literal and ignores attributes and labels', () => {
    expect(
      getTaskDescriptionText({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            attrs: { href: 'https://example.com', label: 'not visible' },
            content: [{ type: 'text', text: '<script>alert(1)</script>' }],
          },
        ],
      })
    ).toBe('<script>alert(1)</script>');
  });
});
