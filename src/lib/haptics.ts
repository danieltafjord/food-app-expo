import * as Haptics from 'expo-haptics';

/**
 * Fire-and-forget haptic helpers.
 *
 * No-ops on devices without a Taptic engine / on web, and they swallow their own
 * errors — a missing haptic must never break the interaction that triggered it.
 * Safe to call from the JS thread directly or from a worklet via `runOnJS`.
 */

/**
 * Run a haptic, tolerating both a synchronous throw (native module absent — e.g.
 * before the dev client is rebuilt with `expo-haptics`) and an async rejection.
 */
function fire(run: () => Promise<unknown>): void {
  try {
    run().catch(() => {});
  } catch {
    // no Taptic engine / native module not linked — ignore
  }
}

/** Light tick — discrete selection changes (ticking a shopping item). */
export function hapticSelection(): void {
  fire(() => Haptics.selectionAsync());
}

/** Light bump — a draggable lifts under the finger. */
export function hapticLift(): void {
  fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}

/** Medium thunk — a drag lands somewhere new. */
export function hapticDrop(): void {
  fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
}
