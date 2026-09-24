import { Directory, File, Paths } from 'expo-file-system';
import { Image } from 'expo-image';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { ApiError } from '@/lib/api/client';
import { dinnerImageUrl, uploadBackoffMs, type PendingImage } from '@/lib/dinner-images';
import { store$ } from '@/lib/store/collections';
import { setDinnerPicture } from '@/lib/store/dinners';
import { newId, nowIso } from '@/lib/store/ids';
import type { SyncRequest } from '@/lib/sync/auth-bridge';

/** What the server answers for a stored picture. */
export type StoredImage = { path: string; thumbhash: string; url: string };

const PENDING_DIR = 'pending-dinner-images';
/** Plenty for the 1024 px variant, small enough to upload quickly on mobile data. */
const MAX_EDGE = 1600;

/** Local file handle for a pending upload. */
export function pendingImageFile(name: string): File {
  return new File(Paths.document, PENDING_DIR, name);
}

/**
 * Shrink a picked (already square-cropped) photo and keep it on the device
 * until it has uploaded. The dinner shows it right away, offline included.
 */
export async function queuePickedPhoto(dinnerId: string, asset: { uri: string; width: number; height: number }): Promise<void> {
  const context = ImageManipulator.manipulate(asset.uri);
  if (Math.max(asset.width, asset.height) > MAX_EDGE) {
    context.resize(asset.width >= asset.height ? { width: MAX_EDGE } : { height: MAX_EDGE });
  }
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ compress: 0.82, format: SaveFormat.JPEG });
  const directory = new Directory(Paths.document, PENDING_DIR);
  if (!directory.exists) directory.create({ intermediates: true });
  const name = `${newId()}.jpg`;
  new File(saved.uri).moveSync(pendingImageFile(name));

  if (!store$.dinners[dinnerId].peek()) {
    deletePendingFile(name);
    return;
  }
  const previous = store$.meta.pendingImages[dinnerId].peek();
  store$.meta.pendingImages[dinnerId].set({ file: name, created_at: nowIso(), attempts: 0, retry_at: null });
  if (previous) deletePendingFile(previous.file);
}

export function deletePendingFile(name: string): void {
  try {
    const file = pendingImageFile(name);
    if (file.exists) file.delete();
  } catch {
    // A leftover file is removed by the next sweep.
  }
}

/** Remove files no pending upload refers to (dropped uploads, a wiped account). */
export function sweepPendingFiles(): void {
  try {
    const directory = new Directory(Paths.document, PENDING_DIR);
    if (!directory.exists) return;
    const inUse = new Set(Object.values(store$.meta.pendingImages.peek()).map((pending) => pending.file));
    for (const entry of directory.list()) {
      if (entry instanceof File && !inUse.has(entry.name)) entry.delete();
    }
  } catch {
    // Best effort; retried on the next launch.
  }
}

let running = false;

/**
 * Upload every due pending photo, one at a time, and attach each to its dinner.
 * Returns the delay until the next upload is due (null when nothing is waiting).
 * A photo the server refuses is dropped; network and server errors back off.
 */
export async function uploadPendingImages(request: SyncRequest, now = Date.now()): Promise<number | null> {
  if (running) return 5_000;
  running = true;
  try {
    for (const [dinnerId, pending] of Object.entries(store$.meta.pendingImages.peek())) {
      if (!store$.dinners[dinnerId].peek()) {
        dropPending(dinnerId, pending);
        continue;
      }
      if (pending.retry_at != null && pending.retry_at > now) continue;
      const file = pendingImageFile(pending.file);
      if (!file.exists) {
        store$.meta.pendingImages[dinnerId].delete();
        continue;
      }
      const form = new FormData();
      // React Native's multipart shape: the native layer streams the file.
      form.append('image', { uri: file.uri, name: 'dinner.jpg', type: 'image/jpeg' } as unknown as Blob);
      let stored: StoredImage;
      try {
        stored = await request<StoredImage>('/dinner-images', { method: 'POST', body: form });
      } catch (error) {
        if (error instanceof ApiError && (error.status === 413 || error.status === 422)) {
          dropPending(dinnerId, pending);
          continue;
        }
        const attempts = pending.attempts + 1;
        const wait = Math.max(uploadBackoffMs(attempts), error instanceof ApiError ? error.retryAfterMs ?? 0 : 0);
        if (store$.meta.pendingImages[dinnerId].peek()?.file === pending.file) {
          store$.meta.pendingImages[dinnerId].assign({ attempts, retry_at: now + wait });
        }
        // The next photo would fail the same way (offline, signed out, server down).
        break;
      }
      // Warm the cache so the swap from the local file doesn't flash the placeholder.
      await Image.prefetch(dinnerImageUrl(stored.path, 480)).catch(() => false);
      // Picked again, removed, or deleted while uploading: this upload is stale
      // and the server prunes the unused files.
      if (store$.meta.pendingImages[dinnerId].peek()?.file !== pending.file) continue;
      setDinnerPicture(dinnerId, { kind: 'image', path: stored.path, thumbhash: stored.thumbhash });
      deletePendingFile(pending.file);
    }
    const due = Object.values(store$.meta.pendingImages.peek()).map((pending) => pending.retry_at ?? now);
    return due.length ? Math.max(1_000, Math.min(...due) - now) : null;
  } finally {
    running = false;
  }
}

function dropPending(dinnerId: string, pending: PendingImage): void {
  if (store$.meta.pendingImages[dinnerId].peek()?.file === pending.file) store$.meta.pendingImages[dinnerId].delete();
  deletePendingFile(pending.file);
}
