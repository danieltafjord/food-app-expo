import { Stack } from 'expo-router';

import { useTheme } from '@/hooks/use-theme';
import { useT } from '@/lib/i18n';

// Account tab: settings + a compact household summary that pushes to management
// and the create / join / invite sub-screens.
export default function AccountLayout() {
  const theme = useTheme();
  const t = useT();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.background },
        headerTintColor: theme.text,
        headerShadowVisible: false,
        headerLargeStyle: { backgroundColor: theme.background },
        headerLargeTitleShadowVisible: false,
        contentStyle: { backgroundColor: theme.background },
      }}>
      {/* Tab roots get the large iOS title that collapses as the page scrolls. */}
      <Stack.Screen name="index" options={{ title: t('account.title'), headerLargeTitleEnabled: true }} />
      <Stack.Screen name="households" options={{ title: t('household.householdsTitle') }} />
      <Stack.Screen name="create" options={{ title: t('household.newHouseholdTitle') }} />
      <Stack.Screen name="rename" options={{ title: t('household.rename') }} />
      <Stack.Screen name="invite" options={{ title: t('invite.title') }} />
      <Stack.Screen name="join" options={{ title: t('household.joinTitle') }} />
    </Stack>
  );
}
