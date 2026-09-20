import { useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatQuantity } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { parseItemLine } from '@/lib/parse-line';
import { findExact, indexByName, searchIndex } from '@/lib/search';
import {
  addShoppingItem,
  buildShoppingSuggestions,
  createIngredient,
  getIngredient,
  removeShoppingItem,
  useShoppingList,
  useShoppingListItems,
  type ShoppingSuggestion,
} from '@/lib/store';

/**
 * Listonic-style "add items" screen: search the household's previous items and
 * tap to toggle them on/off the list, or type a new item that doesn't exist yet
 * and add it. A typed line may carry the amount ("2 l melk") — the name part
 * drives the search and the amount lands on the item. Stays open so several
 * items can be added in one pass.
 */
export default function AddShoppingItemsScreen() {
  const t = useT();
  const theme = useTheme();
  const { listId } = useLocalSearchParams<{ listId: string }>();
  const list = useShoppingList(listId);
  const items = useShoppingListItems(listId);
  // The catalogue is built once when the screen opens: it walks every item
  // ever put on a list, and rebuilding (and re-sorting) it after each tap would
  // both cost that scan and shuffle rows under the finger. New entries typed
  // here are appended to the snapshot; on/off state stays live via `items`.
  const [suggestions, setSuggestions] = useState(buildShoppingSuggestions);
  const [query, setQuery] = useState('');

  const parsed = parseItemLine(query);
  const name = parsed.name;
  const hasAmount = parsed.quantity != null || parsed.unit != null;
  const amount = formatQuantity(parsed.quantity, parsed.unit);
  // The same ranked, diacritic- and case-insensitive search as the pickers, so
  // "rodlok" finds "Rødløk" and "ø" finds "Øl".
  const index = useMemo(() => indexByName(suggestions, (s) => s.name), [suggestions]);
  const filtered = useMemo(() => searchIndex(index, name), [index, name]);
  const exact = useMemo(() => findExact(index, name), [index, name]);
  const exactMatch = !!exact;

  const onListIngredientIds = new Set(
    items.map((it) => it.ingredient_id).filter((id): id is string => !!id),
  );
  const onListNames = new Set(
    items.filter((it) => !it.ingredient_id && it.name).map((it) => it.name!.toLowerCase()),
  );
  const isOnList = (s: ShoppingSuggestion) =>
    s.ingredient_id
      ? onListIngredientIds.has(s.ingredient_id)
      : onListNames.has(s.name.toLowerCase());

  /** Add a suggestion, with the typed amount if there is one, else its usual unit. */
  function add(s: ShoppingSuggestion) {
    if (!listId) return;
    const base = hasAmount
      ? { quantity: parsed.quantity, unit: parsed.unit ?? s.default_unit }
      : { unit: s.default_unit };
    if (s.ingredient_id) {
      addShoppingItem(listId, { ingredient_id: s.ingredient_id, ...base });
    } else {
      addShoppingItem(listId, { name: s.name, ...base });
    }
  }

  function toggle(s: ShoppingSuggestion) {
    if (!listId) return;
    const existing = s.ingredient_id
      ? items.filter((it) => it.ingredient_id === s.ingredient_id)
      : items.filter(
          (it) => !it.ingredient_id && (it.name ?? '').toLowerCase() === s.name.toLowerCase(),
        );

    if (existing.length > 0) {
      existing.forEach((it) => removeShoppingItem(it.id));
    } else {
      add(s);
    }
    // An amount only applies to the item it was typed for.
    if (hasAmount) setQuery('');
  }

  // A typed item with no match becomes a real ingredient (so it's remembered as
  // a future suggestion) and is added to the list with the typed amount.
  function addNew() {
    if (!listId || !name) return;
    const id = createIngredient({ name, default_unit: parsed.unit });
    const ingredient = getIngredient(id);
    addShoppingItem(listId, {
      ingredient_id: id,
      quantity: parsed.quantity,
      unit: parsed.unit ?? ingredient?.default_unit ?? null,
    });
    setSuggestions((current) =>
      current.some((s) => s.key === id)
        ? current
        : [
            {
              key: id,
              name: ingredient?.name ?? name,
              ingredient_id: id,
              default_unit: ingredient?.default_unit ?? null,
              usage_count: 1,
            },
            ...current,
          ],
    );
    setQuery('');
  }

  // Enter always commits the typed text: add the matching suggestion if there is
  // one (and it isn't already on the list), otherwise create it. Then reset.
  function submit() {
    if (!name) return;
    if (exact) {
      if (!isOnList(exact)) add(exact);
      setQuery('');
    } else {
      addNew();
    }
  }

  if (!list) {
    return (
      <ThemedView style={styles.flex}>
        <View style={styles.search}>
          <ThemedText themeColor="textSecondary">{t('shopping.notFound')}</ThemedText>
        </View>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.flex}>
      <View style={styles.search}>
        <TextField
          label={t('shopping.searchOrAdd')}
          placeholder={t('shopping.searchPlaceholder')}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          returnKeyType="done"
          submitBehavior="submit"
          onSubmitEditing={submit}
        />
      </View>

      <FlatList
        data={filtered}
        extraData={items}
        keyExtractor={(s) => s.key}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        style={styles.list}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          name && !exactMatch ? (
            <Pressable
              onPress={addNew}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.row,
                { borderBottomColor: theme.border },
                pressed && styles.pressed,
              ]}>
              <View
                style={[styles.indicator, { backgroundColor: theme.tint, borderColor: theme.tint }]}>
                <ThemedText themeColor="onTint" style={styles.indicatorText}>
                  ＋
                </ThemedText>
              </View>
              <ThemedText style={styles.flex} numberOfLines={1}>
                {t('shopping.addNamed', { name })}
              </ThemedText>
              {amount ? (
                <ThemedText type="small" themeColor="textSecondary">
                  {amount}
                </ThemedText>
              ) : null}
            </Pressable>
          ) : null
        }
        ListEmptyComponent={
          name ? null : (
            <ThemedText themeColor="textSecondary" style={styles.empty}>
              {t('shopping.suggestionsEmpty')}
            </ThemedText>
          )
        }
        renderItem={({ item: s }) => {
          const onList = isOnList(s);
          // The typed amount previews on rows it would apply to.
          const rowAmount = !onList && hasAmount ? amount : s.default_unit;
          return (
            <Pressable
              onPress={() => toggle(s)}
              accessibilityRole="button"
              accessibilityState={{ selected: onList }}
              style={({ pressed }) => [
                styles.row,
                { borderBottomColor: theme.border },
                pressed && styles.pressed,
              ]}>
              <View
                style={[
                  styles.indicator,
                  { borderColor: theme.border },
                  onList && { backgroundColor: theme.tint, borderColor: theme.tint },
                ]}>
                <ThemedText
                  style={[
                    styles.indicatorText,
                    { color: onList ? theme.onTint : theme.textSecondary },
                  ]}>
                  {onList ? '✓' : '＋'}
                </ThemedText>
              </View>
              <ThemedText style={[styles.flex, onList ? { color: theme.tint } : null]} numberOfLines={1}>
                {s.name}
              </ThemedText>
              {rowAmount ? (
                <ThemedText type="small" themeColor="textSecondary">
                  {rowAmount}
                </ThemedText>
              ) : null}
            </Pressable>
          );
        }}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  list: {
    flex: 1,
  },
  search: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
  },
  listContent: {
    paddingHorizontal: Spacing.four,
    paddingBottom: BottomTabInset + Spacing.five,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  indicator: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  indicatorText: {
    fontSize: 16,
    lineHeight: 18,
    fontWeight: 700,
  },
  empty: {
    paddingVertical: Spacing.four,
  },
  pressed: {
    opacity: 0.6,
  },
});
