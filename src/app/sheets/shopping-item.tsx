import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { CategorySelect } from '@/components/category-select';
import { SheetScreen } from '@/components/sheet';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { UnitChips } from '@/components/unit-chips';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { type CategoryId } from '@/lib/categorize';
import { useT } from '@/lib/i18n';
import { deleteWithUndo } from '@/lib/undo';
import { amountText, isAmountValid, parseAmount } from '@/lib/parse-line';
import {
  recategorizeShoppingItem,
  removeShoppingItems,
  updateShoppingItem,
  useShoppingItem,
  type ShoppingListItemWithIngredient,
} from '@/lib/store';

/** Edit a shopping-list item's amount ("500 g"), aisle and (free-text) name. */
export default function ShoppingItemSheet() {
  const t = useT();
  const { itemId } = useLocalSearchParams<{ itemId: string }>();
  const item = useShoppingItem(itemId);

  if (!item) {
    return (
      <SheetScreen title={t('shoppingItemEditor.editItem')}>
        <Button title={t('common.back')} variant="secondary" onPress={() => router.back()} />
      </SheetScreen>
    );
  }
  return <ItemForm key={item.id} item={item} />;
}

function ItemForm({ item }: { item: ShoppingListItemWithIngredient }) {
  const t = useT();
  const theme = useTheme();
  const isFreeText = item.ingredient_id == null;
  const [name, setName] = useState(item.name ?? '');
  // One field for quantity + unit, parsed on save ("500 g", "2", "dl").
  const [amount, setAmount] = useState(amountText(item.quantity, item.unit));
  const [category, setCategory] = useState<CategoryId>(item.category);
  const parsed = parseAmount(amount);
  // Once per sheet: a double tap on Save or Remove would pop two screens.
  const closing = useRef(false);

  // A free-text item must keep a name; an ingredient-backed one keeps its ingredient.
  // An amount we can't read ("ca 2 dl") would be saved as no amount at all.
  const amountOk = isAmountValid(amount);
  const canSave = (!isFreeText || !!name.trim()) && amountOk;

  function pickUnit(unit: string) {
    // Replace the unit, keep the number: "500 g" + "kg" → "500 kg".
    setAmount(amountText(parsed.quantity, parsed.unit === unit ? null : unit));
  }

  function save() {
    if (closing.current) return;
    closing.current = true;
    updateShoppingItem(item.id, {
      name: isFreeText ? name.trim() || null : item.name,
      quantity: parsed.quantity,
      unit: parsed.unit,
    });
    if (category !== item.category) {
      recategorizeShoppingItem(item.id, category);
    }
    router.back();
  }

  // Like a swipe on the list: gone at once, with a moment to take it back.
  function remove() {
    if (closing.current) return;
    closing.current = true;
    const id = item.id;
    const name = item.ingredient_name ?? item.name ?? t('common.itemFallback');
    router.back();
    deleteWithUndo(t('undo.itemRemoved', { name }), [id], () => removeShoppingItems([id]));
  }

  return (
    <SheetScreen
      title={
        isFreeText
          ? t('shoppingItemEditor.editItem')
          : (item.ingredient_name ?? t('common.ingredientFallback'))
      }>
      {isFreeText ? (
        <TextField
          label={t('shopping.item')}
          maxLength={255}
          value={name}
          onChangeText={setName}
          autoCapitalize="sentences"
        />
      ) : null}

      <View style={styles.field}>
        <TextField
          label={t('shoppingItemEditor.amount')}
          value={amount}
          onChangeText={setAmount}
          placeholder={t('shoppingItemEditor.amountPlaceholder')}
          autoCapitalize="none"
          autoCorrect={false}
          error={amountOk ? null : t('shoppingItemEditor.amountInvalid')}
        />
        <UnitChips value={parsed.unit} onPick={pickUnit} />
      </View>

      <View style={styles.field}>
        <ThemedText type="small" themeColor="textSecondary">
          {t('shoppingItemEditor.category')}
        </ThemedText>
        <CategorySelect value={category} onChange={setCategory} />
      </View>

      {/* Cancel + Save as a pair; removal is red and below a divider so it
          can't be mistaken for "cancel". */}
      <View style={styles.actions}>
        <Button
          title={t('common.cancel')}
          variant="secondary"
          onPress={() => router.back()}
          style={styles.flex}
        />
        <Button title={t('common.save')} onPress={save} disabled={!canSave} style={styles.flex} />
      </View>

      <View style={[styles.divider, { backgroundColor: theme.border }]} />

      <Button title={t('shoppingItemEditor.remove')} variant="danger" onPress={remove} />
    </SheetScreen>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: Spacing.two,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: Spacing.one,
  },
  flex: {
    flex: 1,
  },
});
