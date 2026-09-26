import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { DinnerCategorySelect } from '@/components/dinner-category-select';
import { DinnerImage } from '@/components/dinner-image';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { HeaderMenu, MenuAction } from '@/components/header-menu';
import { Icon } from '@/components/icon';
import { IngredientSuggestions } from '@/components/ingredient-suggestions';
import { Screen } from '@/components/screen';
import { Stepper } from '@/components/stepper';
import { SwipeToDelete } from '@/components/swipe-to-delete';
import { ThemedText } from '@/components/themed-text';
import { UnitChips } from '@/components/unit-chips';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { dinnerCategory } from '@/lib/dinner-categories';
import { useT } from '@/lib/i18n';
import { pushOnce } from '@/lib/navigation';
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
import { deleteWithUndo, useHiddenIds } from '@/lib/undo';

const PICTURE_SIZE = 88;

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
  // An ingredient removed with Undo still pending is gone from the list at once.
  const hidden = useHiddenIds();
  const items = dinner.items.filter((item) => !hidden[item.id]).map((item) => {
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

  // Like every other delete: gone at once, with a moment to take it back.
  function removeItem(itemId: string) {
    const item = items.find((row) => row.id === itemId);
    if (!item) return;
    const dinnerId = dinner.id;
    if (focusedItem === itemId) setFocusedItem(null);
    deleteWithUndo(t('undo.itemRemoved', { name: item.ingredient_name }), [itemId], () =>
      removeDinnerItem(dinnerId, itemId),
    );
  }

  function onDelete() {
    const id = dinner.id;
    router.back();
    deleteWithUndo(t('undo.dinnerDeleted', { name: dinner.name }), [id], () => deleteDinner(id));
  }

  const focused = items.find((item) => item.id === focusedItem);
  const focusedUnit = focused ? parseAmount(focused.amount).unit : null;

  return (
    <>
      {/* The name is the page's own title below; repeating it in the bar read as a duplicate. */}
      <HeaderMenu>
        <MenuAction icon="trash" destructive onPress={onDelete}>
          {t('dinners.deleteDinner')}
        </MenuAction>
      </HeaderMenu>

      <Screen topInset={false} refreshable={false}>
        <View style={styles.page}>
          <View style={styles.hero}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('dinnerImage.change')}
              onPress={() => { setFocusedItem(null); pushOnce({ pathname: '/sheets/dinner-image', params: { dinnerId: dinner.id } }); }}
              style={({ pressed }) => [styles.picture, pressed && styles.picturePressed]}>
              <DinnerImage dinnerId={dinner.id} name={name} size={PICTURE_SIZE} />
              <View style={[styles.pictureBadge, { backgroundColor: theme.tint, borderColor: theme.background }]}>
                <Icon name="pencil" size={11} weight="bold" color={theme.onTint} />
              </View>
            </Pressable>
            <TextInput
              accessibilityLabel={t('dinners.name')}
              value={name}
              onChangeText={setName}
              onFocus={() => setFocusedItem(null)}
              placeholder={t('dinners.placeholder')}
              placeholderTextColor={theme.textSecondary}
              autoCapitalize="sentences"
              maxLength={255}
              multiline
              submitBehavior="blurAndSubmit"
              returnKeyType="done"
              style={[styles.nameInput, { color: theme.text }]}
            />
            <DinnerCategorySelect value={dinnerCategory(dinner.category) ?? 'none'}
              onChange={(value) => patchDinner(dinner.id, { category: dinnerCategory(value) })} />
            <Card style={styles.servingsRow}>
              <ThemedText style={styles.servingsLabel}>{t('dinners.recipeServings')}</ThemedText>
              <Stepper
                compact
                value={servings}
                onChange={(default_servings) => patchDinner(dinner.id, { default_servings })}
                min={1}
                max={99}
                accessibilityLabel={t('dinners.defaultServings')}
              />
            </Card>
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHeading}>
              <ThemedText accessibilityRole="header" style={styles.sectionTitle}>{t('dinners.ingredients')}</ThemedText>
              {items.length > 0 ? (
                <View style={[styles.countBadge, { backgroundColor: theme.backgroundSelected }]}>
                  <ThemedText type="smallBold" themeColor="textSecondary" style={styles.count}>{items.length}</ThemedText>
                </View>
              ) : null}
            </View>
            <View style={styles.group}>
              <Card style={styles.itemsCard}>
                {items.length === 0 ? (
                  <ThemedText style={styles.empty} type="small" themeColor="textSecondary">
                    {t('dinners.noIngredients')}
                  </ThemedText>
                ) : (
                  items.map((item, index) => (
                    <View
                      key={item.id}
                      style={index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border }}>
                      <SwipeToDelete label={t('common.remove')} onDelete={() => removeItem(item.id)}>
                        <View style={[styles.item, { backgroundColor: theme.backgroundElement }]}>
                          <ThemedText
                            style={styles.itemName}
                            accessibilityActions={[{ name: 'delete', label: t('dinners.removeIngredient', { name: item.ingredient_name }) }]}
                            onAccessibilityAction={({ nativeEvent }) => {
                              if (nativeEvent.actionName === 'delete') removeItem(item.id);
                            }}>
                            {item.ingredient_name}
                          </ThemedText>
                          <TextInput
                            value={item.amount}
                            onChangeText={(value) => updateAmount(item.id, value)}
                            onFocus={() => setFocusedItem(item.id)}
                            onSubmitEditing={() => setFocusedItem(null)}
                            returnKeyType="done"
                            placeholder={t('dinners.amountPlaceholder')}
                            placeholderTextColor={theme.textSecondary}
                            accessibilityLabel={`${t('dinners.amount')} ${item.ingredient_name}`}
                            autoCapitalize="none"
                            autoCorrect={false}
                            style={[
                              styles.amount,
                              {
                                backgroundColor: theme.background,
                                color: theme.text,
                                borderColor: focusedItem === item.id ? theme.tint : theme.border,
                              },
                              !isAmountValid(item.amount) && { borderColor: theme.danger },
                            ]}
                          />
                        </View>
                      </SwipeToDelete>
                      {focusedItem === item.id ? (
                        <View style={styles.unitPicker}>
                          <UnitChips value={focusedUnit} onPick={pickUnit} onCard inset={Spacing.three} />
                        </View>
                      ) : null}
                    </View>
                  ))
                )}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('dinners.addIngredient')}
                  onPress={() => openIngredientPicker(addIngredient)}
                  style={({ pressed }) => [
                    styles.addIngredient,
                    { borderTopColor: theme.border },
                    pressed && { backgroundColor: theme.backgroundSelected },
                  ]}>
                  <View style={[styles.addGlyph, { backgroundColor: theme.tint }]}>
                    <Icon name="plus" size={12} weight="bold" color={theme.onTint} />
                  </View>
                  <ThemedText style={[styles.addLabel, { color: theme.tint }]}>{t('dinners.addIngredient')}</ThemedText>
                </Pressable>
              </Card>
              {items.some((item) => !isAmountValid(item.amount)) ? (
                <ThemedText type="small" style={[styles.footnote, { color: theme.danger }]}>
                  {t('dinners.amountInvalid')}
                </ThemedText>
              ) : items.length > 0 ? (
                <ThemedText type="small" themeColor="textSecondary" style={styles.footnote}>
                  {t('dinners.ingredientsHint')}
                </ThemedText>
              ) : null}
            </View>
            <IngredientSuggestions
              dinnerId={dinner.id}
              category={dinnerCategory(dinner.category)}
              name={name}
              ingredients={items.map((item) => item.ingredient_name)}
              onAdd={(suggestion) => {
                const ingredient = getIngredient(createIngredient({ name: suggestion }));
                if (ingredient) addIngredient({ ingredient, quantity: null, unit: null });
              }}
            />
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHeading}>
              <ThemedText accessibilityRole="header" style={styles.sectionTitle}>{t('dinners.notesHeading')}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">{t('dinners.optional')}</ThemedText>
            </View>
            <TextInput
              accessibilityLabel={t('dinners.notes')}
              value={notes}
              onChangeText={(notes) => patchDinner(dinner.id, { notes })}
              onFocus={() => setFocusedItem(null)}
              maxLength={5000}
              placeholder={t('dinners.notesPlaceholder')}
              placeholderTextColor={theme.textSecondary}
              multiline
              textAlignVertical="top"
              style={[styles.notes, { color: theme.text, backgroundColor: theme.backgroundElement }]}
            />
          </View>
        </View>
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  // Wider gaps between sections than inside them, so each heading reads as
  // belonging to the content under it rather than the content above.
  page: {
    gap: Spacing.five,
  },
  hero: {
    gap: Spacing.three,
  },
  picture: {
    alignSelf: 'flex-start',
  },
  picturePressed: {
    opacity: 0.8,
  },
  pictureBadge: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameInput: {
    padding: 0,
    fontSize: 30,
    lineHeight: 36,
    fontWeight: 700,
    letterSpacing: -0.4,
  },
  servingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    paddingVertical: Spacing.two,
    paddingLeft: Spacing.three,
    paddingRight: Spacing.two,
  },
  servingsLabel: {
    flexShrink: 1,
    fontWeight: 600,
  },
  section: {
    gap: Spacing.two,
  },
  sectionHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.one,
  },
  sectionTitle: {
    fontSize: 20,
    lineHeight: 28,
    fontWeight: 700,
  },
  countBadge: {
    minWidth: 24,
    paddingHorizontal: Spacing.two,
    borderRadius: 999,
    alignItems: 'center',
  },
  count: {
    fontSize: 13,
    lineHeight: 22,
    fontVariant: ['tabular-nums'],
  },
  group: {
    gap: Spacing.two,
  },
  itemsCard: {
    gap: 0,
    padding: 0,
    overflow: 'hidden',
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingLeft: Spacing.three,
    paddingRight: Spacing.two,
    paddingVertical: Spacing.two,
    minHeight: 56,
  },
  itemName: {
    flex: 1,
  },
  amount: {
    width: 96,
    minHeight: 40,
    borderRadius: 10,
    paddingHorizontal: Spacing.two + Spacing.one,
    fontSize: 16,
    fontVariant: ['tabular-nums'],
    borderWidth: 1,
    textAlign: 'right',
  },
  unitPicker: {
    paddingBottom: Spacing.three,
  },
  addIngredient: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    minHeight: 52,
    paddingHorizontal: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  addGlyph: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addLabel: {
    fontWeight: 600,
  },
  empty: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.four,
  },
  footnote: {
    paddingHorizontal: Spacing.three,
    fontSize: 13,
    lineHeight: 18,
  },
  notes: {
    minHeight: 120,
    borderRadius: Spacing.three,
    padding: Spacing.three,
    fontSize: 16,
    lineHeight: 24,
  },
});
