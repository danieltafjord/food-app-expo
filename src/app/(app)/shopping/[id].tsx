import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  interpolateColor,
  LayoutAnimationConfig,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { EmptyState } from '@/components/empty-state';
import { Fab } from '@/components/fab';
import { HeaderMenu, MenuAction } from '@/components/header-menu';
import { PresenceBar } from '@/components/presence-bar';
import { RemoteChangeWash } from '@/components/remote-change-wash';
import { Icon } from '@/components/icon';
import { ProgressBar } from '@/components/progress-bar';
import { Screen } from '@/components/screen';
import { SwipeToDelete } from '@/components/swipe-to-delete';
import { ThemedText } from '@/components/themed-text';
import { BadgeColors, Spacing } from '@/constants/theme';
import { useResolvedScheme, useTheme } from '@/hooks/use-theme';
import { CATEGORY_EMOJI } from '@/lib/categorize';
import { formatQuantity } from '@/lib/format';
import { hapticSelection, hapticSuccess } from '@/lib/haptics';
import { useListMute } from '@/lib/api/notifications';
import { useT } from '@/lib/i18n';
import { pushOnce } from '@/lib/navigation';
import { listScope } from '@/lib/realtime/live';
import { usePresence } from '@/lib/realtime/use-presence';
import { updateShoppingListFromPlan, usePlanListDrift } from '@/lib/shopping/generate';
import {
  archiveShoppingList,
  deleteShoppingList,
  removeShoppingItems,
  setShoppingListDensity,
  toggleShoppingItem,
  uncheckAllItems,
  useShoppingItem,
  useShoppingList,
  useShoppingListDensity,
  useShoppingListSections,
  type ShoppingListSections,
} from '@/lib/store';
import { deleteWithUndo, useHiddenIds } from '@/lib/undo';

/** How long a ticked row stays put, showing its check, before it moves to its new section. */
const SETTLE_MS = 450;

const ROW_LAYOUT = LinearTransition.duration(240);
const ROW_ENTER = FadeIn.duration(200);
const ROW_EXIT = FadeOut.duration(150);

/** Leave out rows whose delete is waiting on its Undo window, and recount. */
function withoutHidden(
  value: ShoppingListSections,
  hidden: Record<string, true>,
): ShoppingListSections {
  const sections = value.sections
    .map((section) => ({ ...section, itemIds: section.itemIds.filter((id) => !hidden[id]) }))
    .filter((section) => section.itemIds.length > 0);
  const checkedIds = value.checkedIds.filter((id) => !hidden[id]);
  const unchecked = sections.reduce((count, section) => count + section.itemIds.length, 0);
  return { sections, checkedIds, total: unchecked + checkedIds.length, checked: checkedIds.length };
}

