import { Stack } from 'expo-router';

import { useTheme } from '@/hooks/use-theme';
import { useT } from '@/lib/i18n';

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
        contentStyle: { backgroundColor: theme.background },
      }}>
      <Stack.Screen name="index" options={{ title: t('shopping.title') }} />
      <Stack.Screen name="[id]" options={{ title: t('shopping.listTitle') }} />
      <Stack.Screen name="generate" options={{ title: t('generate.title') }} />
    </Stack>
  );
}
