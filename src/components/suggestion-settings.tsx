import { useValue } from '@legendapp/state/react';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';

import { Button } from '@/components/button';
import { Icon } from '@/components/icon';
import { IngredientExclusions } from '@/components/ingredient-exclusions';
import { Stepper } from '@/components/stepper';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useHouseholdIngredientExclusions } from '@/lib/api/ingredient-exclusions';
import { hapticSelection } from '@/lib/haptics';
import { useT } from '@/lib/i18n';
import { store$ } from '@/lib/store/collections';
import {
  CONFLICTING_SHORTCUTS,
  PLANNING_SHORTCUTS,
  PLANNING_SOURCES,
  PREFERENCES_MAX,
  SAVED_SHORTCUTS,
  type PlanningPreferences,
  type PlanningShortcut,
  type PlanningSource,
} from '@/lib/week-suggestions';

const EMPTY_PREFERENCES: PlanningPreferences = { text: '', shortcuts: [], excluded: [] };

/** The household's remembered planning choices, shared by every way of asking for dinners. */
export function usePlanningPreferences() {
  const preferences = useValue(store$.meta.planningPreferences) ?? EMPTY_PREFERENCES;
  const source = preferences.source ?? 'mix';
  function remember(patch: Partial<PlanningPreferences>) {
    store$.meta.planningPreferences.set({ ...EMPTY_PREFERENCES, ...store$.meta.planningPreferences.get(), ...patch });
  }
  // `ai`: new recipes are part of the mix, so free text and every wish apply.
  return { preferences, source, ai: source !== 'saved', remember };
}

type SettingsProps = {
  /** Which row is open; rows passed as `children` share it. */
  expanded: string | null;
  onToggle: (row: string) => void;
  /** Unsaved ingredient edits hold the request back until they're saved. */
  onEditingExclusionsChange?: (editing: boolean) => void;
  /** Rows above the shared ones: the planner's days, a day's servings. */
  children?: ReactNode;
  /** Shown under the card. */
  note?: ReactNode;
};

/**
 * One card of the choices that shape suggestions — where dinners come from,
 * wishes, ingredients to avoid — each with its current value, opening in place
 * to change it. Changes are remembered for the household, so Plan the week and
 * a single day's suggestion always agree.
 */
export function SuggestionSettings({ expanded, onToggle, onEditingExclusionsChange, children, note }: SettingsProps) {
  const t = useT();
  const theme = useTheme();
  const { preferences, source, ai, remember } = usePlanningPreferences();
  const { exclusions } = useHouseholdIngredientExclusions();
  const [editingExclusions, setEditingExclusions] = useState(false);
  // The household's own dinners can only honour the wishes they have data for.
  const shortcuts = ai ? PLANNING_SHORTCUTS : SAVED_SHORTCUTS;
  const wishes = [...shortcuts.filter((value) => preferences.shortcuts.includes(value)).map((value) => t(`weekPlanning.${value}`)),
    ...(ai && preferences.text.trim() ? [preferences.text.trim()] : [])];

  function chooseSource(value: PlanningSource) {
    hapticSelection();
    remember({ source: value });
    onToggle('source');
  }

  function toggleShortcut(value: PlanningShortcut) {
    hapticSelection();
    const on = preferences.shortcuts.includes(value);
    remember({ shortcuts: on ? preferences.shortcuts.filter((item) => item !== value)
      : [...preferences.shortcuts.filter((item) => item !== CONFLICTING_SHORTCUTS[value]), value] });
  }

  return (
    <>
      <View style={styles.section}>
        <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
          {children}
          {children ? <Separator /> : null}
          <SettingRow label={t('weekPlanning.sourceLabel')} value={t(`weekPlanning.source.${source}`)}
            open={expanded === 'source'} onPress={() => onToggle('source')} />
          {expanded === 'source' ? (
            <View accessibilityRole="radiogroup">
              {PLANNING_SOURCES.map((value) => {
                const selected = value === source;
                return (
                  <Pressable key={value} accessibilityRole="radio" accessibilityState={{ selected }}
                    onPress={() => chooseSource(value)}
                    style={({ pressed }) => [styles.option, pressed && { backgroundColor: theme.backgroundSelected }]}>
                    <View style={styles.fill}>
                      <ThemedText>{t(`weekPlanning.source.${value}`)}</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">{t(`weekPlanning.sourceHint.${value}`)}</ThemedText>
                    </View>
                    {selected ? <Icon name="checkmark" size={16} weight="bold" color={theme.text} /> : null}
                  </Pressable>
                );
              })}
            </View>
          ) : null}

          <Separator />
          <SettingRow label={t('weekPlanning.wishes')} value={wishes.length ? wishes.join(', ') : t('weekPlanning.none')}
            open={expanded === 'wishes'} onPress={() => onToggle('wishes')} />
          {expanded === 'wishes' ? (
            <View style={styles.editor}>
              <View style={styles.chips}>
                {shortcuts.map((value) => {
                  const checked = preferences.shortcuts.includes(value);
                  return (
                    <Pressable key={value} accessibilityRole="checkbox" accessibilityState={{ checked }} hitSlop={3}
                      onPress={() => toggleShortcut(value)}
                      style={({ pressed }) => [styles.chip, { backgroundColor: checked ? theme.tint : theme.backgroundSelected },
                        pressed && styles.pressed]}>
                      <ThemedText type="small" style={{ color: checked ? theme.onTint : theme.text }}>{t(`weekPlanning.${value}`)}</ThemedText>
                    </Pressable>
                  );
                })}
              </View>
              {/* Free text only steers new recipes; the household's own are picked for variety. */}
              {ai ? (
                <NoteField accessibilityLabel={t('weekPlanning.preferences')} placeholder={t('weekPlanning.placeholder')}
                  value={preferences.text} onChangeText={(text) => remember({ text })} maxLength={PREFERENCES_MAX}
                  style={{ backgroundColor: theme.backgroundSelected }} />
              ) : null}
            </View>
          ) : null}

          <Separator />
          <SettingRow label={t('weekPlanning.avoid')} value={exclusions.length ? exclusions.join(', ') : t('weekPlanning.none')}
            open={expanded === 'exclusions'} onPress={() => onToggle('exclusions')} />
          {expanded === 'exclusions' ? (
            <View style={styles.editor}>
              <IngredientExclusions hideLabel inputStyle={{ backgroundColor: theme.backgroundSelected }}
                onPendingChange={(pending) => {
                  setEditingExclusions(pending);
                  onEditingExclusionsChange?.(pending);
                }} />
            </View>
          ) : null}
        </View>
        {editingExclusions ? <ThemedText type="small" style={styles.label}>{t('ingredientExclusions.saveFirst')}</ThemedText> : null}
        {note}
      </View>

      {preferences.excluded.length > 0 ? (
        <Button size="small" variant="secondary" onPress={() => remember({ excluded: [] })}
          title={t('weekPlanning.resetExcluded', { count: preferences.excluded.length })} />
      ) : null}
    </>
  );
}