export default function ShoppingListScreen() {
  const t = useT();
  const theme = useTheme();
  const brand = BadgeColors[useResolvedScheme()].brand;
  const params = useLocalSearchParams<{ id: string }>();
  const list = useShoppingList(params.id);
  // Who else in the household has this list open right now.
  const others = usePresence(params.id ? listScope(params.id) : null);
  const mute = useListMute(params.id);
  const compact = useShoppingListDensity() === 'compact';
  const hidden = useHiddenIds();
  const { sections, checkedIds, total, checked } = withoutHidden(
    useShoppingListSections(params.id),
    hidden,
  );
  const allDone = total > 0 && checked === total;

  // A small "done" moment when the last item is ticked — not when a delete or
  // an undo happens to leave only ticked items behind.
  const previous = useRef({ allDone, checked });
  useEffect(() => {
    if (allDone && !previous.current.allDone && checked > previous.current.checked) hapticSuccess();
    previous.current = { allDone, checked };
  }, [allDone, checked]);
  // A list made from a week plan drifts when dinners are added or changed
  // afterwards. Offer to catch up instead of making a second list.
  const drift = usePlanListDrift(params.id, list?.dinner_plan_id);
  const planId = list?.dinner_plan_id;
  const drifted = drift.added > 0 || drift.updated > 0 || drift.removed > 0;

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
  const listName = list.name;

  function onEditItem(itemId: string) {
    pushOnce({ pathname: '/sheets/shopping-item', params: { itemId } });
  }

  function onClearChecked() {
    const ids = checkedIds;
    const message =
      ids.length === 1 ? t('undo.checkedClearedOne') : t('undo.checkedCleared', { count: ids.length });
    deleteWithUndo(message, ids, () => removeShoppingItems(ids));
  }

  function onArchiveList() {
    router.back();
    archiveShoppingList(listId);
  }

  function onDeleteList() {
    router.back();
    deleteWithUndo(t('undo.listDeleted', { name: listName }), [listId], () =>
      deleteShoppingList(listId),
    );
  }

  function onRemoveItem(itemId: string, name: string) {
    deleteWithUndo(t('undo.itemRemoved', { name }), [itemId], () => removeShoppingItems([itemId]));
  }

  return (
    <>
      <Stack.Screen options={{ title: list.name }} />
      <HeaderMenu>
        <MenuAction
          icon="list.bullet"
          onPress={() => setShoppingListDensity(compact ? 'standard' : 'compact')}>
          {t(compact ? 'shopping.useStandardView' : 'shopping.useCompactView')}
        </MenuAction>
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
        {mute.available ? (
          <MenuAction icon={mute.muted ? 'bell' : 'bell.slash'} onPress={mute.toggle}>
            {t(mute.muted ? 'notifications.unmuteList' : 'notifications.muteList')}
          </MenuAction>
        ) : null}
        <MenuAction icon="archivebox" onPress={onArchiveList}>
          {t('shopping.archiveList')}
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
        <PresenceBar members={others} />

        {total > 0 ? (
          <View style={styles.progress}>
            <ThemedText
              type="small"
              themeColor={allDone ? undefined : 'textSecondary'}
              style={allDone ? { color: theme.tint } : undefined}>
              {allDone ? t('shopping.allChecked') : t('shopping.checkedCount', { checked, total })}
            </ThemedText>
            <ProgressBar progress={checked / total} />
          </View>
        ) : null}

        {drifted && planId ? (
          <View style={[styles.banner, { backgroundColor: brand.bg }]}>
            <View style={styles.flex}>
              <ThemedText type="smallBold" style={{ color: brand.fg }}>
                {t('shopping.planChangedTitle')}
              </ThemedText>
              <ThemedText type="small" style={{ color: brand.fg }}>
                {t('shopping.planChangedCounts', { added: drift.added, updated: drift.updated, removed: drift.removed })}
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
          // Rows already on screen when the list opens appear as-is; only rows
          // that arrive later (added, ticked into another section) fade in.
          <LayoutAnimationConfig skipEntering>
            <View style={[styles.sections, compact && styles.compactSections]}>
              {sections.map((section) => (
                <Animated.View
                  key={section.id}
                  layout={ROW_LAYOUT}
                  entering={ROW_ENTER}
                  exiting={ROW_EXIT}
                  style={[styles.section, compact && styles.compactSection]}>
                  <View style={styles.sectionHeader}>
                    <ThemedText style={styles.sectionEmoji}>{CATEGORY_EMOJI[section.id]}</ThemedText>
                    <ThemedText type="smallBold" themeColor="textSecondary">
                      {t(`categories.${section.id}`)}
                    </ThemedText>
                  </View>
                  <View style={[styles.listCard, { backgroundColor: theme.backgroundElement }]}>
                    {section.itemIds.map((itemId, index) => (
                      <ShoppingRow
                        key={itemId}
                        itemId={itemId}
                        first={index === 0}
                        compact={compact}
                        onEdit={onEditItem}
                        onRemove={onRemoveItem}
                      />
                    ))}
                  </View>
                </Animated.View>
              ))}

              {/* Ticked items gather here, out of the way of what's left to buy. */}
              {checkedIds.length > 0 ? (
                <Animated.View
                  layout={ROW_LAYOUT}
                  entering={ROW_ENTER}
                  exiting={ROW_EXIT}
                  style={[styles.section, compact && styles.compactSection]}>
                  <View style={styles.sectionHeader}>
                    <ThemedText type="smallBold" themeColor="textSecondary">
                      {t('shopping.checkedSection')} · {checkedIds.length}
                    </ThemedText>
                  </View>
                  <View style={[styles.listCard, { backgroundColor: theme.backgroundElement }]}>
                    {checkedIds.map((itemId, index) => (
                      <ShoppingRow
                        key={itemId}
                        itemId={itemId}
                        first={index === 0}
                        compact={compact}
                        onEdit={onEditItem}
                        onRemove={onRemoveItem}
                      />
                    ))}
                  </View>
                </Animated.View>
              ) : null}
            </View>
          </LayoutAnimationConfig>
        ) : (
          <EmptyState
            icon="list.bullet"
            title={t('shopping.emptyListTitle')}
            message={t('shopping.tapPlusHint')}
          />
        )}
      </Screen>
    </>
  );
}

type ShoppingRowProps = {
  itemId: string;
  /** First row in its card — no divider above it. */
  first: boolean;
  compact: boolean;
  onEdit: (itemId: string) => void;
  onRemove: (itemId: string, name: string) => void;
};

/**
 * One list row. Tap anywhere to tick it; swipe left for edit and delete.
 * Subscribes to its own item (and only that), so checking or editing one row
 * re-renders that row; the sectioned screen above it only re-renders when rows
 * move between sections or aisles.
 *
 * A tap shows the new state in place first and writes it a moment later
 * ({@link SETTLE_MS}), so the check lands under the finger before the row
 * glides to its new section. A second tap inside that moment takes it back.
 */
