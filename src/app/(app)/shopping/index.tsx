import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeOut, LinearTransition } from 'react-native-reanimated';

import { EmptyState } from '@/components/empty-state';
import { Fab } from '@/components/fab';
import { Icon } from '@/components/icon';
import { Screen } from '@/components/screen';
import { SwipeToDelete } from '@/components/swipe-to-delete';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatDay } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { pushOnce } from '@/lib/navigation';
import {
  createShoppingList,
  deleteShoppingList,
  useShoppingLists,
  type ShoppingListSummary,
} from '@/lib/store';
import { deleteWithUndo, useHiddenIds } from '@/lib/undo';
import { toDateKey } from '@/lib/week';

const REFLOW = LinearTransition.duration(220);
const EXIT = FadeOut.duration(160);

export default function ShoppingListsScreen() {
  const t = useT();
  const theme = useTheme();
  const hidden = useHiddenIds();
  const lists = useShoppingLists().filter((list) => !hidden[list.id]);

  // No naming step: a new list gets today's date as its name and opens at
  // once. It can be renamed from the list's menu.
  function openCreate() {
    const name = `${t('shopping.defaultListName')} ${formatDay(toDateKey(new Date()))}`;
    const id = createShoppingList(name);
    pushOnce({ pathname: '/shopping/[id]', params: { id } });
  }

  function onDelete(list: ShoppingListSummary) {
    deleteWithUndo(t('undo.listDeleted', { name: list.name }), [list.id], () =>
      deleteShoppingList(list.id),
    );
  }

  return (
    <Screen
      topInset={false}
      overlay={<Fab accessibilityLabel={t('shopping.newList')} onPress={openCreate} />}>
      {lists.length > 0 ? (
        <View style={[styles.listCard, { backgroundColor: theme.backgroundElement }]}>
          {lists.map((list, index) => {
            const complete = list.item_count > 0 && list.checked_count === list.item_count;
            return (
              <Animated.View key={list.id} layout={REFLOW} exiting={EXIT}>
                <SwipeToDelete
                  label={t('common.delete')}
                  onDelete={() => onDelete(list)}>
                  <Pressable
                    onPress={() => pushOnce({ pathname: '/shopping/[id]', params: { id: list.id } })}
                    accessibilityRole="button"
                    style={({ pressed }) => [
                      styles.row,
                      { backgroundColor: theme.backgroundElement },
                      index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
                      pressed && { backgroundColor: theme.backgroundSelected },
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
                    <Icon name="chevron.right" size={13} color={theme.textSecondary} />
                  </Pressable>
                </SwipeToDelete>
              </Animated.View>
            );
          })}
        </View>
      ) : (
        <EmptyState icon="cart" title={t('shopping.emptyTitle')} message={t('shopping.empty')} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
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
  flex: {
    flexShrink: 1,
  },
});
