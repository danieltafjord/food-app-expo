import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Fab } from '@/components/fab';
import { HeaderMenu, MenuAction } from '@/components/header-menu';
import { Screen } from '@/components/screen';
import { SwipeToDelete } from '@/components/swipe-to-delete';
import { ThemedText } from '@/components/themed-text';
import { BadgeColors, Spacing } from '@/constants/theme';
import { useResolvedScheme, useTheme } from '@/hooks/use-theme';
import { CATEGORY_EMOJI } from '@/lib/categorize';
import { formatQuantity } from '@/lib/format';
import { hapticSelection } from '@/lib/haptics';
import { useT } from '@/lib/i18n';
import { pushOnce } from '@/lib/navigation';
import { updateShoppingListFromPlan, usePlanListDrift } from '@/lib/shopping/generate';
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
  const brand = BadgeColors[useResolvedScheme()].brand;
  const params = useLocalSearchParams<{ id: string }>();
  const list = useShoppingList(params.id);
  const { sections, checkedIds, total, checked } = useShoppingListSections(params.id);
  // A list made from a week plan drifts when dinners are added or changed
  // afterwards. Offer to catch up instead of making a second list.
  const drift = usePlanListDrift(params.id, list?.dinner_plan_id);
  const planId = list?.dinner_plan_id;
  const drifted = drift.added > 0 || drift.updated > 0;

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
    pushOnce({ pathname: '/sheets/shopping-item', params: { itemId } });
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
    <>
      <Stack.Screen options={{ title: list.name }} />
      <HeaderMenu>
        <MenuAction
          icon="pencil"
          onPress={() => pushOnce({ pathname: '/sheets/rename-list', params: { listId } })}>
          {t('shopping.renameList')}
        </MenuAction>
        <MenuAction icon="circle" disabled={checked === 0} onPress={() => uncheckAllItems(listId)}>
          {t('shopping.uncheckAll')}
        </MenuAction>
        <MenuAction icon="checkmark.circle" disabled={checked === 0} onPress={onClearChecked}>
          {t('shopping.clearChecked')}
        </MenuAction>
        <MenuAction icon="trash" destructive onPress={onDeleteList}>
          {t('shopping.deleteList')}
        </MenuAction>
      </HeaderMenu>

      <Screen
        topInset={false}
        overlay={
          <Fab
            accessibilityLabel={t('shopping.addItems')}
            onPress={() => pushOnce({ pathname: '/shopping/add', params: { listId } })}
          />
        }>
        <ThemedText type="small" themeColor="textSecondary">
          {total === 0 ? t('shopping.emptyList') : t('shopping.checkedCount', { checked, total })}
        </ThemedText>

        {drifted && planId ? (
          <View style={[styles.banner, { backgroundColor: brand.bg }]}>
            <View style={styles.flex}>
              <ThemedText type="smallBold" style={{ color: brand.fg }}>
                {t('shopping.planChangedTitle')}
              </ThemedText>
              <ThemedText type="small" style={{ color: brand.fg }}>
                {t('shopping.planChangedCounts', { added: drift.added, updated: drift.updated })}
                {' · '}
                {t('shopping.planChangedMessage')}
              </ThemedText>
            </View>
            <Button
              title={t('shopping.updateFromPlan')}
              size="small"
              onPress={() => updateShoppingListFromPlan(listId, planId)}
            />
          </View>
        ) : null}

        {total > 0 ? (
          <>
            {sections.map((section) => (
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
            ))}

            {/* Ticked items gather here, out of the way of what's left to buy. */}
            {checkedIds.length > 0 ? (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <ThemedText type="smallBold" themeColor="textSecondary">
                    {t('shopping.checkedSection')} · {checkedIds.length}
                  </ThemedText>
                </View>
                <View style={[styles.listCard, styles.checkedCard, { backgroundColor: theme.backgroundElement }]}>
                  {checkedIds.map((itemId, index) => (
                    <ShoppingRow key={itemId} itemId={itemId} first={index === 0} onEdit={onEditItem} />
                  ))}
                </View>
              </View>
            ) : null}
          </>
        ) : (
          <Card>
            <ThemedText themeColor="textSecondary">{t('shopping.tapPlusHint')}</ThemedText>
          </Card>
        )}
      </Screen>
    </>
  );
}

type ShoppingRowProps = {
  itemId: string;
  /** First row in its card — no divider above it. */
  first: boolean;
  onEdit: (itemId: string) => void;
};

/**
 * One list row. Tap anywhere to tick it; swipe left for edit and delete.
 * Subscribes to its own item (and only that), so checking or editing one row
 * re-renders that row; the sectioned screen above it only re-renders when rows
 * move between sections or aisles.
 */
function ShoppingRow({ itemId, first, onEdit }: ShoppingRowProps) {
  const t = useT();
  const theme = useTheme();
  const item = useShoppingItem(itemId);
  if (!item) return null;

  const label = item.ingredient_name ?? item.name ?? t('common.itemFallback');
  const qty = formatQuantity(item.quantity, item.unit);
  return (
    <SwipeToDelete
      label={t('common.delete')}
      onDelete={() => removeShoppingItem(item.id)}
      secondary={{ label: t('a11y.edit'), onPress: () => onEdit(item.id) }}>
      <Pressable
        onPress={() => {
          hapticSelection();
          toggleShoppingItem(item.id);
        }}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: item.is_checked }}
        accessibilityLabel={label}
        style={[
          styles.itemRow,
          { backgroundColor: theme.backgroundElement },
          !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
        ]}>
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
    </SwipeToDelete>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Spacing.three,
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
  checkedCard: {
    opacity: 0.7,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
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
  flex: {
    flexShrink: 1,
    flexGrow: 1,
  },
});
