import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Screen } from '@/components/screen';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useT } from '@/lib/i18n';
import { createDinner, useDinners } from '@/lib/store';

export default function DinnersScreen() {
  const t = useT();
  const theme = useTheme();
  const dinners = useDinners();
  const [name, setName] = useState('');

  function onCreate() {
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }
    const id = createDinner({ name: trimmed });
    setName('');
    router.push({ pathname: '/dinners/[id]', params: { id } });
  }

  return (
    <Screen topInset={false}>
      <Card>
        <ThemedText type="smallBold">{t('dinners.newDinner')}</ThemedText>
        <TextField
          label={t('dinners.name')}
          placeholder={t('dinners.namePlaceholder')}
          value={name}
          onChangeText={setName}
          autoCapitalize="sentences"
          returnKeyType="done"
          onSubmitEditing={onCreate}
        />
        <Button title={t('dinners.createAndAdd')} onPress={onCreate} disabled={!name.trim()} />
      </Card>

      {dinners.length > 0 ? (
        <Card>
          {dinners.map((dinner, index) => (
            <Pressable
              key={dinner.id}
              onPress={() => router.push({ pathname: '/dinners/[id]', params: { id: dinner.id } })}
              style={({ pressed }) => [
                styles.row,
                index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
                pressed && styles.pressed,
              ]}>
              <View style={styles.flex}>
                <ThemedText numberOfLines={1}>{dinner.name}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {dinner.default_servings} {t('common.servings')} · {dinner.items.length}{' '}
                  {dinner.items.length === 1 ? t('common.ingredient') : t('common.ingredients')}
                </ThemedText>
              </View>
              <ThemedText type="small" themeColor="textSecondary">
                ›
              </ThemedText>
            </Pressable>
          ))}
        </Card>
      ) : (
        <ThemedText themeColor="textSecondary">{t('dinners.empty')}</ThemedText>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    paddingVertical: Spacing.two,
  },
  flex: {
    flexShrink: 1,
  },
  pressed: {
    opacity: 0.6,
  },
});
