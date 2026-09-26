import { useDeferredTab } from '@/hooks/use-deferred-tab';
import { useDinnerCategoryLabel } from '@/lib/store/dinner-categories';
import { useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { EmptyState } from '@/components/empty-state';
import { DinnerCategorySelect } from '@/components/dinner-category-select';
import { DinnerImage } from '@/components/dinner-image';
import { Icon } from '@/components/icon';
import { SwipeToDelete } from '@/components/swipe-to-delete';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BadgeColors, BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useSyncRefresh } from '@/hooks/use-sync-refresh';
import { useResolvedScheme, useTheme } from '@/hooks/use-theme';
import { dinnerCategory, searchDinners, type DinnerCategoryFilter } from '@/lib/dinner-categories';
import { useT } from '@/lib/i18n';
import { pushOnce } from '@/lib/navigation';
import { indexByName } from '@/lib/search';
import { createDinner, deleteDinner, useDinners, type DinnerWithItems } from '@/lib/store';
import { deleteWithUndo, useHiddenIds } from '@/lib/undo';

const REVEAL = FadeIn.duration(160);
const THUMB = 40;

/**
 * The recipe list: one search field that also creates (a name that doesn't
 * exist yet shows a "Create" row, and the return key makes and opens it), a
 * filter icon for categories, and plain rows that open the editor. A
 * virtualised `FlatList` rather than the
 * shared `Screen` ScrollView: this is the one list that grows without bound.
 */
/** Built when the tab is first shown, or once launch has settled — see `useDeferredTab`. */
export default function DinnersScreen() {
  return useDeferredTab() ? <DinnersScreenContent /> : null;
}

