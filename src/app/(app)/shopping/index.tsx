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
import { createShoppingList, useShoppingLists } from '@/lib/store';

export default function ShoppingListsScreen() {
  const t = useT();
  const theme = useTheme();
  const lists = useShoppingLists();
  const [name, setName] = useState('');

  function onCreate() {
    const id = createShoppingList(name.trim());
    setName('');
    router.push({ pathname: '/shopping/[id]', params: { id } });
  }

  return (
    <Screen topInset={false}>
      <Card>
        <ThemedText type="smallBold">{t('shopping.newList')}</ThemedText>
        <TextField
          label={t('shopping.name')}
          placeholder={t('shopping.namePlaceholder')}
          value={name}
          onChangeText={setName}
          autoCapitalize="sentences"
          returnKeyType="done"
          onSubmitEditing={onCreate}
        />
        <Button title={t('shopping.createList')} onPress={onCreate} />
      </Card>

      <Button
        title={t('shopping.generateCta')}
        variant="secondary"
        onPress={() => router.push('/shopping/generate')}
      />

      {lists.length > 0 ? (
        <Card>
          {lists.map((list, index) => (
            <Pressable
              key={list.id}
              onPress={() => router.push({ pathname: '/shopping/[id]', params: { id: list.id } })}
              style={({ pressed }) => [
                styles.row,
                index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
                pressed && styles.pressed,
              ]}>
              <View style={styles.flex}>
                <ThemedText numberOfLines={1}>{list.name}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {list.item_count === 0
                    ? t('shopping.emptyLabel')
                    : t('shopping.checkedCount', {
                        checked: list.checked_count,
                        total: list.item_count,
                      })}
                </ThemedText>
              </View>
              <ThemedText type="small" themeColor="textSecondary">
                ›
              </ThemedText>
            </Pressable>
          ))}
        </Card>
      ) : (
        <ThemedText themeColor="textSecondary">{t('shopping.empty')}</ThemedText>
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
