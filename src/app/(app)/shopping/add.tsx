import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useT } from '@/lib/i18n';
import {
  addShoppingItem,
  createIngredient,
  getIngredient,
  removeShoppingItem,
  useShoppingList,
  useShoppingListItems,
  useShoppingSuggestions,
  type ShoppingSuggestion,
} from '@/lib/store';

/**
 * Listonic-style "add items" screen: search the household's previous items and
 * tap to toggle them on/off the list, or type a new item that doesn't exist yet
 * and add it. Stays open so several items can be added in one pass.
 */
export default function AddShoppingItemsScreen() {
  const t = useT();
  const theme = useTheme();
  const { listId } = useLocalSearchParams<{ listId: string }>();
  const list = useShoppingList(listId);
  const items = useShoppingListItems(listId);
  const suggestions = useShoppingSuggestions();
  const [query, setQuery] = useState('');

  const trimmed = query.trim();
  const lowerQuery = trimmed.toLowerCase();
  const filtered = lowerQuery
    ? suggestions.filter((s) => s.name.toLowerCase().includes(lowerQuery))
    : suggestions;
  const exactMatch = suggestions.some((s) => s.name.toLowerCase() === lowerQuery);

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

  function toggle(s: ShoppingSuggestion) {
    if (!listId) return;
    const existing = s.ingredient_id
      ? items.filter((it) => it.ingredient_id === s.ingredient_id)
      : items.filter(
          (it) => !it.ingredient_id && (it.name ?? '').toLowerCase() === s.name.toLowerCase(),
        );

    if (existing.length > 0) {
      existing.forEach((it) => removeShoppingItem(it.id));
    } else if (s.ingredient_id) {
      addShoppingItem(listId, { ingredient_id: s.ingredient_id, unit: s.default_unit });
    } else {
      addShoppingItem(listId, { name: s.name, unit: s.default_unit });
    }
  }

  // A typed item with no match becomes a real ingredient (so it's remembered as
  // a future suggestion) and is added to the list.
  function addNew() {
    if (!listId || !trimmed) return;
    const id = createIngredient({ name: trimmed });
    addShoppingItem(listId, { ingredient_id: id, unit: getIngredient(id)?.default_unit ?? null });
    setQuery('');
  }

  // Enter always commits the typed text: add the matching suggestion if there is
  // one (and it isn't already on the list), otherwise create it. Then reset.
  function submit() {
    if (!trimmed) return;
    const match = suggestions.find((s) => s.name.toLowerCase() === lowerQuery);
    if (match) {
      if (!isOnList(match)) toggle(match);
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
          trimmed && !exactMatch ? (
            <Pressable
              onPress={addNew}
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
                {t('shopping.addNamed', { name: trimmed })}
              </ThemedText>
            </Pressable>
          ) : null
        }
        ListEmptyComponent={
          trimmed ? null : (
            <ThemedText themeColor="textSecondary" style={styles.empty}>
              {t('shopping.suggestionsEmpty')}
            </ThemedText>
          )
        }
        renderItem={({ item: s }) => {
          const onList = isOnList(s);
          return (
            <Pressable
              onPress={() => toggle(s)}
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
              {s.default_unit ? (
                <ThemedText type="small" themeColor="textSecondary">
                  {s.default_unit}
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
