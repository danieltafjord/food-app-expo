import { router } from 'expo-router';
import { useState } from 'react';

import { confirmAccountDeleted } from '@/components/account-deletion';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Screen } from '@/components/screen';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { ApiError } from '@/lib/api/client';
import { errorMessage } from '@/lib/api/error-message';
import { useDeleteAccount } from '@/lib/api/settings';
import type { User } from '@/lib/api/types';
import { useSession } from '@/lib/auth/session';
import { useT } from '@/lib/i18n';

/**
 * Delete the cloud account in the app, whatever it signs in with. People with
 * a password confirm with it; accounts without one (Google) type their email
 * address. Apple accounts on iOS never get here — they confirm with Apple from
 * Settings instead. Server validation (a wrong password) shows on the field.
 */
export default function DeleteAccountScreen() {
  const { user } = useSession();
  const t = useT();
  if (!user) {
    return (
      <Screen topInset={false} refreshable={false}>
        <ThemedText themeColor="textSecondary">{t('account.connect')}</ThemedText>
      </Screen>
    );
  }
  return <DeleteForm key={user.id} user={user} />;
}

function DeleteForm({ user }: { user: User }) {
  const t = useT();
  const theme = useTheme();
  const { signOut } = useSession();
  const remove = useDeleteAccount();
  const withPassword = user.has_password;
  const [value, setValue] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const field = withPassword ? 'password' : 'email';
  const ready = withPassword
    ? value.length > 0
    : value.trim().toLowerCase() === user.email.toLowerCase();

  async function onDelete() {
    if (!ready || remove.isPending) return;
    setFieldError(null);
    setFormError(null);
    try {
      await remove.mutateAsync(withPassword ? { password: value } : { email: value.trim() });
    } catch (err) {
      if (err instanceof ApiError && err.isValidation && err.errors?.[field]?.[0]) {
        setFieldError(err.errors[field][0]);
      } else {
        setFormError(errorMessage(err, t, 'account.deleteFailedTitle'));
      }
      return;
    }
    // The session is gone now; Settings shows the signed-out state beneath.
    router.back();
    confirmAccountDeleted(signOut, t);
  }

  return (
    <Screen topInset={false} refreshable={false}>
      <Card>
        <ThemedText type="subtitle">{t('account.deleteTitle')}</ThemedText>
        <ThemedText themeColor="textSecondary">{t('account.deleteMessage')}</ThemedText>
      </Card>
      {withPassword ? (
        <TextField
          label={t('account.password')}
          value={value}
          onChangeText={setValue}
          secureTextEntry
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="done"
          editable={!remove.isPending}
          onSubmitEditing={onDelete}
          error={fieldError}
        />
      ) : (
        <TextField
          label={t('account.typeEmailToConfirm', { email: user.email })}
          placeholder={user.email}
          value={value}
          onChangeText={setValue}
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          inputMode="email"
          returnKeyType="done"
          editable={!remove.isPending}
          onSubmitEditing={onDelete}
          error={fieldError}
        />
      )}
      {formError ? (
        <ThemedText type="small" style={{ color: theme.danger }}>
          {formError}
        </ThemedText>
      ) : null}
      <Button
        title={t('account.deleteAccount')}
        variant="danger"
        onPress={onDelete}
        loading={remove.isPending}
        disabled={!ready}
      />
    </Screen>
  );
}
