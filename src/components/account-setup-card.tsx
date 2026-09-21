import { ActivityIndicator } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { ThemedText } from '@/components/themed-text';
import { useSession } from '@/lib/auth/session';
import { useT } from '@/lib/i18n';

export function AccountSetupCard() {
  const t = useT();
  const { setupPhase, retrySetup } = useSession();
  return (
    <Card>
      <ThemedText type="smallBold">
        {t(setupPhase === 'error' ? 'sync.setupFailed' : 'sync.settingUp')}
      </ThemedText>
      <ThemedText themeColor="textSecondary">{t('sync.setupDescription')}</ThemedText>
      {setupPhase === 'error'
        ? <Button title={t('error.retry')} onPress={retrySetup} />
        : <ActivityIndicator />}
    </Card>
  );
}
