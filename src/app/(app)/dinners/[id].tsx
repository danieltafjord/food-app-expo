import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { IngredientSuggestions } from '@/components/ingredient-suggestions';
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
import { amountText, isAmountValid, parseAmount } from '@/lib/parse-line';
import { openIngredientPicker, type IngredientPick } from '@/lib/sheets';
import {
  createIngredient,
  deleteDinner,
  getIngredient,
  patchDinner,
  upsertDinnerItem,
  removeDinnerItem,
  useDinner,
  type DinnerWithItems,
} from '@/lib/store';

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

  // The form reads live rows; only temporarily invalid input stays in a local draft.
  return <DinnerEditorForm key={dinner.id} dinner={dinner} />;
}

/** Each field saves independently, so remote edits cannot be overwritten by an old form snapshot. */
function DinnerEditorForm({ dinner }: { dinner: DinnerWithItems }) {
  const t = useT();
  const theme = useTheme();
  const [nameDraft, setNameDraft] = useState({ source: dinner.name, value: dinner.name });
  const name = nameDraft.source === dinner.name ? nameDraft.value : dinner.name;
  const servings = dinner.default_servings;
  const notes = dinner.notes ?? '';
  const [amountDrafts, setAmountDrafts] = useState<Record<string, { source: string; value: string }>>({});
  const [focusedItem, setFocusedItem] = useState<string | null>(null);
  const items = dinner.items.map((item) => {
    const source = amountText(item.quantity, item.unit);
    const draft = amountDrafts[item.id];
    return { ...item, ingredient_name: getIngredient(item.ingredient_id)?.name ?? t('common.ingredientFallback'),
      amount: draft?.source === source ? draft.value : source };
  });

  function setName(value: string) {
    setNameDraft({ source: dinner.name, value });
    if (value.trim()) patchDinner(dinner.id, { name: value });
  }

  function addIngredient({ ingredient, quantity, unit }: IngredientPick) {
    if (items.some((item) => item.ingredient_id === ingredient.id &&
      (item.unit?.trim().toLowerCase() ?? '') === (unit?.trim().toLowerCase() ?? ''))) return;
    upsertDinnerItem(dinner.id, { ingredient_id: ingredient.id, quantity, unit });
  }

  function updateAmount(itemId: string, amount: string) {
    const item = items.find((item) => item.id === itemId);
    if (!item) return;
    setAmountDrafts((drafts) => ({ ...drafts, [itemId]: { source: amountText(item.quantity, item.unit), value: amount } }));
    if (isAmountValid(amount)) upsertDinnerItem(dinner.id, { ingredient_id: item.ingredient_id, ...parseAmount(amount) }, itemId);
  }

  function pickUnit(unit: string) {
    const item = items.find((item) => item.id === focusedItem);
    if (!item) return;
    updateAmount(item.id, amountText(item.quantity, item.unit === unit ? null : unit));
  }

  function removeItem(itemId: string) {
    removeDinnerItem(dinner.id, itemId);
    if (focusedItem === itemId) setFocusedItem(null);
  }

  function onDelete() {
    Alert.alert(t('dinners.deleteDinnerTitle'), t('dinners.deleteDinnerMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () => {
          deleteDinner(dinner.id);
          router.back();
        },
      },
    ]);
  }

  const focused = items.find((item) => item.id === focusedItem);
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
          maxLength={255}
        />

        <View style={styles.section}>
          <ThemedText type="smallBold">{t('dinners.defaultServings')}</ThemedText>
          <Stepper
            value={servings}
            onChange={(default_servings) => patchDinner(dinner.id, { default_servings })}
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
                  key={item.id}
                  style={[
                    styles.item,
                    index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
                  ]}>
                  <ThemedText style={styles.itemName} numberOfLines={1}>
                    {item.ingredient_name}
                  </ThemedText>
                  <TextInput
                    value={item.amount}
                    onChangeText={(value) => updateAmount(item.id, value)}
                    onFocus={() => setFocusedItem(item.id)}
                    placeholder={t('dinners.amountPlaceholder')}
                    placeholderTextColor={theme.textSecondary}
                    accessibilityLabel={`${t('dinners.amount')} ${item.ingredient_name}`}
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={[
                      styles.amount,
                      { backgroundColor: theme.backgroundSelected, color: theme.text },
                      !isAmountValid(item.amount) && { borderWidth: 1, borderColor: theme.danger },
                    ]}
                  />
                  <Pressable
                    onPress={() => removeItem(item.id)}
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
          {items.some((item) => !isAmountValid(item.amount)) ? (
            <ThemedText type="small" style={{ color: theme.danger }}>
              {t('dinners.amountInvalid')}
            </ThemedText>
          ) : null}
          {focused ? <UnitChips value={focusedUnit} onPick={pickUnit} /> : null}
          <IngredientSuggestions
            dinnerId={dinner.id}
            name={name}
            ingredients={items.map((item) => item.ingredient_name)}
            onAdd={(suggestion) => {
              const ingredient = getIngredient(createIngredient({ name: suggestion }));
              if (ingredient) addIngredient({ ingredient, quantity: null, unit: null });
            }}
          />
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
          onChangeText={(notes) => patchDinner(dinner.id, { notes })}
          maxLength={5000}
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
