import { useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';

import { Badge } from '@/components/badge';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Screen } from '@/components/screen';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ApiError } from '@/lib/api/client';
import { errorMessage } from '@/lib/api/error-message';
import { useActiveHousehold } from '@/lib/api/households';
import { useInvitations, useInviteMember, useRevokeInvitation } from '@/lib/api/invitations';
import type { HouseholdRole, InvitationStatus } from '@/lib/api/types';
import { formatDate } from '@/lib/format';
import { useT, type TKey } from '@/lib/i18n';
import { askForNotificationsOnce } from '@/lib/notifications/native';

const STATUS_TONE: Record<InvitationStatus, 'warning' | 'positive' | 'neutral' | 'danger'> = {
  pending: 'warning',
  accepted: 'positive',
  declined: 'neutral',
  expired: 'danger',
};

const STATUS_KEY: Record<InvitationStatus, TKey> = {
  pending: 'status.pending',
  accepted: 'status.accepted',
  declined: 'status.declined',
  expired: 'status.expired',
};

export default function InviteScreen() {
  const t = useT();
  const theme = useTheme();
  const { isOwner } = useActiveHousehold();
  const invitations = useInvitations(isOwner);
  const inviteMember = useInviteMember();
  const revokeInvitation = useRevokeInvitation();

  const [email, setEmail] = useState('');
  const [role, setRole] = useState<HouseholdRole>('member');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  // "Invitation sent to …", until the next send or edit.
  const [sentTo, setSentTo] = useState<string | null>(null);

  const roleLabel = (r: HouseholdRole) => (r === 'owner' ? t('common.owner') : t('common.member'));

  if (!isOwner) {
    return (
      <Screen topInset={false} refreshable={false}>
        <Card>
          <ThemedText type="subtitle">{t('invite.ownersOnly')}</ThemedText>
          <ThemedText themeColor="textSecondary">{t('invite.ownersOnlyDescription')}</ThemedText>
        </Card>
      </Screen>
    );
  }

  async function onInvite() {
    const trimmed = email.trim();
    // The return key can fire again while the request is still in flight.
    if (!trimmed || inviteMember.isPending) {
      return;
    }
    setFieldError(null);
    setFormError(null);
    setSentTo(null);
    try {
      await inviteMember.mutateAsync({ email: trimmed, role });
      setEmail('');
      setSentTo(trimmed);
      AccessibilityInfo.announceForAccessibility(t('invite.sent', { email: trimmed }));
      // Sharing the household is when notifications start to matter.
      void askForNotificationsOnce();
    } catch (err) {
      if (err instanceof ApiError && err.isValidation) {
        setFieldError(err.errors?.email?.[0] ?? null);
        if (!err.errors?.email) {
          setFormError(errorMessage(err, t, 'invite.sendError'));
        }
      } else {
        setFormError(errorMessage(err, t, 'invite.sendError'));
      }
    }
  }

  function onRevoke(id: number) {
    revokeInvitation.mutate(id, {
      onError: (err) => Alert.alert(t('invite.revokeError'), errorMessage(err, t)),
    });
  }

  return (
    <Screen topInset={false} refreshable={false}>
      <Card>
        <TextField
          label={t('invite.emailAddress')}
          placeholder={t('invite.emailPlaceholder')}
          value={email}
          onChangeText={(value) => {
            setEmail(value);
            setSentTo(null);
          }}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          inputMode="email"
          returnKeyType="send"
          onSubmitEditing={onInvite}
          error={fieldError}
        />

        <View style={styles.roleRow}>
          <ThemedText type="smallBold">{t('invite.role')}</ThemedText>
          <View style={styles.segment} accessibilityRole="radiogroup" accessibilityLabel={t('invite.role')}>
            <RoleOption
              label={roleLabel('member')}
              active={role === 'member'}
              onPress={() => setRole('member')}
            />
            <RoleOption
              label={roleLabel('owner')}
              active={role === 'owner'}
              onPress={() => setRole('owner')}
            />
          </View>
        </View>

        {formError ? (
          <ThemedText type="small" style={{ color: theme.danger }}>
            {formError}
          </ThemedText>
        ) : null}
        {sentTo ? (
          <ThemedText type="small" themeColor="textSecondary">
            {t('invite.sent', { email: sentTo })}
          </ThemedText>
        ) : null}

        <Button
          title={t('invite.sendInvite')}
          onPress={onInvite}
          loading={inviteMember.isPending}
          disabled={!email.trim()}
        />
        <ThemedText type="small" themeColor="textSecondary">
          {t('invite.emailHint')}
        </ThemedText>
      </Card>

      <View style={styles.section}>
        <ThemedText type="smallBold">{t('invite.invitations')}</ThemedText>
        {invitations.isLoading ? (
          <ActivityIndicator />
        ) : invitations.isError ? (
          <ThemedText type="small" style={{ color: theme.danger }}>
            {t('invite.invitationsError')}
          </ThemedText>
        ) : invitations.data && invitations.data.length > 0 ? (
          <Card>
            {invitations.data.map((invitation, index) => (
              <View
                key={invitation.id}
                style={[
                  styles.inviteRow,
                  index > 0 && { ...styles.divider, borderTopColor: theme.border },
                ]}>
                <View style={styles.flex}>
                  <ThemedText type="default">{invitation.email}</ThemedText>
                  <View style={styles.metaRow}>
                    <Badge
                      label={t(STATUS_KEY[invitation.status])}
                      tone={STATUS_TONE[invitation.status]}
                    />
                    <ThemedText type="small" themeColor="textSecondary">
                      {roleLabel(invitation.role)}
                      {invitation.status === 'pending' && invitation.expires_at
                        ? ` · ${t('invite.expires', { date: formatDate(invitation.expires_at) })}`
                        : ''}
                    </ThemedText>
                  </View>
                </View>
                {invitation.status === 'pending' ? (
                  <Button
                    title={t('invite.revoke')}
                    size="small"
                    variant="secondary"
                    loading={
                      revokeInvitation.isPending && revokeInvitation.variables === invitation.id
                    }
                    onPress={() => onRevoke(invitation.id)}
                  />
                ) : null}
              </View>
            ))}
          </Card>
        ) : (
          <ThemedText type="small" themeColor="textSecondary">
            {t('invite.noInvitations')}
          </ThemedText>
        )}
      </View>
    </Screen>
  );
}

function RoleOption({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: active, selected: active }}
      accessibilityLabel={label}
      style={({ pressed }) => pressed && styles.pressed}>
      <ThemedView
        type={active ? 'backgroundSelected' : 'background'}
        style={[styles.roleOption, active && { borderWidth: 1, borderColor: theme.tint }]}>
        <ThemedText type="small" themeColor={active ? 'text' : 'textSecondary'}>
          {label}
        </ThemedText>
      </ThemedView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: Spacing.two,
  },
  roleRow: {
    gap: Spacing.one,
  },
  segment: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  // At least 44pt tall, the minimum comfortable tap target.
  roleOption: {
    minHeight: 44,
    justifyContent: 'center',
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.four,
    borderRadius: Spacing.two,
  },
  inviteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginTop: Spacing.half,
    flexWrap: 'wrap',
  },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.three,
  },
  flex: {
    flexShrink: 1,
  },
  pressed: {
    opacity: 0.7,
  },
});
