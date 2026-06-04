import { ensureLocalHousehold } from './household';
import { runMigrations } from './migrations';
import { ensureSettingsDefaults } from './settings';

/**
 * One-time, idempotent store boot, run after persistence has hydrated:
 *   1. upgrade persisted rows to the current shape (`runMigrations`),
 *   2. seed the implicit on-device household,
 *   3. seed any unset settings defaults.
 *
 * MUST complete before anything reads the collections. Both the React tree
 * (`StoreProvider`) and the headless sync engine (`connectCollections`) call this;
 * the `booted` latch makes the second caller a cheap no-op, so whichever runs
 * first wins and the "migrate before first read" guarantee is *structural* rather
 * than dependent on effect/promise ordering.
 *
 * A throw (e.g. a corrupt row a migration can't handle) leaves `booted` false so a
 * retry re-runs the whole sequence; callers surface the error instead of silently
 * wedging on the splash.
 */
let booted = false;

export function bootStore(): void {
  if (booted) {
    return;
  }
  runMigrations();
  ensureLocalHousehold();
  ensureSettingsDefaults();
  booted = true;
}
