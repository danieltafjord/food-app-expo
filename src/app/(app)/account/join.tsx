import { router } from 'expo-router';
import { useState } from 'react';

import { Button } from '@/components/button';
import { Screen } from '@/components/screen';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { useT } from '@/lib/i18n';

/** Pull the token out of an invite URL like `.../invitations/<token>`, else treat the input as the token. */
function extractToken(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }
  const match = trimmed.match(/invitations\/([^/?#\s]+)/i);
  return match ? match[1] : trimmed;
}

export default function JoinScreen() {
  const t = useT();
  const [value, setValue] = useState('');

  function onContinue() {
    const token = extractToken(value);
    if (token) {
      router.replace({ pathname: '/invitations/[token]', params: { token } });
    }
  }

  return (
    <Screen topInset={false} refreshable={false}>
      <ThemedText themeColor="textSecondary">{t('household.joinDescription')}</ThemedText>
      <TextField
        label={t('household.linkOrCode')}
        placeholder={t('household.linkPlaceholder')}
        value={value}
        onChangeText={setValue}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="go"
        onSubmitEditing={onContinue}
      />
      <Button title={t('common.continueAction')} onPress={onContinue} disabled={!value.trim()} />
    </Screen>
  );
}
