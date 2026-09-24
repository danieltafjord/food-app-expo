import { Stack } from 'expo-router';

import { useTheme } from '@/hooks/use-theme';
import { useT } from '@/lib/i18n';

// A list opened from another tab (the Plans header) still gets the lists
// screen beneath it, so "back" has somewhere to go.
export const unstable_settings = {
  initialRouteName: 'index',
};

// Shopping tab: a list of shopping lists that pushes to a per-list checklist.
export default function ShoppingLayout() {
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
      <Stack.Screen name="index" options={{ title: t('shopping.title'), headerLargeTitleEnabled: true }} />
      {/* The list screen sets its own title (the list's name). */}
      <Stack.Screen name="[id]" options={{ title: '' }} />
      <Stack.Screen name="add" options={{ title: t('shopping.addItems') }} />
    </Stack>
  );
}
