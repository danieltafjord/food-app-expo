import { useEffect, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Button } from '@/components/button';
import { Icon } from '@/components/icon';
import { OptionGroup } from '@/components/option-group';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { DINNER_CATEGORIES, type DinnerCategoryFilter } from '@/lib/dinner-categories';
import { useT } from '@/lib/i18n';
import { deleteDinnerCategory, findDinnerCategory, normalizeCategoryName, saveDinnerCategory, useDinnerCategories, useDinnerCategoryLabel } from '@/lib/store/dinner-categories';

/** One picker for assignments and filters, with household category management. */
export function DinnerCategorySelect({ value, onChange, filter = false }: {
  value: DinnerCategoryFilter;
  onChange: (value: DinnerCategoryFilter) => void;
  filter?: boolean;
}) {
  const t = useT();
  const theme = useTheme();
  const categories = useDinnerCategories();
  const label = useDinnerCategoryLabel();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'choose' | 'manage' | 'edit' | 'delete'>('choose');
  const [editing, setEditing] = useState<string>();
  const [name, setName] = useState('');
  const choices: DinnerCategoryFilter[] = [...(filter ? ['all'] : []), ...DINNER_CATEGORIES, ...categories.map((row) => row.id), 'none'];
  const normalized = normalizeCategoryName(name);
  const builtin = DINNER_CATEGORIES.find((id) => label(id).toLocaleLowerCase() === normalized.toLocaleLowerCase());
  const duplicate = builtin ?? findDinnerCategory(name, editing);
  const valid = normalized.length > 0 && Array.from(normalized).length <= 80 && !(editing && duplicate);
  // A deletion on another device should not leave a now-invisible filter active.
  const missingFilter = filter && !choices.includes(value);
  useEffect(() => { if (missingFilter) onChange('all'); }, [missingFilter, onChange]);
  const edit = (id?: string) => {
    setEditing(id);
    setName(id ? categories.find((row) => row.id === id)?.name ?? '' : '');
    setMode('edit');
  };
  const save = () => {
    if (!valid) return;
    const id = !editing && builtin ? builtin : saveDinnerCategory(name, editing);
    if (!id) { setMode('manage'); return; }
    Keyboard.dismiss();
    if (editing) setMode('manage');
    else { onChange(id); setOpen(false); }
  };
  return (
    <View style={styles.group}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }}
        accessibilityLabel={`${t('dinnerCategories.label')}: ${label(value)}`}
        onPress={() => { Keyboard.dismiss(); setMode('choose'); setOpen(true); }}
        style={({ pressed }) => [styles.row, { backgroundColor: theme.backgroundElement }, pressed && styles.pressed]}>
        <View style={styles.label}>
          <ThemedText type="small" themeColor="textSecondary">{t(filter ? 'dinnerCategories.label' : 'dinnerCategories.optional')}</ThemedText>
          <ThemedText>{label(value)}</ThemedText>
        </View>
        <Icon name="chevron.right" size={14} color={theme.textSecondary} />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.overlay}>
          <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: theme.scrim }]}
            accessibilityRole="button" accessibilityLabel={t('common.cancel')} onPress={() => setOpen(false)} />
          <View accessibilityViewIsModal style={[styles.dialog, { backgroundColor: theme.background }]}>
            <ThemedText type="subtitle" accessibilityRole="header">{t(mode === 'edit' ? editing ? 'dinnerCategories.rename' : 'dinnerCategories.add' : mode === 'delete' ? 'dinnerCategories.delete' : mode === 'manage' ? 'dinnerCategories.manage' : 'dinnerCategories.label')}</ThemedText>
            {mode === 'choose' ? <>
              <ScrollView bounces={false}>
                <OptionGroup value={value} options={choices.map((value) => ({ value, label: label(value) }))}
                  onChange={(next) => { onChange(next); setOpen(false); }} />
              </ScrollView>
              <Button title={t('dinnerCategories.add')} onPress={() => edit()} />
              {categories.length > 0 && <Button title={t('dinnerCategories.manage')} variant="secondary" onPress={() => setMode('manage')} />}
            </> : mode === 'manage' ? <>
              <ThemedText type="small" themeColor="textSecondary">{t('dinnerCategories.shared')}</ThemedText>
              <ScrollView bounces={false}>
                {categories.map((row) => <Pressable key={row.id} accessibilityRole="button" accessibilityLabel={t('dinnerCategories.editNamed', { name: row.name })}
                  style={styles.row} onPress={() => edit(row.id)}>
                  <ThemedText style={styles.label}>{row.name}</ThemedText>
                  <Icon name="chevron.right" size={14} color={theme.textSecondary} />
                </Pressable>)}
              </ScrollView>
              <Button title={t('dinnerCategories.add')} onPress={() => edit()} />
            </> : mode === 'delete' ? <>
              <ThemedText>{t('dinnerCategories.deleteMessage', { name: label(editing) })}</ThemedText>
              <Button title={t('dinnerCategories.delete')} variant="danger" onPress={() => {
                if (editing) deleteDinnerCategory(editing);
                if (value === editing) onChange(filter ? 'all' : 'none');
                setMode('manage');
              }} />
            </> : <>
              <TextInput autoFocus value={name} onChangeText={setName} maxLength={80} returnKeyType="done" onSubmitEditing={save}
                accessibilityLabel={t('dinnerCategories.name')} placeholder={t('dinnerCategories.name')} placeholderTextColor={theme.textSecondary}
                style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]} />
              <ThemedText type="small" themeColor="textSecondary">{editing && duplicate ? t('dinnerCategories.duplicate') : t('dinnerCategories.shared')}</ThemedText>
              <Button title={t('common.save')} disabled={!valid} onPress={save} />
              {editing && <Button title={t('dinnerCategories.delete')} variant="danger" onPress={() => { Keyboard.dismiss(); setMode('delete'); }} />}
            </>}
            <Button title={t('common.cancel')} variant="secondary" onPress={() => {
              Keyboard.dismiss();
              if (mode === 'choose') setOpen(false);
              else setMode(mode === 'delete' ? 'edit' : 'choose');
            }} />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, padding: Spacing.three, borderRadius: Spacing.three, minHeight: 48 },
  label: { flex: 1, gap: Spacing.half },
  input: { minHeight: 52, padding: Spacing.three, borderRadius: Spacing.two, fontSize: 17 },
  pressed: { opacity: 0.7 },
  overlay: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.four },
  dialog: { width: '100%', maxWidth: 420, maxHeight: '80%', padding: Spacing.three, borderRadius: Spacing.three, gap: Spacing.three },
});
