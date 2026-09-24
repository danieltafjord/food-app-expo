import { useValue } from '@legendapp/state/react';
import { router } from 'expo-router';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeOut, LinearTransition } from 'react-native-reanimated';

import { EmptyState } from '@/components/empty-state';
import { HeaderMenu, MenuAction } from '@/components/header-menu';
import { Screen } from '@/components/screen';
import { SwipeToDelete } from '@/components/swipe-to-delete';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatDate } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { pushOnce } from '@/lib/navigation';
import {
  archivedItemCounts,
  deleteArchivedShoppingLists,
  deleteShoppingList,
  restoreShoppingList,
  useArchivedShoppingLists,
} from '@/lib/store';
import { store$ } from '@/lib/store/collections';
import { deleteWithUndo, useHiddenIds } from '@/lib/undo';

const REFLOW = LinearTransition.duration(220);
const EXIT = FadeOut.duration(160);

/**
 * Archived shopping lists. Their items live outside the store (see
 * `@/lib/store/archiving`), so counts come from the archive table. Tapping a
 * list restores it; a device not synced to the cloud can delete them all.
 */
export default function ArchivedListsScreen() {
  const t = useT();
  const theme = useTheme();
  const hidden = useHiddenIds();
  const lists = useArchivedShoppingLists().filter((list) => !hidden[list.id]);
  const linked = useValue(store$.meta.linked);
  const counts = archivedItemCounts();

  function open(id: string) {
    restoreShoppingList(id);
    router.back();
    pushOnce({ pathname: '/shopping/[id]', params: { id } });
  }

  function onDelete(id: string, name: string) {
    deleteWithUndo(t('undo.listDeleted', { name }), [id], () => deleteShoppingList(id));
  }

  function onDeleteAll() {
    Alert.alert(t('shopping.deleteArchived'), t('shopping.deleteArchivedMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: deleteArchivedShoppingLists },
    ]);
  }

  return (
    <>
      {!linked && lists.length > 0 ? (
        <HeaderMenu>
          <MenuAction icon="trash" destructive onPress={onDeleteAll}>
            {t('shopping.deleteArchived')}
          </MenuAction>
        </HeaderMenu>
      ) : null}
      <Screen topInset={false}>
        {lists.length > 0 ? (
          <View style={[styles.listCard, { backgroundColor: theme.backgroundElement }]}>
            {lists.map((list, index) => {
              const count = counts[list.id];
              return (
                <Animated.View key={list.id} layout={REFLOW} exiting={EXIT}>
                  <SwipeToDelete
                    label={t('common.delete')}
                    onDelete={() => onDelete(list.id, list.name)}
                    secondary={{ label: t('shopping.restore'), onPress: () => restoreShoppingList(list.id) }}>
                    <Pressable
                      onPress={() => open(list.id)}
                      accessibilityRole="button"
                      accessibilityHint={t('shopping.restore')}
                      style={({ pressed }) => [
                        styles.row,
                        { backgroundColor: theme.backgroundElement },
                        index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
                        pressed && { backgroundColor: theme.backgroundSelected },
                      ]}>
                      <ThemedText numberOfLines={1}>{list.name}</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        {t('shopping.archivedOn', { date: formatDate(list.archived_at) })}
                        {count ? ` · ${t('shopping.checkedCount', { checked: count.checked, total: count.total })}` : ''}
                      </ThemedText>
                    </Pressable>
                  </SwipeToDelete>
                </Animated.View>
              );
            })}
          </View>
        ) : (
          <EmptyState icon="archivebox" title={t('shopping.archivedEmptyTitle')} message={t('shopping.archivedEmpty')} />
        )}
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  listCard: {
    borderRadius: Spacing.three,
    overflow: 'hidden',
  },
  row: {
    gap: 2,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
  },
});
