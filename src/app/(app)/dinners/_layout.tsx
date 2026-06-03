import { Stack } from 'expo-router';

import { useTheme } from '@/hooks/use-theme';
import { useT } from '@/lib/i18n';

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
      <Stack.Screen name="[id]" options={{ title: t('dinners.editTitle') }} />
    </Stack>
  );
}
