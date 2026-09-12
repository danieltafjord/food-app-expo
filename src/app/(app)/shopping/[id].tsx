import { router, useLocalSearchParams } from 'expo-router';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Fab } from '@/components/fab';
import { Screen } from '@/components/screen';
import { SwipeToDelete } from '@/components/swipe-to-delete';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { CATEGORY_EMOJI } from '@/lib/categorize';
import { formatQuantity } from '@/lib/format';
import { hapticSelection } from '@/lib/haptics';
import { useT } from '@/lib/i18n';
import {
  clearCheckedItems,
  deleteShoppingList,
  removeShoppingItem,
  toggleShoppingItem,
  uncheckAllItems,
  useShoppingItem,
  useShoppingList,
  useShoppingListSections,
} from '@/lib/store';

export default function ShoppingListScreen() {
  const t = useT();
  const theme = useTheme();
  const params = useLocalSearchParams<{ id: string }>();
  const list = useShoppingList(params.id);
  const { sections, total, checked } = useShoppingListSections(params.id);

  if (!list) {
    return (
      <Screen topInset={false}>
        <Card>
          <ThemedText type="subtitle">{t('shopping.notFound')}</ThemedText>
          <Button title={t('common.back')} variant="secondary" onPress={() => router.back()} />
        </Card>
      </Screen>
    );
  }

  const listId = list.id;

  function onEditItem(itemId: string) {
    router.push({ pathname: '/sheets/shopping-item', params: { itemId } });
  }

  function onClearChecked() {
    Alert.alert(t('shopping.clearCheckedTitle'), t('shopping.clearCheckedMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('shopping.clearChecked'), style: 'destructive', onPress: () => clearCheckedItems(listId) },
    ]);
  }

  function onDeleteList() {
    Alert.alert(t('shopping.deleteListTitle'), t('shopping.deleteListMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () => {
          deleteShoppingList(listId);
          router.back();
        },
      },
    ]);
  }

  return (
    <Screen
      topInset={false}
      overlay={
        <Fab
          accessibilityLabel={t('shopping.addItems')}
          onPress={() => router.push({ pathname: '/shopping/add', params: { listId } })}
        />
      }>
      <View style={styles.heading}>
        <ThemedText type="subtitle">{list.name}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {total === 0 ? t('shopping.emptyList') : t('shopping.checkedCount', { checked, total })}
        </ThemedText>
      </View>

      {checked > 0 ? (
        <View style={styles.actionsRow}>
          <Button
            title={t('shopping.uncheckAll')}
            variant="secondary"
            size="small"
            onPress={() => uncheckAllItems(listId)}
          />
          <Button
            title={t('shopping.clearChecked')}
            variant="secondary"
            size="small"
            onPress={onClearChecked}
          />
        </View>
      ) : null}

      {total > 0 ? (
        sections.map((section) => (
          <View key={section.id} style={styles.section}>
            <View style={styles.sectionHeader}>
              <ThemedText style={styles.sectionEmoji}>{CATEGORY_EMOJI[section.id]}</ThemedText>
              <ThemedText type="smallBold" themeColor="textSecondary">
                {t(`categories.${section.id}`)}
              </ThemedText>
            </View>
            <View style={[styles.listCard, { backgroundColor: theme.backgroundElement }]}>
              {section.itemIds.map((itemId, index) => (
                <ShoppingRow key={itemId} itemId={itemId} first={index === 0} onEdit={onEditItem} />
              ))}
            </View>
          </View>
        ))
      ) : (
        <Card>
          <ThemedText themeColor="textSecondary">{t('shopping.tapPlusHint')}</ThemedText>
        </Card>
      )}

      <Button
        title={t('shopping.deleteList')}
        variant="secondary"
        size="small"
        onPress={onDeleteList}
      />
    </Screen>
  );
}

type ShoppingRowProps = {
  itemId: string;
  /** First row in its aisle card — no divider above it. */
  first: boolean;
  onEdit: (itemId: string) => void;
};

/**
 * One list row. Subscribes to its own item (and only that), so checking or
 * editing one row re-renders that row; the sectioned screen above it only
 * re-renders when rows move between sections or aisles.
 */
function ShoppingRow({ itemId, first, onEdit }: ShoppingRowProps) {
  const t = useT();
  const theme = useTheme();
  const item = useShoppingItem(itemId);
  if (!item) return null;

  const label = item.ingredient_name ?? item.name ?? t('common.itemFallback');
  const qty = formatQuantity(item.quantity, item.unit);
  return (
    <SwipeToDelete label={t('common.delete')} onDelete={() => removeShoppingItem(item.id)}>
      <View
        style={[
          styles.itemRow,
          { backgroundColor: theme.backgroundElement },
          !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
        ]}>
        <Pressable
          onPress={() => {
            hapticSelection();
            toggleShoppingItem(item.id);
          }}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: item.is_checked }}
          accessibilityLabel={label}
          hitSlop={4}
          style={styles.itemMain}>
          <View
            style={[
              styles.checkbox,
              { borderColor: theme.border },
              item.is_checked && { backgroundColor: theme.tint, borderColor: theme.tint },
            ]}>
            {item.is_checked ? (
              <ThemedText style={[styles.check, { color: theme.onTint }]}>✓</ThemedText>
            ) : null}
          </View>
          <View style={styles.flex}>
            <ThemedText numberOfLines={1} style={item.is_checked ? styles.checkedText : undefined}>
              {label}
            </ThemedText>
            {qty ? (
              <ThemedText type="small" themeColor="textSecondary">
                {qty}
              </ThemedText>
            ) : null}
          </View>
        </Pressable>
        <Pressable
          onPress={() => onEdit(item.id)}
          accessibilityRole="button"
          accessibilityLabel={t('a11y.editItem', { name: label })}
          hitSlop={8}
          style={styles.editButton}>
          <ThemedText type="subtitle" themeColor="textSecondary">
            ⋯
          </ThemedText>
        </Pressable>
      </View>
    </SwipeToDelete>
  );
}

const styles = StyleSheet.create({
  heading: {
    gap: Spacing.half,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    flexWrap: 'wrap',
  },
  section: {
    gap: Spacing.two,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.one,
  },
  sectionEmoji: {
    fontSize: 16,
  },
  listCard: {
    borderRadius: Spacing.three,
    overflow: 'hidden',
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
  },
  itemMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  check: {
    fontWeight: 700,
    fontSize: 14,
    lineHeight: 16,
  },
  checkedText: {
    textDecorationLine: 'line-through',
    opacity: 0.5,
  },
  editButton: {
    paddingHorizontal: Spacing.one,
  },
  flex: {
    flexShrink: 1,
    flexGrow: 1,
  },
});
