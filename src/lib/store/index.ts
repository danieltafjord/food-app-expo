/** Public surface of the on-device store. */
export * from './schema';
export { store$ } from './collections';
export {
  type AccountTransition,
  accountTransitionFor,
  bindAccount,
  clearLocalData,
  getBoundAccountId,
  resetLocalDataForAccount,
  resetLocalDataForHousehold,
} from './account';
export { newId, nowIso } from './ids';
export { whenHydrated } from './persistence';
export { StoreProvider } from './StoreProvider';
export {
  DEFAULT_HOUSEHOLD_SERVINGS,
  LOCAL_HOUSEHOLD_NAME,
  applyServerHouseholdSettings,
  ensureLocalHousehold,
  getHouseholdDefaultServings,
  getLocalHouseholdId,
  renameLocalHousehold,
  setHouseholdDefaultServings,
  useHouseholdDefaultServings,
  useLocalHousehold,
} from './household';
export {
  type ThemePreference,
  type ShoppingListDensity,
  applyServerSettings,
  ensureSettingsDefaults,
  getLocale,
  setLocale,
  setThemePreference,
  setShoppingListDensity,
  useLocale,
  useThemePreference,
  useShoppingListDensity,
} from './settings';

// Domain hooks/mutations are re-exported here as each is built:
export * from './ingredients';
export * from './dinners';
export * from './plans';
export * from './shopping-lists';
