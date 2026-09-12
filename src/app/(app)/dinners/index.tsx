import { router } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { SwipeToDelete } from '@/components/swipe-to-delete';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BadgeColors, BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useSyncRefresh } from '@/hooks/use-sync-refresh';
import { useResolvedScheme, useTheme } from '@/hooks/use-theme';
import { useT } from '@/lib/i18n';
import { findExact, indexByName, searchIndex } from '@/lib/search';
import { createDinner, deleteDinner, useDinners, type DinnerWithItems } from '@/lib/store';

const SWAP = 140;
const FADE_IN = FadeIn.duration(SWAP);
const FADE_OUT = FadeOut.duration(SWAP);

/**
 * The recipe list, behind the same "search or create" field the pickers use:
 * typing filters the household's dinners, and a name that doesn't exist yet
 * is created (and opened) from the action card or the return key. A
 * virtualised `FlatList` rather than the shared `Screen` ScrollView: this is
 * the one list that grows without bound.
 */
export default function DinnersScreen() {
  const t = useT();
  const theme = useTheme();
  const brand = BadgeColors[useResolvedScheme()].brand;
  const dinners = useDinners();
  const { refreshing, onRefresh } = useSyncRefresh();
  const [query, setQuery] = useState('');
  // One create per typed name — a "done" + tap double-fire would otherwise
  // create two dinners with the same name.
  const created = useRef(false);

  const index = useMemo(() => indexByName(dinners, (dinner) => dinner.name), [dinners]);
  const trimmed = query.trim();
  const results = useMemo(() => searchIndex(index, trimmed), [index, trimmed]);
  const exact = useMemo(() => findExact(index, trimmed), [index, trimmed]);
  const action: 'idle' | 'create' | 'open' = !trimmed ? 'idle' : exact ? 'open' : 'create';
  const idle = action === 'idle';

  function openDinner(id: string) {
    router.push({ pathname: '/dinners/[id]', params: { id } });
  }

  function onCreate() {
    if (action !== 'create' || created.current) return;
    created.current = true;
    const id = createDinner({ name: trimmed });
    setQuery('');
    openDinner(id);
  }

  function onSubmit() {
    if (exact) {
      setQuery('');
      openDinner(exact.id);
    } else {
      onCreate();
    }
  }

  function confirmDelete(dinner: DinnerWithItems) {
    Alert.alert(t('dinners.deleteDinnerTitle'), t('dinners.deleteDinnerMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: () => deleteDinner(dinner.id) },
    ]);
  }

  const actionTitle =
    action === 'create'
      ? t('dinners.create', { name: trimmed })
      : action === 'open'
        ? t('dinners.open', { name: trimmed })
        : t('dinners.idleTitle');
  const actionHint =
    action === 'create'
      ? t('dinners.createHint')
      : action === 'open'
        ? t('dinners.openHint')
        : t('dinners.idleHint');

  return (
    <ThemedView style={styles.flex}>
      <FlatList
        data={results}
        keyExtractor={(dinner) => dinner.id}
        renderItem={({ item, index: i }) => (
          <DinnerRow
            dinner={item}
            first={i === 0}
            last={i === results.length - 1}
            onPress={openDinner}
            onDelete={confirmDelete}
          />
        )}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View style={styles.header}>
            <TextField
              label={t('dinners.searchOrCreate')}
              placeholder={t('dinners.placeholder')}
              value={query}
              onChangeText={(text) => {
                created.current = false;
                setQuery(text);
              }}
              autoCapitalize="sentences"
              autoCorrect={false}
              returnKeyType="done"
              blurOnSubmit={false}
              onSubmitEditing={onSubmit}
            />
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
                    <ThemedText
                      themeColor={idle ? 'textSecondary' : 'onTint'}
                      style={styles.actionGlyph}>
                      {action === 'open' ? '›' : '＋'}
                    </ThemedText>
                  </View>
                  <View style={styles.flexText}>
                    <ThemedText
                      type="smallBold"
                      themeColor={idle ? 'textSecondary' : undefined}
                      style={idle ? undefined : { color: brand.fg }}
                      numberOfLines={1}>
                      {actionTitle}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                      {actionHint}
                    </ThemedText>
                  </View>
                </Pressable>
              </Animated.View>
            </View>
          </View>
        }
        ListEmptyComponent={
          <ThemedText themeColor="textSecondary">
            {trimmed ? t('dinners.noMatches') : t('dinners.empty')}
          </ThemedText>
        }
        // Rows render as one continuous card: the list itself carries the card
        // surface, and each row draws its own divider.
        style={styles.flex}
      />
    </ThemedView>
  );
}

type DinnerRowProps = {
  dinner: DinnerWithItems;
  first: boolean;
  last: boolean;
  onPress: (id: string) => void;
  onDelete: (dinner: DinnerWithItems) => void;
};

function DinnerRow({ dinner, first, last, onPress, onDelete }: DinnerRowProps) {
  const t = useT();
  const theme = useTheme();
  const warning = BadgeColors[useResolvedScheme()].warning;
  const count = dinner.items.length;
  return (
    // Clipped so the sliding row keeps the card's rounded corners.
    <View style={[first && styles.rowFirst, last && styles.rowLast, styles.clip]}>
      <SwipeToDelete label={t('common.delete')} onDelete={() => onDelete(dinner)}>
        <Pressable
          onPress={() => onPress(dinner.id)}
          style={({ pressed }) => [
            styles.row,
            { backgroundColor: theme.backgroundElement },
            !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
            pressed && styles.pressed,
          ]}>
          <View style={styles.rowText}>
            <ThemedText numberOfLines={1}>{dinner.name}</ThemedText>
            {count === 0 ? (
              <ThemedText type="small" style={{ color: warning.fg }}>
                {t('weekBoard.noIngredients')} · {dinner.default_servings} {t('common.servings')}
              </ThemedText>
            ) : (
              <ThemedText type="small" themeColor="textSecondary">
                {count} {count === 1 ? t('common.ingredient') : t('common.ingredients')} ·{' '}
                {dinner.default_servings} {t('common.servings')}
              </ThemedText>
            )}
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            ›
          </ThemedText>
        </Pressable>
      </SwipeToDelete>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  flexText: {
    flexShrink: 1,
    flexGrow: 1,
  },
  content: {
    flexGrow: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    paddingBottom: BottomTabInset + Spacing.five,
  },
  header: {
    gap: Spacing.three,
    marginBottom: Spacing.four,
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
  clip: {
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
  },
  rowFirst: {
    borderTopLeftRadius: Spacing.three,
    borderTopRightRadius: Spacing.three,
  },
  rowLast: {
    borderBottomLeftRadius: Spacing.three,
    borderBottomRightRadius: Spacing.three,
  },
  rowText: {
    flexShrink: 1,
    gap: Spacing.half,
  },
  pressed: {
    opacity: 0.6,
  },
});
