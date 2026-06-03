/** Public surface of the on-device store. */
export * from './schema';
export { store$ } from './collections';
export { newId, nowIso } from './ids';
export { whenHydrated } from './persistence';
export { StoreProvider } from './StoreProvider';
export {
  LOCAL_HOUSEHOLD_NAME,
  ensureLocalHousehold,
  getLocalHouseholdId,
  renameLocalHousehold,
  useLocalHousehold,
} from './household';
export {
  type ThemePreference,
  applyServerSettings,
  ensureSettingsDefaults,
  getLocale,
  setLocale,
  setThemePreference,
  useLocale,
  useThemePreference,
} from './settings';

// Domain hooks/mutations are re-exported here as each is built:
export * from './ingredients';
export * from './dinners';
export * from './plans';
export * from './shopping-lists';
