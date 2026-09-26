import { router } from 'expo-router';
import { useState } from 'react';

import { Button } from '@/components/button';
import { Screen } from '@/components/screen';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/api/error-message';
import { useActiveHousehold, useUpdateHousehold } from '@/lib/api/households';
import type { Household } from '@/lib/api/types';
import { useT } from '@/lib/i18n';

export default function RenameHouseholdScreen() {
  const { household, isOwner } = useActiveHousehold();
  const t = useT();
  if (!household || !isOwner) {
    return (
      <Screen topInset={false} refreshable={false}>
        <ThemedText>{t('household.onlyOwners')}</ThemedText>
      </Screen>
    );
  }
  return <RenameForm key={household.id} household={household} />;
}

function RenameForm({ household }: { household: Household }) {
  const t = useT();
  const theme = useTheme();
  const update = useUpdateHousehold();
  const [name, setName] = useState(household.name);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit() {
    if (!name.trim() || update.isPending) return;
    setError(null);
    try {
      await update.mutateAsync({ id: household.id, name: name.trim() });
      router.back();
    } catch (err) {
      setError(errorMessage(err, t));
    }
  }

  return (
    <Screen topInset={false} refreshable={false}>
      <TextField
        label={t('household.nameLabel')}
        value={name}
        onChangeText={setName}
        autoFocus
        autoCapitalize="words"
        returnKeyType="done"
        maxLength={255}
        editable={!update.isPending}
        onSubmitEditing={onSubmit}
      />
      {error ? <ThemedText style={{ color: theme.danger }}>{error}</ThemedText> : null}
      <Button
        title={t('common.save')}
        onPress={onSubmit}
        loading={update.isPending}
        disabled={!name.trim() || name.trim() === household.name}
      />
    </Screen>
  );
}
