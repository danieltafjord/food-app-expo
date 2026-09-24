import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeOut, LinearTransition } from 'react-native-reanimated';

import { useDeferredTab } from '@/hooks/use-deferred-tab';
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
  useArchivedShoppingLists,
  useShoppingList,
  useShoppingListCounts,
  useShoppingListIds,
} from '@/lib/store';
import { deleteWithUndo, useHiddenIds } from '@/lib/undo';
import { toDateKey } from '@/lib/week';

const REFLOW = LinearTransition.duration(220);
const EXIT = FadeOut.duration(160);

/** Built when the tab is first shown, or once launch has settled — see `useDeferredTab`. */
export default function ShoppingListsScreen() {
  return useDeferredTab() ? <ShoppingListsScreenContent /> : null;
}

function ShoppingListsScreenContent() {
  const t = useT();
  const theme = useTheme();
  const hidden = useHiddenIds();
  const listIds = useShoppingListIds().filter((id) => !hidden[id]);
  const archivedCount = useArchivedShoppingLists().length;

  // No naming step: a new list gets today's date as its name and opens at
  // once. It can be renamed from the list's menu.
  function openCreate() {
    const name = `${t('shopping.defaultListName')} ${formatDay(toDateKey(new Date()))}`;
    const id = createShoppingList(name);
    pushOnce({ pathname: '/shopping/[id]', params: { id } });
  }

  return (
    <Screen
      topInset={false}
      overlay={<Fab accessibilityLabel={t('shopping.newList')} onPress={openCreate} />}>
      {listIds.length > 0 ? (
        <View style={[styles.listCard, { backgroundColor: theme.backgroundElement }]}>
          {listIds.map((id, index) => (
            <Animated.View key={id} layout={REFLOW} exiting={EXIT}>
              <ShoppingListRow id={id} first={index === 0} />
            </Animated.View>
          ))}
        </View>
      ) : (
        <EmptyState icon="cart" title={t('shopping.emptyTitle')} message={t('shopping.empty')} />
      )}
      {archivedCount > 0 ? (
        <Pressable
          onPress={() => pushOnce({ pathname: '/shopping/archived' })}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.row,
            styles.archivedRow,
            { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
          ]}>
          <Icon name="archivebox" size={15} color={theme.textSecondary} />
          <ThemedText style={styles.flex}>{t('shopping.archivedLists')}</ThemedText>
          <ThemedText themeColor="textSecondary">{archivedCount}</ThemedText>
          <Icon name="chevron.right" size={13} color={theme.textSecondary} />
        </Pressable>
      ) : null}
    </Screen>
  );
}

/** One list; subscribes to its own name and counts only. */
function ShoppingListRow({ id, first }: { id: string; first: boolean }) {
  const t = useT();
  const theme = useTheme();
  const list = useShoppingList(id);
  const { itemCount, checkedCount } = useShoppingListCounts(id);
  if (!list) return null;
  const complete = itemCount > 0 && checkedCount === itemCount;

  function onDelete() {
    deleteWithUndo(t('undo.listDeleted', { name: list!.name }), [id], () => deleteShoppingList(id));
  }

  return (
    <SwipeToDelete label={t('common.delete')} onDelete={onDelete}>
      <Pressable
        onPress={() => pushOnce({ pathname: '/shopping/[id]', params: { id } })}
        accessibilityRole="button"
        style={({ pressed }) => [
          styles.row,
          { backgroundColor: theme.backgroundElement },
          !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
          pressed && { backgroundColor: theme.backgroundSelected },
        ]}>
        <View style={styles.flex}>
          <ThemedText numberOfLines={1}>{list.name}</ThemedText>
          <ThemedText
            type="small"
            style={complete ? { color: theme.tint } : undefined}
            themeColor={complete ? undefined : 'textSecondary'}>
            {itemCount === 0
              ? t('shopping.emptyLabel')
              : complete
                ? t('shopping.allChecked')
                : t('shopping.checkedCount', { checked: checkedCount, total: itemCount })}
          </ThemedText>
        </View>
        <Icon name="chevron.right" size={13} color={theme.textSecondary} />
      </Pressable>
    </SwipeToDelete>
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
    flexGrow: 1,
  },
  archivedRow: {
    marginTop: Spacing.four,
    borderRadius: Spacing.three,
  },
});
