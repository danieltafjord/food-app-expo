import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { HeaderMenu, MenuAction } from '@/components/header-menu';
import { Screen } from '@/components/screen';
import { Stepper } from '@/components/stepper';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { UnitChips } from '@/components/unit-chips';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useT } from '@/lib/i18n';
import { amountText, parseAmount } from '@/lib/parse-line';
import { openIngredientPicker, type IngredientPick } from '@/lib/sheets';
import {
  deleteDinner,
  getIngredient,
  updateDinner,
  useDinner,
  type DinnerWithItems,
} from '@/lib/store';

/** How long after the last edit the draft is written to the store. */
const SAVE_DELAY_MS = 400;

export default function DinnerEditorScreen() {
  const t = useT();
  const params = useLocalSearchParams<{ id: string }>();
  const dinner = useDinner(params.id);

  if (!dinner) {
    return (
      <Screen topInset={false} refreshable={false}>
        <Card>
          <ThemedText type="subtitle">{t('dinners.notFound')}</ThemedText>
          <Button title={t('common.back')} variant="secondary" onPress={() => router.back()} />
        </Card>
      </Screen>
    );
  }

  // Mount the form only once we have the dinner so its state seeds from props
  // (a lazy useState initializer) — no data-syncing effect needed.
  return <DinnerEditorForm key={dinner.id} dinner={dinner} />;
}

type EditorItem = {
  ingredient_id: string;
  ingredient_name: string;
  /** Quantity + unit as typed: "500 g", "2", "dl". Parsed when saved. */
  amount: string;
};

/** Snapshot of the editable fields, so saves only happen when something changed. */
function draftKey(name: string, servings: number, notes: string, items: EditorItem[]): string {
  return JSON.stringify([name, servings, notes, items]);
}

/**
 * Saves as you go, like the rest of the app: edits land in the store a moment
 * after you stop typing, and whatever is still pending is written when the
 * screen closes. So there is no Save button and nothing to discard.
 */