function DinnersScreenContent() {
  const t = useT();
  const categoryLabel = useDinnerCategoryLabel();
  const theme = useTheme();
  const hidden = useHiddenIds();
  const allDinners = useDinners();
  const dinners = useMemo(
    () => allDinners.filter((dinner) => !hidden[dinner.id]),
    [allDinners, hidden],
  );
  const { refreshing, onRefresh } = useSyncRefresh();
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<DinnerCategoryFilter>('all');
  // One create per typed name — a "done" + tap double-fire would otherwise
  // create two dinners with the same name.
  const created = useRef(false);

  const index = useMemo(() => indexByName(dinners, (dinner) => dinner.name), [dinners]);
  const trimmed = query.trim();
  const { results, exact } = useMemo(() => searchDinners(index, trimmed, categoryFilter), [index, trimmed, categoryFilter]);
  const newCategory = dinnerCategory(categoryFilter);
  // A row above the list only when the list can't do the job itself: the
  // typed name is new, or its dinner is hidden by the category filter.
  const action = !trimmed ? null : !exact ? 'create'
    : results.some((dinner) => dinner.id === exact.id) ? null : 'open';
  const actionCategory = action === 'create' ? newCategory : dinnerCategory(exact?.category);

  function openDinner(id: string) {
    pushOnce({ pathname: '/dinners/[id]', params: { id } });
  }

  function onCreate() {
    if (!trimmed || exact || created.current) return;
    created.current = true;
    const id = createDinner({ name: trimmed, category: newCategory });
    setQuery('');
    openDinner(id);
  }

  // The return key opens a dinner that already has the typed name, or creates it.
  function onSubmit() {
    if (exact) {
      setQuery('');
      openDinner(exact.id);
    } else {
      onCreate();
    }
  }

  function onDelete(dinner: DinnerWithItems) {
    deleteWithUndo(t('undo.dinnerDeleted', { name: dinner.name }), [dinner.id], () =>
      deleteDinner(dinner.id),
    );
  }

  return (
    <ThemedView style={styles.flex}>
      <FlatList
        data={results}
        keyExtractor={(dinner) => dinner.id}
        renderItem={({ item, index: i }) => (
          <DinnerRow
            dinner={item}
            first={i === 0}
            last={i === results.length - 1}
            onPress={openDinner}
            onDelete={onDelete}
          />
        )}
        keyboardShouldPersistTaps="handled"
        // No automaticallyAdjustKeyboardInsets: under the large title it
        // scrolled the search field out of sight on focus, and a drag closes
        // the keyboard anyway, so there's nothing to scroll to above it.
        keyboardDismissMode="on-drag"
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.searchRow}>
              <View style={[styles.search, { backgroundColor: theme.backgroundElement }]}>
                <Icon name="magnifyingglass" size={15} color={theme.textSecondary} />
                <TextInput
                  accessibilityLabel={t('dinners.searchOrCreate')}
                  placeholder={t('dinners.searchPlaceholder')}
                  placeholderTextColor={theme.textSecondary}
                  value={query}
                  onChangeText={(text) => {
                    created.current = false;
                    setQuery(text);
                  }}
                  maxLength={255}
                  autoCapitalize="sentences"
                  autoCorrect={false}
                  returnKeyType="done"
                  submitBehavior="submit"
                  onSubmitEditing={onSubmit}
                  style={[styles.searchInput, { color: theme.text }]}
                />
                {query ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('dinners.clearSearch')}
                    hitSlop={10}
                    onPress={() => setQuery('')}>
                    <Icon name="xmark.circle.fill" size={17} color={theme.textSecondary} />
                  </Pressable>
                ) : null}
              </View>
              <DinnerCategorySelect filter variant="icon" value={categoryFilter} onChange={setCategoryFilter} />
            </View>
            {categoryFilter !== 'all' ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${categoryLabel(categoryFilter)}. ${t('dinnerCategories.clearFilter')}`}
                onPress={() => setCategoryFilter('all')}
                style={({ pressed }) => [styles.filterChip, { backgroundColor: theme.backgroundSelected }, pressed && styles.pressed]}>
                <ThemedText type="smallBold">{categoryLabel(categoryFilter)}</ThemedText>
                <Icon name="xmark" size={10} weight="bold" color={theme.textSecondary} />
              </Pressable>
            ) : null}
            {action ? (
              <Animated.View key={action} entering={REVEAL}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityHint={t(action === 'create' ? 'dinners.createHint' : 'dinners.openHint')}
                  onPress={onSubmit}
                  style={({ pressed }) => [styles.action, { backgroundColor: theme.backgroundElement },
                    pressed && { backgroundColor: theme.backgroundSelected }]}>
                  <View style={[styles.actionGlyph,
                    { backgroundColor: action === 'create' ? theme.accent : theme.backgroundSelected }]}>
                    <Icon
                      name={action === 'create' ? 'plus' : 'chevron.right'}
                      size={14}
                      weight="bold"
                      color={action === 'create' ? theme.onAccent : theme.text}
                    />
                  </View>
                  <ThemedText style={styles.flexText} numberOfLines={1}>
                    {t(action === 'create' ? 'dinners.create' : 'dinners.open', { name: trimmed })}
                  </ThemedText>
                  {actionCategory ? (
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.actionCategory}>
                      {categoryLabel(actionCategory)}
                    </ThemedText>
                  ) : null}
                </Pressable>
              </Animated.View>
            ) : null}
          </View>
        }
        // Searching needs no message of its own: the Create row already says
        // what the return key will do, and the filter chip clears the category.
        ListEmptyComponent={
          categoryFilter !== 'all' ? (
            trimmed ? null : <ThemedText themeColor="textSecondary">{t('dinnerCategories.noMatches')}</ThemedText>
          ) : trimmed ? null : (
            <EmptyState icon="fork.knife" title={t('dinners.emptyTitle')} message={t('dinners.empty')} />
          )
        }
        // Rows render as one continuous card: the list itself carries the card
        // surface, and each row draws its own divider.
        style={styles.flex}
      />
    </ThemedView>
  );
}

type DinnerRowProps = {
  dinner: DinnerWithItems;
  first: boolean;
  last: boolean;
  onPress: (id: string) => void;
  onDelete: (dinner: DinnerWithItems) => void;
};

/** Just the picture and the name, plus a warning icon when there's nothing to shop for. */
function DinnerRow({ dinner, first, last, onPress, onDelete }: DinnerRowProps) {
  const t = useT();
  const theme = useTheme();
  const warning = BadgeColors[useResolvedScheme()].warning;
  const empty = dinner.items.length === 0;
  return (
    // Clipped so the sliding row keeps the card's rounded corners.
    <View style={[first && styles.rowFirst, last && styles.rowLast, styles.clip]}>
      <SwipeToDelete label={t('common.delete')} onDelete={() => onDelete(dinner)}>
        <Pressable
          onPress={() => onPress(dinner.id)}
          accessibilityRole="button"
          accessibilityLabel={empty ? `${dinner.name}, ${t('weekBoard.noIngredients')}` : dinner.name}
          style={({ pressed }) => [
            styles.row,
            { backgroundColor: theme.backgroundElement },
            !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
            pressed && { backgroundColor: theme.backgroundSelected },
          ]}>
          <DinnerImage dinnerId={dinner.id} name={dinner.name} size={THUMB} />
          <ThemedText style={styles.flexText} numberOfLines={1}>{dinner.name}</ThemedText>
          {empty ? <Icon name="exclamationmark.triangle.fill" size={13} color={warning.fg} /> : null}
          <Icon name="chevron.right" size={13} color={theme.textSecondary} />
        </Pressable>
      </SwipeToDelete>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  flexText: {
    flexShrink: 1,
    flexGrow: 1,
  },
  pressed: {
    opacity: 0.7,
  },
  content: {
    flexGrow: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.five,
  },
  header: {
    gap: Spacing.three,
    marginBottom: Spacing.three,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  search: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    height: 44,
    borderRadius: Spacing.two + Spacing.one,
    paddingHorizontal: Spacing.three,
  },
  searchInput: {
    flex: 1,
    height: '100%',
    padding: 0,
    fontSize: 16,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: Spacing.two,
    minHeight: 32,
    paddingHorizontal: Spacing.three,
    borderRadius: 999,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    minHeight: 56,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  actionGlyph: {
    width: THUMB,
    height: THUMB,
    borderRadius: Math.round(THUMB * 0.24),
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionCategory: {
    flexShrink: 0,
    maxWidth: '40%',
  },
  clip: {
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    minHeight: 56,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  rowFirst: {
    borderTopLeftRadius: Spacing.three,
    borderTopRightRadius: Spacing.three,
  },
  rowLast: {
    borderBottomLeftRadius: Spacing.three,
    borderBottomRightRadius: Spacing.three,
  },
});
