import { router } from 'expo-router';
import { useState } from 'react';

import { Button } from '@/components/button';
import { Screen } from '@/components/screen';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { ApiError } from '@/lib/api/client';
import { useCreateHousehold } from '@/lib/api/households';
import { useT } from '@/lib/i18n';

export default function CreateHouseholdScreen() {
  const t = useT();
  const theme = useTheme();
  const [name, setName] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const createHousehold = useCreateHousehold();

  async function onSubmit() {
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }
    setFieldError(null);
    setFormError(null);
    try {
      await createHousehold.mutateAsync({ name: trimmed });
      router.back();
    } catch (err) {
      if (err instanceof ApiError && err.isValidation) {
        setFieldError(err.errors?.name?.[0] ?? null);
        if (!err.errors?.name) {
          setFormError(err.message);
        }
      } else {
        setFormError(err instanceof ApiError ? err.message : t('common.somethingWrong'));
      }
    }
  }

  return (
    <Screen topInset={false} refreshable={false}>
      <ThemedText themeColor="textSecondary">{t('household.createDescription')}</ThemedText>

      <TextField
        label={t('household.nameLabel')}
        placeholder={t('household.namePlaceholder')}
        value={name}
        onChangeText={setName}
        autoFocus
        autoCapitalize="words"
        returnKeyType="done"
        onSubmitEditing={onSubmit}
        error={fieldError}
      />

      {formError ? (
        <ThemedText type="small" style={{ color: theme.danger }}>
          {formError}
        </ThemedText>
      ) : null}

      <Button
        title={t('household.createCta')}
        onPress={onSubmit}
        loading={createHousehold.isPending}
        disabled={!name.trim()}
      />
    </Screen>
  );
}
