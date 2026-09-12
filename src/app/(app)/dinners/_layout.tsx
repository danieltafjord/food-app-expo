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
        contentStyle: { backgroundColor: theme.background },
      }}>
      <Stack.Screen name="index" options={{ title: t('dinners.title') }} />
      {/* The editor sets its own title (the dinner's name). */}
      <Stack.Screen name="[id]" options={{ title: '' }} />
    </Stack>
  );
}
