import { router, Stack } from 'expo-router';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useT } from '@/lib/i18n';

/** Shown for any URL / deep link that doesn't map to a route. */
export default function NotFoundScreen() {
  const t = useT();
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.content}>
          <ThemedText type="title">{t('notFound.title')}</ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.message}>
            {t('notFound.message')}
          </ThemedText>
          <Button title={t('common.goHome')} onPress={() => router.replace('/')} />
        </SafeAreaView>
      </ThemedView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignSelf: 'center',
    width: '100%',
    maxWidth: MaxContentWidth,
    paddingHorizontal: Spacing.four,
    gap: Spacing.three,
  },
  message: { marginBottom: Spacing.two },
});
