import { useState } from 'react';
import { StyleSheet, View, type StyleProp, type TextStyle } from 'react-native';

import { Button } from '@/components/button';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useActiveHousehold } from '@/lib/api/households';
import { useHouseholdIngredientExclusions } from '@/lib/api/ingredient-exclusions';
import { useSession } from '@/lib/auth/session';
import { useT } from '@/lib/i18n';
import { parseIngredientExclusions } from '@/lib/ingredient-exclusions';

type Props = {
  onPendingChange?: (pending: boolean) => void;
  disabled?: boolean;
  hideLabel?: boolean;
  /** For an editor inside a card, whose background would hide the field's own. */
  inputStyle?: StyleProp<TextStyle>;
};

export function IngredientExclusions({ onPendingChange, disabled, hideLabel, inputStyle }: Props) {
  const { user, isAuthenticated } = useSession();
  return <ExclusionsEditor key={isAuthenticated ? `${user?.id}/${user?.current_household?.id}` : 'guest'} onPendingChange={onPendingChange}
    disabled={disabled} hideLabel={hideLabel} inputStyle={inputStyle} />;
}

function ExclusionsEditor({ onPendingChange, disabled, hideLabel, inputStyle }: Props) {
  const t = useT();
  const { isAuthenticated } = useSession();
  const { isOwner } = useActiveHousehold();
  const { exclusions, ready, query, update } = useHouseholdIngredientExclusions();
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const editable = !isAuthenticated || isOwner;
  function save() {
    let names: string[];
    try { names = parseIngredientExclusions(draft ?? exclusions.join(', ')); }
    catch { setInvalid(true); return; }
    setInvalid(false);
    update.mutate(names, { onSuccess: () => { setDraft(null); onPendingChange?.(false); } });
  }
  return <View style={styles.content}>
    <TextField label={t('ingredientExclusions.title')} hideLabel={hideLabel} style={inputStyle} accessibilityLabel={t('ingredientExclusions.title')}
      placeholder={t('ingredientExclusions.placeholder')} multiline maxLength={2450}
      value={draft ?? exclusions.join(', ')} editable={editable && ready && !update.isPending && !disabled}
      onChangeText={(value) => { setDraft(value); setInvalid(false); onPendingChange?.(true); }}
      error={invalid ? t('ingredientExclusions.invalid') : null} />
    <ThemedText type="small" themeColor="textSecondary">{t(isAuthenticated ? 'ingredientExclusions.sharedHint' : 'ingredientExclusions.localHint')}</ThemedText>
    {isAuthenticated && !isOwner ? <ThemedText type="small" themeColor="textSecondary">{t('ingredientExclusions.ownerHint')}</ThemedText> : null}
    {query.isError ? <>
      <ThemedText type="small">{t('ingredientExclusions.loadFailed')}</ThemedText>
      <Button title={t('error.retry')} variant="secondary" size="small" onPress={() => { void query.refetch(); }} />
    </> : !ready ? <ThemedText type="small">{t('ingredientExclusions.loading')}</ThemedText> : null}
    {update.isError ? <ThemedText type="small">{t('ingredientExclusions.saveFailed')}</ThemedText> : null}
    {editable && draft !== null ? <Button title={t('common.save')} size="small" loading={update.isPending} disabled={!ready || disabled}
      onPress={save} /> : null}
  </View>;
}

const styles = StyleSheet.create({ content: { gap: Spacing.two } });
