import { router, useNavigation } from 'expo-router';
import { useEffect } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { Fab } from '@/components/fab';
import { Screen } from '@/components/screen';
import { SwipeToDelete } from '@/components/swipe-to-delete';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useT } from '@/lib/i18n';
import { deleteShoppingList, useShoppingLists } from '@/lib/store';

export default function ShoppingListsScreen() {
  const t = useT();
  const theme = useTheme();
  const navigation = useNavigation();
  const lists = useShoppingLists();

  // A compact "Generate" action lives in the header, out of the list's way.
  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('shopping.generateShort')}
          hitSlop={8}
          onPress={() => router.push('/shopping/generate')}
          style={({ pressed }) => [styles.headerAction, pressed && styles.pressed]}>
          <ThemedText type="smallBold" style={{ color: theme.tint }}>
            {t('shopping.generateShort')}
          </ThemedText>
        </Pressable>
      ),
    });
  }, [navigation, t, theme]);

  // Naming a new list happens in a native sheet (root route) that opens the list.
  function openCreate() {
    router.push('/sheets/new-list');
  }

  function confirmDelete(id: string) {
    Alert.alert(t('shopping.deleteListTitle'), t('shopping.deleteListMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: () => deleteShoppingList(id) },
    ]);
  }

  return (
    <>
      <Screen
        topInset={false}
        overlay={<Fab accessibilityLabel={t('shopping.newList')} onPress={openCreate} />}>
        {lists.length > 0 ? (
          <View style={[styles.listCard, { backgroundColor: theme.backgroundElement }]}>
            {lists.map((list, index) => {
              const complete = list.item_count > 0 && list.checked_count === list.item_count;
              return (
                <SwipeToDelete
                  key={list.id}
                  label={t('common.delete')}
                  onDelete={() => confirmDelete(list.id)}>
                  <Pressable
                    onPress={() => router.push({ pathname: '/shopping/[id]', params: { id: list.id } })}
                    style={({ pressed }) => [
                      styles.row,
                      { backgroundColor: theme.backgroundElement },
                      index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
                      pressed && styles.pressed,
                    ]}>
                    <View style={styles.flex}>
                      <ThemedText numberOfLines={1}>{list.name}</ThemedText>
                      <ThemedText
                        type="small"
                        style={complete ? { color: theme.tint } : undefined}
                        themeColor={complete ? undefined : 'textSecondary'}>
                        {list.item_count === 0
                          ? t('shopping.emptyLabel')
                          : complete
                            ? t('shopping.allChecked')
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
                </SwipeToDelete>
              );
            })}
          </View>
        ) : (
          <View style={styles.empty}>
            <ThemedText type="subtitle">{t('shopping.emptyTitle')}</ThemedText>
            <ThemedText themeColor="textSecondary">{t('shopping.empty')}</ThemedText>
          </View>
        )}
      </Screen>

    </>
  );
}

const styles = StyleSheet.create({
  headerAction: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
  listCard: {
    borderRadius: Spacing.three,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
  },
  empty: {
    gap: Spacing.two,
    paddingTop: Spacing.five,
  },
  flex: {
    flexShrink: 1,
  },
  pressed: {
    opacity: 0.6,
  },
});
