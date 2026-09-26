import { router } from 'expo-router';
import { useState } from 'react';

import { Button } from '@/components/button';
import { Screen } from '@/components/screen';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { ApiError } from '@/lib/api/client';
import { errorMessage } from '@/lib/api/error-message';
import { useUpdateProfile } from '@/lib/api/settings';
import type { User } from '@/lib/api/types';
import { useSession } from '@/lib/auth/session';
import { useT } from '@/lib/i18n';

/**
 * The person's own display name — what the household sees on lists, in
 * presence and in notifications. Starts empty when the account never had a
 * real one (Apple's Hide My Email), rather than showing the placeholder.
 */
export default function YourNameScreen() {
  const { user } = useSession();
  const t = useT();
  if (!user) {
    return (
      <Screen topInset={false} refreshable={false}>
        <ThemedText themeColor="textSecondary">{t('account.connect')}</ThemedText>
      </Screen>
    );
  }
  return <NameForm key={user.id} user={user} />;
}

function NameForm({ user }: { user: User }) {
  const t = useT();
  const theme = useTheme();
  const update = useUpdateProfile();
  const initial = user.needs_name ? '' : user.name;
  const [name, setName] = useState(initial);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const trimmed = name.trim();

  async function onSubmit() {
    // The return key can fire again while the request is still in flight.
    if (!trimmed || update.isPending) return;
    setFieldError(null);
    setFormError(null);
    try {
      await update.mutateAsync({ name: trimmed });
      router.back();
    } catch (err) {
      if (err instanceof ApiError && err.isValidation && err.errors?.name?.[0]) {
        setFieldError(err.errors.name[0]);
      } else {
        setFormError(errorMessage(err, t));
      }
    }
  }

  return (
    <Screen topInset={false} refreshable={false}>
      <ThemedText themeColor="textSecondary">{t('account.nameDescription')}</ThemedText>
      <TextField
        label={t('account.yourName')}
        placeholder={t('account.namePlaceholder')}
        value={name}
        onChangeText={setName}
        autoFocus
        autoCapitalize="words"
        autoComplete="name"
        textContentType="name"
        returnKeyType="done"
        maxLength={255}
        editable={!update.isPending}
        onSubmitEditing={onSubmit}
        error={fieldError}
      />
      {formError ? (
        <ThemedText type="small" style={{ color: theme.danger }}>
          {formError}
        </ThemedText>
      ) : null}
      <Button
        title={t('common.save')}
        onPress={onSubmit}
        loading={update.isPending}
        disabled={!trimmed || trimmed === initial}
      />
    </Screen>
  );
}
