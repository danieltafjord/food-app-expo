import { useLocalSearchParams } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/icon';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatQuantity } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { isAmountWithinLimits, parseItemLine } from '@/lib/parse-line';
import { listScope } from '@/lib/realtime/live';
import { usePresence } from '@/lib/realtime/use-presence';
import { findExact, indexByName, searchIndex } from '@/lib/search';
import {
  addShoppingItem,
  buildShoppingSuggestions,
  createIngredient,
  getIngredient,
  removeShoppingItems,
  useIngredients,
  useShoppingList,
  useShoppingListItems,
  type ShoppingSuggestion,
} from '@/lib/store';
import { deleteWithUndo, useHiddenIds } from '@/lib/undo';

/**
 * Listonic-style "add items" screen: search the household's previous items and
 * tap to toggle them on/off the list, or type a new item that doesn't exist yet
 * and add it. A typed line may carry the amount ("2 l melk") — the name part
 * drives the search and the amount lands on the item. Stays open so several
 * items can be added in one pass.
 *
 * Tapping a row that is already ticked takes back what was added here. An item
 * that was on the list before (from the week plan, maybe already checked off)
 * is removed like a swipe on the list: at once, with Undo.
 */
export default function AddShoppingItemsScreen() {
  const t = useT();
  const theme = useTheme();
  const { listId } = useLocalSearchParams<{ listId: string }>();
  const list = useShoppingList(listId);
  // Adding items still counts as being in the list.
  usePresence(listId ? listScope(listId) : null);
  // Rows removed with Undo still pending count as off the list.
  const hidden = useHiddenIds();
  const items = useShoppingListItems(listId).filter((item) => !hidden[item.id]);
  // Item ids added on this screen, per suggestion key: those toggle off silently.
  const addedHere = useRef(new Map<string, string[]>());
  // What the query was when "Add …" last ran: the return key and a tap on the
  // row both fire for the same text, and it must be created only once.
  const lastCreated = useRef<string | null>(null);
  // The catalogue is built once when the screen opens: it walks every item
  // ever put on a list, and rebuilding (and re-sorting) it after each tap would
  // both cost that scan and shuffle rows under the finger. New entries typed
  // here are appended to the snapshot; on/off state stays live via `items`.
  const [suggestions, setSuggestions] = useState(buildShoppingSuggestions);
  const ingredients = useIngredients();
  // Keep the snapshot's order, but immediately drop remotely deleted entries.
  const availableSuggestions = useMemo(() => {
    const ids = new Set(ingredients.map((ingredient) => ingredient.id));
    return suggestions.filter((suggestion) => !suggestion.ingredient_id || ids.has(suggestion.ingredient_id));
  }, [ingredients, suggestions]);
  const [query, setQuery] = useState('');

  const parsed = parseItemLine(query);
  const name = parsed.name;
  const amountOk = isAmountWithinLimits(parsed);
  const hasAmount = parsed.quantity != null || parsed.unit != null;
  const amount = formatQuantity(parsed.quantity, parsed.unit);
  // The same ranked, diacritic- and case-insensitive search as the pickers, so
  // "rodlok" finds "Rødløk" and "ø" finds "Øl".
  const index = useMemo(() => indexByName(availableSuggestions, (s) => s.name), [availableSuggestions]);
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

  function rememberAdded(key: string, itemId: string) {
    addedHere.current.set(key, [...(addedHere.current.get(key) ?? []), itemId]);
  }

  /** Add a suggestion, with the typed amount if there is one, else its usual unit. */
  function add(s: ShoppingSuggestion) {
    if (!listId || !amountOk) return;
    const base = hasAmount
      ? { quantity: parsed.quantity, unit: parsed.unit ?? s.default_unit }
      : { unit: s.default_unit };
    if (s.ingredient_id) {
      if (!getIngredient(s.ingredient_id)) return;
      rememberAdded(s.key, addShoppingItem(listId, { ingredient_id: s.ingredient_id, ...base }));
    } else {
      rememberAdded(s.key, addShoppingItem(listId, { name: s.name, ...base }));
    }
  }

  function toggle(s: ShoppingSuggestion) {
    if (!listId || !amountOk) return;
    const existing = s.ingredient_id
      ? items.filter((it) => it.ingredient_id === s.ingredient_id)
      : items.filter(
          (it) => !it.ingredient_id && (it.name ?? '').toLowerCase() === s.name.toLowerCase(),
        );

    if (existing.length > 0) {
      const mine = new Set(addedHere.current.get(s.key) ?? []);
      const ownIds = existing.filter((it) => mine.has(it.id)).map((it) => it.id);
      if (ownIds.length > 0) {
        // Just added here by mistake: take back only that.
        removeShoppingItems(ownIds);
        addedHere.current.set(s.key, [...mine].filter((id) => !ownIds.includes(id)));
      } else {
        const ids = existing.map((it) => it.id);
        deleteWithUndo(t('undo.itemRemoved', { name: s.name }), ids, () => removeShoppingItems(ids));
      }
    } else {
      add(s);
    }
    // An amount only applies to the item it was typed for.
    if (hasAmount) setQuery('');
  }

  // A typed item with no match becomes a real ingredient (so it's remembered as
  // a future suggestion) and is added to the list with the typed amount.
  function addNew() {
    if (!listId || !name || !amountOk || lastCreated.current === query) return;
    lastCreated.current = query;
    const id = createIngredient({ name, default_unit: parsed.unit });
    const ingredient = getIngredient(id);
    rememberAdded(id, addShoppingItem(listId, {
      ingredient_id: id,
      quantity: parsed.quantity,
      unit: parsed.unit ?? ingredient?.default_unit ?? null,
    }));
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
    if (!name || !amountOk) return;
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
          maxLength={255}
          error={amountOk ? null : t('shoppingItemEditor.amountInvalid')}
          value={query}
          onChangeText={(value) => {
            setQuery(value);
            lastCreated.current = null;
          }}
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
                <Icon name="plus" size={12} weight="bold" color={theme.onTint} />
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
                <Icon
                  name={onList ? 'checkmark' : 'plus'}
                  size={12}
                  weight="bold"
                  color={onList ? theme.onTint : theme.textSecondary}
                />
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
  empty: {
    paddingVertical: Spacing.four,
  },
  pressed: {
    opacity: 0.6,
  },
});
