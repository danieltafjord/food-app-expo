import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { ApiError } from '@/lib/api/client';
import { useAcceptInvitation, useDeclineInvitation } from '@/lib/api/invitations';
import { setPendingInvite } from '@/lib/auth/pending-invite';
import { useSession } from '@/lib/auth/session';
import { useT } from '@/lib/i18n';

export default function AcceptInvitationScreen() {
  const t = useT();
  const theme = useTheme();
  const params = useLocalSearchParams<{ token: string | string[] }>();
  const token = Array.isArray(params.token) ? params.token[0] : params.token;
  const { isAuthenticated, isLoading } = useSession();
  const accept = useAcceptInvitation();
  const decline = useDeclineInvitation();

  const [outcome, setOutcome] = useState<'pending' | 'accepted' | 'declined'>('pending');
  const [householdName, setHouseholdName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onAccept() {
    if (!token) {
      return;
    }
    setError(null);
    try {
      const household = await accept.mutateAsync(token);
      setHouseholdName(household.name);
      setOutcome('accepted');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('invitation.acceptError'));
    }
  }

  async function onDecline() {
    if (!token) {
      return;
    }
    setError(null);
    try {
      await decline.mutateAsync(token);
      setOutcome('declined');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('invitation.declineError'));
    }
  }

  if (isLoading) {
    return (
      <Screen refreshable={false}>
        <ActivityIndicator style={styles.loader} />
      </Screen>
    );
  }

  if (!token) {
    return (
      <Screen refreshable={false}>
        <Card>
          <ThemedText type="subtitle">{t('invitation.invalidLink')}</ThemedText>
          <ThemedText themeColor="textSecondary">
            {t('invitation.invalidLinkDescription')}
          </ThemedText>
          <Button title={t('common.goHome')} variant="secondary" onPress={() => router.replace('/')} />
        </Card>
      </Screen>
    );
  }

  if (!isAuthenticated) {
    return (
      <Screen refreshable={false}>
        <Card>
          <ThemedText type="subtitle">{t('invitation.invitedTitle')}</ThemedText>
          <ThemedText themeColor="textSecondary">{t('invitation.invitedDescription')}</ThemedText>
          <Button
            title={t('invitation.signInToContinue')}
            onPress={() => {
              setPendingInvite(token);
              router.replace('/sign-in');
            }}
          />
        </Card>
      </Screen>
    );
  }

  if (outcome === 'accepted') {
    return (
      <Screen refreshable={false}>
        <Card>
          <ThemedText type="subtitle">{t('invitation.acceptedTitle')}</ThemedText>
          <ThemedText themeColor="textSecondary">
            {householdName
              ? t('invitation.acceptedNamed', { name: householdName })
              : t('invitation.acceptedGeneric')}
          </ThemedText>
          <Button title={t('invitation.goToAccount')} onPress={() => router.replace('/account')} />
        </Card>
      </Screen>
    );
  }

  if (outcome === 'declined') {
    return (
      <Screen refreshable={false}>
        <Card>
          <ThemedText type="subtitle">{t('invitation.declinedTitle')}</ThemedText>
          <ThemedText themeColor="textSecondary">
            {t('invitation.declinedDescription')}
          </ThemedText>
          <Button title={t('common.goHome')} variant="secondary" onPress={() => router.replace('/')} />
        </Card>
      </Screen>
    );
  }

  return (
    <Screen refreshable={false}>
      <Card>
        <ThemedText type="subtitle">{t('invitation.joinTitle')}</ThemedText>
        <ThemedText themeColor="textSecondary">{t('invitation.joinDescription')}</ThemedText>
        {error ? (
          <ThemedText type="small" style={{ color: theme.danger }}>
            {error}
          </ThemedText>
        ) : null}
        <Button title={t('invitation.accept')} onPress={onAccept} loading={accept.isPending} />
        <Button
          title={t('invitation.decline')}
          variant="secondary"
          onPress={onDecline}
          loading={decline.isPending}
          disabled={accept.isPending}
        />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  loader: {
    marginTop: 64,
  },
});
