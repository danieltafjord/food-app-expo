import { MEDIA_BASE_URL } from '@/lib/config';

/**
 * Dinner pictures. A dinner shows either an emoji (drawn on device in the same
 * rounded tile as a photo) or an image the server stores as square WebP
 * variants under an unguessable path: `{MEDIA_BASE_URL}/{path}/{size}.webp`.
 * Photos picked offline wait in `store$.meta.pendingImages` and are shown from
 * the device until the upload has attached them (see `dinner-image-upload`).
 */

/** Square edge lengths the server renders, smallest first (mirrors `DinnerImage::SIZES`). */
export const IMAGE_SIZES = [160, 480, 1024] as const;
export type ImageSize = (typeof IMAGE_SIZES)[number];

/** A picked photo waiting to upload. `file` is relative to the documents directory, whose absolute path can change between app updates. */
export type PendingImage = {
  file: string;
  created_at: string;
  attempts: number;
  /** Epoch ms before which the upload is not retried. */
  retry_at: number | null;
};

/** The smallest variant that stays sharp at `sizePt` points on this screen. */
export function imageVariant(sizePt: number, pixelRatio: number): ImageSize {
  const pixels = sizePt * pixelRatio;
  return IMAGE_SIZES.find((size) => size >= pixels) ?? IMAGE_SIZES[IMAGE_SIZES.length - 1];
}

export function dinnerImageUrl(path: string, size: ImageSize): string {
  return `${MEDIA_BASE_URL}/${path}/${size}.webp`;
}

/** Retry delay after a failed upload: 30 s doubling up to an hour. */
export function uploadBackoffMs(attempts: number): number {
  return Math.min(60 * 60_000, 30_000 * 2 ** Math.max(0, attempts - 1));
}

/** Everyday dinners first; the text field accepts any other emoji. */
export const FOOD_EMOJI = [
  '🍝', '🍕', '🌮', '🌯', '🍔', '🍲', '🍛', '🍜', '🍣', '🍱', '🥘', '🫕',
  '🍗', '🍖', '🥩', '🥓', '🐟', '🍤', '🦐', '🦞', '🦀', '🐙', '🍚', '🍙',
  '🥟', '🥡', '🫔', '🥙', '🧆', '🥪', '🌭', '🍳', '🥞', '🧇', '🥗', '🥔',
  '🥕', '🌽', '🥦', '🍄', '🫘', '🍅', '🍆', '🌶️', '🧀', '🥖', '🥧', '🍰',
] as const;

const EMOJI_PATTERN = /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|\p{Emoji_Modifier}|‍|️)+$/u;

/** The typed text as a single emoji picture, or null when it isn't one. */
export function parseEmoji(text: string): string | null {
  const value = text.trim();
  if (!value || value.length > 16 || !EMOJI_PATTERN.test(value) || !/\p{Extended_Pictographic}/u.test(value)) return null;
  // Plain digits, # and * are emoji components too; they are not pictures.
  if (/^[0-9#*]/.test(value)) return null;
  return value;
}