function DinnerEditorForm({ dinner }: { dinner: DinnerWithItems }) {
  const t = useT();
  const theme = useTheme();
  const [name, setName] = useState(dinner.name);
  const [servings, setServings] = useState(dinner.default_servings);
  const [notes, setNotes] = useState(dinner.notes ?? '');
  const [items, setItems] = useState<EditorItem[]>(() =>
    dinner.items.map((item) => ({
      ingredient_id: item.ingredient_id,
      ingredient_name: getIngredient(item.ingredient_id)?.name ?? t('common.ingredientFallback'),
      amount: amountText(item.quantity, item.unit),
    })),
  );
  // Which amount field was last focused — the unit chips apply to that row.
  const [focusedItem, setFocusedItem] = useState<string | null>(null);

  const key = draftKey(name, servings, notes, items);
  // The last draft written to the store; seeded with the opening state so
  // mounting never writes.
  const savedKey = useRef(key);
  // The save that is waiting for the debounce, so closing the screen can flush it.
  const pending = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (key === savedKey.current) return;
    const save = () => {
      savedKey.current = key;
      pending.current = null;
      updateDinner(dinner.id, {
        // An emptied name keeps the last one rather than saving a blank.
        name: name.trim() || dinner.name,
        default_servings: servings,
        notes: notes.trim() || null,
        items: items.map((item) => {
          const { quantity, unit } = parseAmount(item.amount);
          return { ingredient_id: item.ingredient_id, quantity, unit };
        }),
      });
    };
    pending.current = save;
    const timer = setTimeout(save, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [key, dinner.id, dinner.name, name, servings, notes, items]);

  // Flush on unmount (back, swipe back, or a delete — `updateDinner` is a
  // no-op once the row is gone).
  useEffect(() => () => pending.current?.(), []);

  function addIngredient({ ingredient, quantity, unit }: IngredientPick) {
    setItems((current) => {
      if (current.some((item) => item.ingredient_id === ingredient.id)) {
        return current;
      }
      return [
        ...current,
        {
          ingredient_id: ingredient.id,
          ingredient_name: ingredient.name,
          amount: amountText(quantity, unit),
        },
      ];
    });
  }

  function updateAmount(ingredientId: string, amount: string) {
    setItems((current) =>
      current.map((item) => (item.ingredient_id === ingredientId ? { ...item, amount } : item)),
    );
  }

  function pickUnit(unit: string) {
    if (!focusedItem) return;
    setItems((current) =>
      current.map((item) => {
        if (item.ingredient_id !== focusedItem) return item;
        const { quantity, unit: currentUnit } = parseAmount(item.amount);
        return { ...item, amount: amountText(quantity, currentUnit === unit ? null : unit) };
      }),
    );
  }

  function removeItem(ingredientId: string) {
    setItems((current) => current.filter((item) => item.ingredient_id !== ingredientId));
    if (focusedItem === ingredientId) setFocusedItem(null);
  }

  function onDelete() {
    Alert.alert(t('dinners.deleteDinnerTitle'), t('dinners.deleteDinnerMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () => {
          // Nothing pending should be written after the row is gone.
          pending.current = null;
          deleteDinner(dinner.id);
          router.back();
        },
      },
    ]);
  }

  const focused = items.find((item) => item.ingredient_id === focusedItem);
  const focusedUnit = focused ? parseAmount(focused.amount).unit : null;

  return (
    <>
      <Stack.Screen options={{ title: name.trim() || dinner.name }} />
      <HeaderMenu>
        <MenuAction icon="trash" destructive onPress={onDelete}>
          {t('dinners.deleteDinner')}
        </MenuAction>
      </HeaderMenu>

      <Screen topInset={false} refreshable={false}>
        <TextField
          label={t('dinners.name')}
          value={name}
          onChangeText={setName}
          autoCapitalize="sentences"
        />

        <View style={styles.section}>
          <ThemedText type="smallBold">{t('dinners.defaultServings')}</ThemedText>
          <Stepper
            value={servings}
            onChange={setServings}
            min={1}
            max={99}
            unit={t('common.servings')}
            accessibilityLabel={t('dinners.defaultServings')}
          />
        </View>

        <View style={styles.section}>
          <ThemedText type="smallBold">{t('dinners.ingredients')}</ThemedText>
          <Card style={styles.itemsCard}>
            {items.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                {t('dinners.noIngredients')}
              </ThemedText>
            ) : (
              items.map((item, index) => (
                <View
                  key={item.ingredient_id}
                  style={[
                    styles.item,
                    index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
                  ]}>
                  <ThemedText style={styles.itemName} numberOfLines={1}>
                    {item.ingredient_name}
                  </ThemedText>
                  <TextInput
                    value={item.amount}
                    onChangeText={(value) => updateAmount(item.ingredient_id, value)}
                    onFocus={() => setFocusedItem(item.ingredient_id)}
                    placeholder={t('dinners.amountPlaceholder')}
                    placeholderTextColor={theme.textSecondary}
                    accessibilityLabel={`${t('dinners.amount')} ${item.ingredient_name}`}
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={[
                      styles.amount,
                      { backgroundColor: theme.backgroundSelected, color: theme.text },
                    ]}
                  />
                  <Pressable
                    onPress={() => removeItem(item.ingredient_id)}
                    accessibilityRole="button"
                    accessibilityLabel={t('a11y.removeIngredient')}
                    hitSlop={10}
                    style={styles.removeItem}>
                    <ThemedText themeColor="textSecondary">✕</ThemedText>
                  </Pressable>
                </View>
              ))
            )}
          </Card>
          {focused ? <UnitChips value={focusedUnit} onPick={pickUnit} /> : null}
          <Button
            title={t('dinners.addIngredient')}
            variant="secondary"
            size="small"
            onPress={() => openIngredientPicker(addIngredient)}
          />
        </View>

        <TextField
          label={t('dinners.notes')}
          value={notes}
          onChangeText={setNotes}
          placeholder={t('dinners.notesPlaceholder')}
          multiline
        />
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: Spacing.two,
  },
  itemsCard: {
    gap: 0,
    paddingVertical: Spacing.one,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
  },
  itemName: {
    flex: 1,
  },
  amount: {
    width: 104,
    minHeight: 40,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two,
    fontSize: 16,
    textAlign: 'right',
  },
  removeItem: {
    paddingHorizontal: Spacing.one,
  },
});
