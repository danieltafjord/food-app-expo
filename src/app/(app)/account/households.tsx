import { ActivityIndicator, Alert, StyleSheet, View } from 'react-native';

import { AccountSetupCard } from '@/components/account-setup-card';
import { Badge } from '@/components/badge';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useActiveHousehold, useHouseholds, useSwitchHousehold } from '@/lib/api/households';
import { useMembers } from '@/lib/api/members';
import type { HouseholdRole } from '@/lib/api/types';
import { useTheme } from '@/hooks/use-theme';
import { useT } from '@/lib/i18n';
import { pushOnce } from '@/lib/navigation';
import { SyncPendingError } from '@/lib/sync/engine';

function roleTone(role: HouseholdRole) {
  return role === 'owner' ? 'brand' : 'neutral';
}

export default function HouseholdsScreen() {
  const t = useT();
  const theme = useTheme();
  const households = useHouseholds();
  const { household, role, isOwner } = useActiveHousehold();
  const members = useMembers(!!household);
  const switchHousehold = useSwitchHousehold();

  const roleLabel = (r: HouseholdRole) => (r === 'owner' ? t('common.owner') : t('common.member'));
  const otherHouseholds = (households.data ?? []).filter((h) => h.id !== household?.id);

  return (
    <Screen topInset={false}>
      {household ? (
        <>
          <Card>
            <View style={styles.rowBetween}>
              <ThemedText type="subtitle" style={styles.flex}>
                {household.name}
              </ThemedText>
              {role ? <Badge label={roleLabel(role)} tone={roleTone(role)} /> : null}
            </View>
            {isOwner ? (
              <Button
                title={t('household.rename')}
                variant="secondary"
                size="small"
                onPress={() => pushOnce('/account/rename')}
              />
            ) : null}
            {isOwner ? (
              <Button
                title={t('household.invitePeople')}
                onPress={() => pushOnce('/account/invite')}
              />
            ) : (
              <ThemedText type="small" themeColor="textSecondary">
                {t('household.onlyOwners')}
              </ThemedText>
            )}
          </Card>

          <View style={styles.section}>
            <ThemedText type="smallBold">{t('household.members')}</ThemedText>
            {members.isLoading ? (
              <ActivityIndicator />
            ) : members.isError ? (
              <ThemedText type="small" style={{ color: theme.danger }}>
                {t('household.membersError')}
              </ThemedText>
            ) : (
              <Card>
                {members.data?.map((member, index) => (
                  <View
                    key={member.id}
                    style={[
                      styles.rowBetween,
                      index > 0 && { ...styles.divider, borderTopColor: theme.border },
                    ]}>
                    <View style={styles.flex}>
                      <ThemedText type="default">{member.name}</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        {member.email}
                      </ThemedText>
                    </View>
                    <Badge label={roleLabel(member.role)} tone={roleTone(member.role)} />
                  </View>
                ))}
              </Card>
            )}
          </View>
        </>
      ) : (
        <AccountSetupCard />
      )}

      {otherHouseholds.length > 0 ? (
        <View style={styles.section}>
          <ThemedText type="smallBold">
            {household ? t('household.switchTitle') : t('household.yourHouseholds')}
          </ThemedText>
          <Card>
            {otherHouseholds.map((item, index) => (
              <View
                key={item.id}
                style={[
                  styles.rowBetween,
                  index > 0 && { ...styles.divider, borderTopColor: theme.border },
                ]}>
                <View style={styles.flex}>
                  <ThemedText type="default">{item.name}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {roleLabel(item.role)}
                  </ThemedText>
                </View>
                <Button
                  title={t('household.switch')}
                  size="small"
                  variant="secondary"
                  loading={switchHousehold.isPending && switchHousehold.variables === item.id}
                  // One switch at a time: a second would race the first's data swap.
                  disabled={switchHousehold.isPending}
                  onPress={() =>
                    switchHousehold.mutate(item.id, {
                      onError: (error) => {
                        Alert.alert(
                          t('household.switchTitle'),
                          error instanceof SyncPendingError
                            ? t('household.switchBlockedPending')
                            : error.message,
                        );
                      },
                    })
                  }
                />
              </View>
            ))}
          </Card>
        </View>
      ) : null}

      {household ? (
        <View style={styles.section}>
          <Button
            title={t('household.createAnother')}
            variant="secondary"
            onPress={() => pushOnce('/account/create')}
          />
          <Button
            title={t('household.joinWithLink')}
            variant="secondary"
            onPress={() => pushOnce('/account/join')}
          />
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: Spacing.two,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.three,
  },
  flex: {
    flexShrink: 1,
  },
});
