import { dinnerImageUrl, imageVariant, parseEmoji, uploadBackoffMs } from '@/lib/dinner-images';

describe('imageVariant', () => {
  it('picks the smallest variant that stays sharp on the screen', () => {
    expect(imageVariant(44, 3)).toBe(160);
    expect(imageVariant(88, 3)).toBe(480);
    expect(imageVariant(128, 2)).toBe(480);
    expect(imageVariant(200, 3)).toBe(1024);
    expect(imageVariant(600, 3)).toBe(1024);
  });
});

it('builds the variant URL from the stored path', () => {
  expect(dinnerImageUrl('dinner-images/abc', 160)).toMatch(/\/dinner-images\/abc\/160\.webp$/);
});

it('backs off failed uploads up to an hour', () => {
  expect(uploadBackoffMs(1)).toBe(30_000);
  expect(uploadBackoffMs(2)).toBe(60_000);
  expect(uploadBackoffMs(20)).toBe(60 * 60_000);
});

describe('parseEmoji', () => {
  it('accepts single and composed emoji', () => {
    expect(parseEmoji(' 🍕 ')).toBe('🍕');
    expect(parseEmoji('🌶️')).toBe('🌶️');
    expect(parseEmoji('👨‍🍳')).toBe('👨‍🍳');
  });

  it('rejects text, digits and empty input', () => {
    expect(parseEmoji('')).toBeNull();
    expect(parseEmoji('pizza')).toBeNull();
    expect(parseEmoji('🍕 pizza')).toBeNull();
    expect(parseEmoji('1')).toBeNull();
    expect(parseEmoji('#️⃣')).toBeNull();
  });
});