function ShoppingRow({ itemId, first, compact, onEdit, onRemove }: ShoppingRowProps) {
  const t = useT();
  const theme = useTheme();
  const item = useShoppingItem(itemId);
  const [pending, setPending] = useState<boolean | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Leaving the screen mid-settle still records the tap.
  useEffect(
    () => () => {
      if (timer.current === null) return;
      clearTimeout(timer.current);
      toggleShoppingItem(itemId);
    },
    [itemId],
  );

  if (!item) return null;

  const label = item.ingredient_name ?? item.name ?? t('common.itemFallback');
  const qty = formatQuantity(item.quantity, item.unit);
  const checked = pending ?? item.is_checked;

  function onPress() {
    hapticSelection();
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
      setPending(null);
      return;
    }
    setPending(!checked);
    timer.current = setTimeout(() => {
      timer.current = null;
      setPending(null);
      toggleShoppingItem(itemId);
    }, SETTLE_MS);
  }

  return (
    <Animated.View layout={ROW_LAYOUT} entering={ROW_ENTER} exiting={ROW_EXIT}>
      <SwipeToDelete
        label={t('common.delete')}
        onDelete={() => onRemove(itemId, label)}
        secondary={{ label: t('a11y.edit'), onPress: () => onEdit(itemId) }}>
        <Pressable
          onPress={onPress}
          accessibilityRole="checkbox"
          accessibilityState={{ checked }}
          accessibilityLabel={qty ? `${label}, ${qty}` : label}
          style={({ pressed }) => [
            styles.itemRow,
            compact && styles.compactItemRow,
            { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
            !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
          ]}>
          {/* Someone else just added, ticked or edited this row. */}
          <RemoteChangeWash id={itemId} />
          <Checkbox checked={checked} compact={compact} />
          <View style={styles.itemText}>
            <ThemedText
              numberOfLines={1}
              themeColor={checked ? 'textSecondary' : undefined}
              style={[compact && styles.compactItemName, checked && styles.checkedText]}>
              {label}
            </ThemedText>
            {qty && !compact ? (
              <ThemedText type="small" themeColor="textSecondary">
                {qty}
              </ThemedText>
            ) : null}
          </View>
          {qty && compact ? (
            <ThemedText type="small" themeColor="textSecondary" style={styles.compactQuantity}>
              {qty}
            </ThemedText>
          ) : null}
        </Pressable>
      </SwipeToDelete>
    </Animated.View>
  );
}

/** A round checkbox that fills with the tint and pops its check mark in. */
function Checkbox({ checked, compact }: { checked: boolean; compact: boolean }) {
  const theme = useTheme();
  const fill = useSharedValue(checked ? 1 : 0);
  const mark = useSharedValue(checked ? 1 : 0);

  useEffect(() => {
    fill.set(withTiming(checked ? 1 : 0, { duration: 160 }));
    mark.set(checked ? withSpring(1, { damping: 15, stiffness: 320 }) : withTiming(0, { duration: 120 }));
  }, [checked, fill, mark]);

  const boxStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(fill.get(), [0, 1], ['transparent', theme.tint]),
    borderColor: interpolateColor(fill.get(), [0, 1], [theme.border, theme.tint]),
  }));
  const markStyle = useAnimatedStyle(() => ({
    opacity: mark.get(),
    transform: [{ scale: 0.4 + mark.get() * 0.6 }],
  }));

  return (
    <Animated.View style={[styles.checkbox, compact && styles.compactCheckbox, boxStyle]}>
      <Animated.View style={markStyle}>
        <Icon name="checkmark" size={12} weight="heavy" color={theme.onTint} />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  progress: {
    gap: Spacing.two,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  sections: {
    gap: Spacing.four,
  },
  compactSections: {
    gap: Spacing.two + Spacing.one,
  },
  section: {
    gap: Spacing.two,
  },
  compactSection: {
    gap: Spacing.one,
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
    gap: Spacing.three,
    minHeight: 52,
    paddingVertical: Spacing.three - Spacing.half,
    paddingHorizontal: Spacing.three,
  },
  compactItemRow: {
    minHeight: 44,
    gap: Spacing.two,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two + Spacing.one,
  },
  itemText: {
    flex: 1,
    minWidth: 0,
  },
  compactItemName: {
    fontSize: 15,
    lineHeight: 20,
  },
  compactQuantity: {
    maxWidth: '40%',
    textAlign: 'right',
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkedText: {
    textDecorationLine: 'line-through',
  },
  compactCheckbox: {
    width: 20,
    height: 20,
    borderRadius: 10,
  },
  flex: {
    flexShrink: 1,
    flexGrow: 1,
  },
});
