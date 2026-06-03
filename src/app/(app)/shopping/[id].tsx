import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { IngredientPicker } from '@/components/ingredient-picker';
import { Screen } from '@/components/screen';
import { ShoppingItemEditor, type ShoppingItemEdit } from '@/components/shopping-item-editor';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatQuantity } from '@/lib/format';
import { useT } from '@/lib/i18n';
import {
  addShoppingItem,
  deleteShoppingList,
  removeShoppingItem,
  toggleShoppingItem,
  updateShoppingItem,
  useShoppingList,
  useShoppingListItems,
  type LocalIngredient,
  type ShoppingListItemWithIngredient,
} from '@/lib/store';

export default function ShoppingListScreen() {
  const t = useT();
  const theme = useTheme();
  const params = useLocalSearchParams<{ id: string }>();
  const list = useShoppingList(params.id);
  const items = useShoppingListItems(params.id);

  const [newItem, setNewItem] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editing, setEditing] = useState<ShoppingListItemWithIngredient | null>(null);

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
  const checkedCount = items.filter((it) => it.is_checked).length;

  function onAddFreeText() {
    const trimmed = newItem.trim();
    if (!trimmed) {
      return;
    }
    addShoppingItem(listId, { name: trimmed });
    setNewItem('');
  }

  function onPickIngredient(ingredient: LocalIngredient) {
    setPickerOpen(false);
    addShoppingItem(listId, { ingredient_id: ingredient.id, unit: ingredient.default_unit });
  }

  function onSaveItem(item: ShoppingListItemWithIngredient, edit: ShoppingItemEdit) {
    updateShoppingItem(item.id, { name: edit.name, quantity: edit.quantity, unit: edit.unit });
    setEditing(null);
  }

  function onRemoveItem(item: ShoppingListItemWithIngredient) {
    removeShoppingItem(item.id);
    setEditing(null);
  }

  function onDeleteList() {
    deleteShoppingList(listId);
    router.back();
  }

  return (
    <Screen topInset={false}>
      <View style={styles.heading}>
        <ThemedText type="subtitle">{list.name}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {items.length === 0
            ? t('shopping.emptyList')
            : t('shopping.checkedCount', { checked: checkedCount, total: items.length })}
        </ThemedText>
      </View>

      <Card>
        <ThemedText type="smallBold">{t('shopping.addItem')}</ThemedText>
        <View style={styles.addRow}>
          <View style={styles.flex}>
            <TextField
              label={t('shopping.item')}
              placeholder={t('shopping.itemPlaceholder')}
              value={newItem}
              onChangeText={setNewItem}
              returnKeyType="done"
              onSubmitEditing={onAddFreeText}
            />
          </View>
          <Button
            title={t('common.add')}
            onPress={onAddFreeText}
            disabled={!newItem.trim()}
            style={styles.addButton}
          />
        </View>
        <Button
          title={t('shopping.fromIngredients')}
          variant="secondary"
          size="small"
          onPress={() => setPickerOpen(true)}
        />
      </Card>

      {items.length > 0 ? (
        <Card>
          {items.map((item, index) => {
            const qty = formatQuantity(item.quantity, item.unit);
            return (
              <View
                key={item.id}
                style={[
                  styles.itemRow,
                  index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
                ]}>
                <Pressable
                  onPress={() => toggleShoppingItem(item.id)}
                  hitSlop={4}
                  style={styles.itemMain}>
                  <View
                    style={[
                      styles.checkbox,
                      { borderColor: theme.border },
                      item.is_checked && { backgroundColor: theme.tint, borderColor: theme.tint },
                    ]}>
                    {item.is_checked ? (
                      <ThemedText style={[styles.check, { color: theme.onTint }]}>✓</ThemedText>
                    ) : null}
                  </View>
                  <View style={styles.flex}>
                    <ThemedText
                      numberOfLines={1}
                      style={item.is_checked ? styles.checkedText : undefined}>
                      {item.ingredient_name ?? item.name ?? t('common.itemFallback')}
                    </ThemedText>
                    {qty ? (
                      <ThemedText type="small" themeColor="textSecondary">
                        {qty}
                      </ThemedText>
                    ) : null}
                  </View>
                </Pressable>
                <Pressable onPress={() => setEditing(item)} hitSlop={8} style={styles.editButton}>
                  <ThemedText type="subtitle" themeColor="textSecondary">
                    ⋯
                  </ThemedText>
                </Pressable>
              </View>
            );
          })}
        </Card>
      ) : (
        <ThemedText themeColor="textSecondary">{t('shopping.noItems')}</ThemedText>
      )}

      <Button title={t('shopping.deleteList')} variant="secondary" onPress={onDeleteList} />

      <IngredientPicker
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={onPickIngredient}
      />
      <ShoppingItemEditor
        item={editing}
        onClose={() => setEditing(null)}
        onSave={onSaveItem}
        onRemove={onRemoveItem}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: {
    gap: Spacing.half,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two,
  },
  addButton: {
    minWidth: 72,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.one,
  },
  itemMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  check: {
    fontWeight: 700,
    fontSize: 14,
    lineHeight: 16,
  },
  checkedText: {
    textDecorationLine: 'line-through',
    opacity: 0.5,
  },
  editButton: {
    paddingHorizontal: Spacing.one,
  },
  flex: {
    flexShrink: 1,
    flexGrow: 1,
  },
});