/** A settings line: what it is, its current value, and a chevron that opens the choices below it. */
export function SettingRow({ label, value, open, onPress }: { label: string; value: string; open: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={`${label}, ${value}`}
      onPress={onPress} style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.backgroundSelected }]}>
      <ThemedText style={styles.bold}>{label}</ThemedText>
      <ThemedText numberOfLines={1} themeColor="textSecondary" style={styles.value}>{value}</ThemedText>
      <Icon name={open ? 'chevron.up' : 'chevron.down'} size={13} color={theme.textSecondary} />
    </Pressable>
  );
}

/** A settings line whose value is changed right there with a stepper. */
export function StepperRow({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <View style={[styles.row, styles.stepperRow]}>
      <ThemedText style={[styles.bold, styles.fill]}>{label}</ThemedText>
      <Stepper compact value={value} accessibilityLabel={label} onChange={onChange} />
    </View>
  );
}

export function Separator({ inset }: { inset?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  return <View style={[styles.separator, inset, { backgroundColor: theme.border }]} />;
}

/** A multiline wish field with a pencil, for the free-text parts of a request. */
export function NoteField({ style, ...props }: {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  accessibilityLabel: string;
  maxLength: number;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.note, style]}>
      <Icon name="pencil" size={14} color={theme.textSecondary} style={styles.noteIcon} />
      <TextInput multiline placeholderTextColor={theme.textSecondary} {...props}
        style={[styles.noteInput, { color: theme.text }]} />
    </View>
  );
}

export const settingStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, minHeight: 52, paddingHorizontal: Spacing.three },
  // Lines up with the text inside the card.
  label: { paddingHorizontal: Spacing.three },
});

const styles = StyleSheet.create({
  ...settingStyles,
  fill: { flex: 1 },
  bold: { fontWeight: 600 },
  pressed: { opacity: 0.6 },
  section: { gap: Spacing.two },
  card: { borderRadius: Spacing.three, overflow: 'hidden' },
  stepperRow: { paddingRight: Spacing.one },
  value: { flex: 1, textAlign: 'right' },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: Spacing.three },
  // The choices hang under their row, indented so they read as its answers.
  option: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, minHeight: 56,
    paddingVertical: Spacing.two, paddingLeft: Spacing.four + Spacing.two, paddingRight: Spacing.three },
  editor: { gap: Spacing.two, paddingHorizontal: Spacing.three, paddingBottom: Spacing.three },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: { minHeight: 36, justifyContent: 'center', borderRadius: 999, paddingHorizontal: Spacing.three },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two, borderRadius: Spacing.three, paddingHorizontal: Spacing.three },
  noteIcon: { marginTop: 15 },
  noteInput: { flex: 1, minHeight: 44, maxHeight: 120, paddingTop: 12, paddingBottom: 12, fontSize: 16 },
});
