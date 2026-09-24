import { Stack } from 'expo-router';

import { useTheme } from '@/hooks/use-theme';
import { useT } from '@/lib/i18n';

// A dinner opened from the plan entry sheet still gets the recipe list
// beneath it, so "back" has somewhere to go.
export const unstable_settings = {
  initialRouteName: 'index',
};

// Dinners tab: a list of recipes that pushes to a per-dinner editor.
export default function DinnersLayout() {
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
      <Stack.Screen name="index" options={{ title: t('dinners.title'), headerLargeTitleEnabled: true }} />
      {/* The editor sets its own title (the dinner's name). */}
      <Stack.Screen name="[id]" options={{ title: '' }} />
    </Stack>
  );
}
