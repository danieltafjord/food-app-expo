import { Alert } from 'react-native';

import type { TFunction } from '@/lib/i18n';
import { getSyncFailures } from '@/lib/sync/engine';

export function showSyncFailures(t: TFunction): void {
  const failures = getSyncFailures();
  Alert.alert(t('sync.syncError'), [t('sync.fixRejected'),
    ...failures.slice(0, 10).map((item) => `${item.name}: ${item.message}`),
  ].join('\n\n'));
}
