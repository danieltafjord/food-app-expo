import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { SheetScreen } from '@/components/sheet';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { BadgeColors, Spacing } from '@/constants/theme';
import { useResolvedScheme, useTheme } from '@/hooks/use-theme';
import { formatQuantity } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { parseItemLine } from '@/lib/parse-line';
import { findExact, indexByName, searchIndex } from '@/lib/search';
import { cancelSheet, resolveSheet } from '@/lib/sheets';
import { createIngredient, getIngredient, useIngredients, type LocalIngredient } from '@/lib/store';

const SWAP = 140;
const FADE_IN = FadeIn.duration(SWAP);
const FADE_OUT = FadeOut.duration(SWAP);

/**
 * Search the ingredient catalogue or create a new entry — the same
 * "search or create" field as the dinner picker. A typed line may carry the
 * amount ("500 g kjøttdeig"): the name part searches, and the amount travels
 * with the pick. The pick is handed back to the opener through `@/lib/sheets`
 * (param `request`) because it lands in the dinner editor's draft.
 */
export default function IngredientPickerSheet() {
  const t = useT();
  const theme = useTheme();
  const brand = BadgeColors[useResolvedScheme()].brand;
  const { request } = useLocalSearchParams<{ request: string }>();
  const all = useIngredients();
  const [query, setQuery] = useState('');
  // One create per typed query — guards a "done" + button tap firing twice.
  const created = useRef(false);

  // Dismissed without picking: release the opener's callback.
  useEffect(() => () => cancelSheet(request), [request]);

  const parsed = parseItemLine(query);
  const name = parsed.name;
  const amount = formatQuantity(parsed.quantity, parsed.unit);
  // Fold every name once per catalogue change, not once per keystroke; the same
  // ranked, diacritic-insensitive search the dinner picker uses.
  const index = useMemo(() => indexByName(all, (item) => item.name), [all]);
  const results = useMemo(() => searchIndex(index, name), [index, name]);
  const exact = useMemo(() => findExact(index, name), [index, name]);
  const action: 'idle' | 'create' | 'add' = !name ? 'idle' : exact ? 'add' : 'create';

  function pick(ingredient: LocalIngredient) {
    resolveSheet(request, {
      ingredient,
      quantity: parsed.quantity,
      unit: parsed.unit ?? ingredient.default_unit,
    });
    router.back();
  }

  function onCreate() {
    if (action !== 'create' || created.current) return;
    created.current = true;
    const ingredient = getIngredient(createIngredient({ name, default_unit: parsed.unit }));
    if (ingredient) pick(ingredient);
  }

  function onSubmit() {
    if (exact) pick(exact);
    else onCreate();
  }

  const actionTitle =
    action === 'create'
      ? t('ingredientPicker.create', { name })
      : action === 'add'
        ? t('ingredientPicker.addExisting', { name })
        : t('ingredientPicker.idleTitle');
  const actionHint =
    action === 'create'
      ? t('ingredientPicker.createHint')
      : action === 'add'
        ? t('ingredientPicker.addExistingHint')
        : t('ingredientPicker.idleHint');
  const idle = action === 'idle';

  return (
    <SheetScreen layout="fill">
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
        blurOnSubmit={false}
        onSubmitEditing={onSubmit}
      />

      {/* Fixed-height slot: the card crossfades between states but never
          resizes, so the list below stays put while typing. */}
      <View style={styles.actionSlot}>
        <Animated.View
          key={action}
          entering={FADE_IN}
          exiting={FADE_OUT}
          style={StyleSheet.absoluteFill}>
          <Pressable
            onPress={onSubmit}
            disabled={idle}
            accessibilityRole="button"
            accessibilityLabel={actionTitle}
            style={({ pressed }) => [
              styles.actionCard,
              { backgroundColor: idle ? theme.backgroundElement : brand.bg },
              pressed && styles.actionPressed,
            ]}>
            <View
              style={[
                styles.actionBadge,
                { backgroundColor: idle ? theme.backgroundSelected : theme.tint },
              ]}>
              <ThemedText themeColor={idle ? 'textSecondary' : 'onTint'} style={styles.actionGlyph}>
                {action === 'add' ? '✓' : '＋'}
              </ThemedText>
            </View>
            <View style={styles.flex}>
              <ThemedText
                type="smallBold"
                themeColor={idle ? 'textSecondary' : undefined}
                style={idle ? undefined : { color: brand.fg }}
                numberOfLines={1}>
                {actionTitle}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                {amount && !idle ? `${amount} · ${actionHint}` : actionHint}
              </ThemedText>
            </View>
          </Pressable>
        </Animated.View>
      </View>

      {/* Virtualised: the catalogue holds every ingredient the household ever
          used, and mounting all of them while the sheet slides up and the
          keyboard animates is exactly the frame budget we don't have. */}
      <FlatList
        data={results}
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
            <ThemedText type="small" themeColor="textSecondary">
              {amount || ingredient.default_unit || ''}
            </ThemedText>
          </Pressable>
        )}
        ListEmptyComponent={
          <Animated.View entering={FADE_IN} style={styles.empty}>
            <ThemedText type="small" themeColor="textSecondary">
              {name ? t('ingredientPicker.noMatches') : t('ingredientPicker.empty')}
            </ThemedText>
          </Animated.View>
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
  actionSlot: {
    height: 36 + Spacing.three * 2,
  },
  actionCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  actionBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionGlyph: {
    fontSize: 20,
    lineHeight: 24,
  },
  actionPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  empty: {
    paddingVertical: Spacing.three,
  },
  flex: {
    flexShrink: 1,
    flexGrow: 1,
  },
  pressed: {
    opacity: 0.6,
  },
});
