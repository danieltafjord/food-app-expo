import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet } from 'react-native';

import { Button } from '@/components/button';
import { SheetScreen } from '@/components/sheet';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useT } from '@/lib/i18n';
import { findExact, indexByName, searchIndex } from '@/lib/search';
import { cancelSheet, resolveSheet } from '@/lib/sheets';
import { createIngredient, getIngredient, useIngredients, type LocalIngredient } from '@/lib/store';

/**
 * Search the ingredient catalogue or create a new entry. The pick is handed
 * back to the opener through `@/lib/sheets` (param `request`) because it lands
 * in the dinner editor's unsaved draft, not in the store.
 */
export default function IngredientPickerSheet() {
  const t = useT();
  const theme = useTheme();
  const { request } = useLocalSearchParams<{ request: string }>();
  const all = useIngredients();
  const [query, setQuery] = useState('');
  // One create per typed query — guards a "done" + button tap firing twice.
  const created = useRef(false);

  // Dismissed without picking: release the opener's callback.
  useEffect(() => () => cancelSheet(request), [request]);

  const trimmed = query.trim();
  // Fold every name once per catalogue change, not once per keystroke; the same
  // ranked, diacritic-insensitive search the dinner picker uses.
  const index = useMemo(() => indexByName(all, (item) => item.name), [all]);
  const filtered = useMemo(() => searchIndex(index, trimmed), [index, trimmed]);
  const exactMatch = useMemo(() => findExact(index, trimmed) !== undefined, [index, trimmed]);

  function pick(ingredient: LocalIngredient) {
    resolveSheet(request, ingredient);
    router.back();
  }

  function onCreate() {
    if (!trimmed || created.current) return;
    created.current = true;
    const ingredient = getIngredient(createIngredient({ name: trimmed }));
    if (ingredient) pick(ingredient);
  }

  return (
    <SheetScreen title={t('ingredientPicker.title')} layout="fill">
      <TextField
        label={t('ingredientPicker.searchOrCreate')}
        placeholder={t('ingredientPicker.placeholder')}
        value={query}
        onChangeText={(text) => {
          created.current = false;
          setQuery(text);
        }}
        autoFocus
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="done"
        onSubmitEditing={() => {
          if (trimmed && !exactMatch) onCreate();
        }}
      />

      {trimmed && !exactMatch ? (
        <Button title={t('ingredientPicker.create', { name: trimmed })} onPress={onCreate} />
      ) : null}

      {/* Virtualised: the catalogue holds every ingredient the household ever
          used, and mounting all of them while the sheet slides up and the
          keyboard animates is exactly the frame budget we don't have. */}
      <FlatList
        data={filtered}
        keyExtractor={(ingredient) => ingredient.id}
        style={styles.list}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={5}
        removeClippedSubviews
        renderItem={({ item: ingredient }) => (
          <Pressable
            onPress={() => pick(ingredient)}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.row,
              { borderBottomColor: theme.border },
              pressed && styles.pressed,
            ]}>
            <ThemedText style={styles.flex} numberOfLines={1}>
              {ingredient.name}
            </ThemedText>
            {ingredient.default_unit ? (
              <ThemedText type="small" themeColor="textSecondary">
                {ingredient.default_unit}
              </ThemedText>
            ) : null}
          </Pressable>
        )}
        ListEmptyComponent={
          <ThemedText type="small" themeColor="textSecondary">
            {trimmed ? t('ingredientPicker.noMatches') : t('ingredientPicker.empty')}
          </ThemedText>
        }
      />
    </SheetScreen>
  );
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  flex: {
    flexShrink: 1,
    flexGrow: 1,
  },
  pressed: {
    opacity: 0.6,
  },
});
