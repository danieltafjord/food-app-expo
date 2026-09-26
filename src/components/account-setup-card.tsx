import { ActivityIndicator } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { ThemedText } from '@/components/themed-text';
import { useSession } from '@/lib/auth/session';
import { useT } from '@/lib/i18n';

export function AccountSetupCard() {
  const t = useT();
  const { setupPhase, retrySetup } = useSession();
  const title = setupPhase === 'error'
    ? 'sync.setupFailed'
    : setupPhase === 'offline' ? 'sync.setupWaiting' : 'sync.settingUp';
  return (
    <Card>
      <ThemedText type="smallBold">{t(title)}</ThemedText>
      <ThemedText themeColor="textSecondary">{t('sync.setupDescription')}</ThemedText>
      {/* Offline retries by itself when the connection returns; a retry button still helps the impatient. */}
      {setupPhase === 'error' || setupPhase === 'offline'
        ? <Button title={t('error.retry')} variant={setupPhase === 'offline' ? 'secondary' : undefined} onPress={retrySetup} />
        : <ActivityIndicator />}
    </Card>
  );
}
