import { Alert } from 'react-native';

import type { TFunction } from '@/lib/i18n';
import { clearLocalData } from '@/lib/store';
import { flushPersistence } from '@/lib/store/persistence';

/**
 * Sign out and wipe this device's copy (dinners, plans, lists, unsynced
 * changes). Says so when it fails; resolves either way.
 */
export async function clearDeviceData(signOut: () => Promise<void>, t: TFunction): Promise<void> {
  try {
    await signOut();
    clearLocalData();
    await flushPersistence();
  } catch {
    Alert.alert(t('account.clearFailedTitle'), t('account.clearFailedMessage'));
  }
}

/**
 * After the cloud account is gone: confirm it, and offer to remove the copy
 * this device still holds (local-first, so nothing here was deleted yet).
 */
export function confirmAccountDeleted(signOut: () => Promise<void>, t: TFunction): void {
  Alert.alert(t('account.deletedTitle'), t('account.deletedMessage'), [
    { text: t('account.keepDeviceData'), style: 'cancel' },
    {
      text: t('account.clearDeviceData'),
      style: 'destructive',
      onPress: () => void clearDeviceData(signOut, t),
    },
  ]);
}
