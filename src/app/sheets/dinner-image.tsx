import { useValue } from '@legendapp/state/react';
import { useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Button } from '@/components/button';
import { DinnerImage, type DinnerPictureFields } from '@/components/dinner-image';
import { Icon, type IconName } from '@/components/icon';
import { SheetScreen } from '@/components/sheet';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { aiSettingsKey, useAiSettings } from '@/lib/api/ai';
import { ApiError } from '@/lib/api/client';
import { requestAi } from '@/lib/ai-request';
import { useSession } from '@/lib/auth/session';
import { DINNER_CATEGORIES, type BuiltinDinnerCategory } from '@/lib/dinner-categories';
import { queuePickedPhoto, type StoredImage } from '@/lib/dinner-image-upload';
import { FOOD_EMOJI, parseEmoji } from '@/lib/dinner-images';
import { hapticSelection } from '@/lib/haptics';
import { useT } from '@/lib/i18n';
import { getIngredient, setDinnerPicture, store$, useDinner, type DinnerPicture, type DinnerWithItems } from '@/lib/store';
import { useDinnerCategories } from '@/lib/store/dinner-categories';

const PREVIEW = 128;
const EMOJI_COLUMNS = 8;

/** Choose a dinner's picture: a photo, an AI-made one, or an emoji. Every choice saves immediately. */
export default function DinnerImageSheet() {
  const t = useT();
  const { dinnerId } = useLocalSearchParams<{ dinnerId: string }>();
  const dinner = useDinner(dinnerId);
  if (!dinner) {
    return (
      <SheetScreen title={t('dinnerImage.title')}>
        <Button title={t('common.back')} variant="secondary" onPress={() => router.back()} />
      </SheetScreen>
    );
  }
  return <PicturePicker key={dinner.id} dinner={dinner} />;
}

type Generation =
  | { status: 'idle' }
  | { status: 'generating' }
  | { status: 'preview'; image: StoredImage }
  | { status: 'error'; message: string };

function PicturePicker({ dinner }: { dinner: DinnerWithItems }) {
  const t = useT();
  const theme = useTheme();
  const client = useQueryClient();
  const { user, request } = useSession();
  const { settings } = useAiSettings();
  const categories = useDinnerCategories();
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const [generation, setGeneration] = useState<Generation>({ status: 'idle' });
  const pending = useValue(() => !!store$.meta.pendingImages[dinner.id].get());
  const boundAccount = useValue(store$.meta.accountId);
  const boundHousehold = useValue(store$.meta.serverHouseholdId);
  const hasPicture = pending || !!dinner.emoji || !!dinner.image_path;
  const signedInHere = !!user?.current_household && boundAccount === user.id && boundHousehold === user.current_household.id;
  const aiAllowance = settings?.usage.images;
  const canGenerate = signedInHere && !!settings?.available && !!aiAllowance && dinner.name.trim().length >= 2;

  function choose(picture: DinnerPicture) {
    hapticSelection();
    setDinnerPicture(dinner.id, picture);
    router.back();
  }

  async function pick(source: 'camera' | 'library') {
    if (busy) return;
    const permission = source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(t(source === 'camera' ? 'dinnerImage.cameraDenied' : 'dinnerImage.photosDenied'), undefined, [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('dinnerImage.openSettings'), onPress: () => { void Linking.openSettings(); } },
      ]);
      return;
    }
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 1 };
    const result = source === 'camera'
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);
    const asset = result.assets?.[0];
    if (result.canceled || !asset) return;
    setBusy(true);
    try {
      await queuePickedPhoto(dinner.id, asset);
      router.back();
    } catch {
      Alert.alert(t('dinnerImage.pickFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function generate() {
    setGeneration({ status: 'generating' });
    const category = DINNER_CATEGORIES.includes(dinner.category as BuiltinDinnerCategory)
      ? dinner.category
      : categories.find((row) => row.id === dinner.category)?.name ?? null;
    try {
      const image = await requestAi<StoredImage>(request, '/dinner-images/generate', {
        method: 'POST',
        body: {
          name: dinner.name.trim().slice(0, 120),
          ingredients: dinner.items.map((item) => getIngredient(item.ingredient_id)?.name).filter(Boolean).slice(0, 40),
          category,
        },
      }, 75_000);
      setGeneration({ status: 'preview', image });
    } catch (error) {
      const code = error instanceof ApiError ? (error.body as { code?: string } | undefined)?.code : undefined;
      setGeneration({
        status: 'error',
        message: t(code === 'daily_limit' ? 'dinnerImage.limitReached'
          : code === 'verification_required' ? 'dinnerImage.verifyEmail'
            : code === 'busy' || (error instanceof ApiError && error.status === 429) ? 'dinnerImage.busy'
              : 'dinnerImage.generateFailed'),
      });
    } finally {
      void client.invalidateQueries({ queryKey: aiSettingsKey(user?.id, user?.current_household?.id) });
    }
  }

  function submitCustom() {
    const emoji = parseEmoji(custom);
    if (emoji) choose({ kind: 'emoji', emoji });
  }

  const preview: DinnerPictureFields | undefined = generation.status === 'preview'
    ? { emoji: null, image_path: generation.image.path, image_thumbhash: generation.image.thumbhash }
    : undefined;

  return (
    <SheetScreen layout="fill">
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <View style={styles.previewWrap}>
          <DinnerImage dinnerId={dinner.id} picture={preview} name={dinner.name} size={PREVIEW} />
          {generation.status === 'generating' || busy ? (
            <View style={[styles.previewBusy, { width: PREVIEW, height: PREVIEW, backgroundColor: theme.scrim }]}>
              <ActivityIndicator color="#ffffff" />
            </View>
          ) : null}
        </View>
        {pending && generation.status === 'idle' ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.center}>{t('dinnerImage.uploading')}</ThemedText>
        ) : null}

        {generation.status === 'preview' ? (
          <View style={styles.previewActions}>
            <Button title={t('dinnerImage.usePicture')}
              onPress={() => choose({ kind: 'image', path: generation.image.path, thumbhash: generation.image.thumbhash })} />
            <Button title={t('dinnerImage.tryAgain')} variant="secondary"
              disabled={aiAllowance?.remaining === 0} onPress={() => { void generate(); }} />
          </View>
        ) : (
          <View style={styles.actions}>
            <Action icon="camera" label={t('dinnerImage.takePhoto')} disabled={busy} onPress={() => { void pick('camera'); }} />
            <Action icon="photo.on.rectangle" label={t('dinnerImage.choosePhoto')} disabled={busy} onPress={() => { void pick('library'); }} />
            {canGenerate ? (
              <Action icon="sparkles" label={t('dinnerImage.generate')}
                disabled={busy || generation.status === 'generating' || aiAllowance.remaining === 0}
                onPress={() => { void generate(); }} />
            ) : null}
          </View>
        )}
        {generation.status === 'error' ? (
          <ThemedText type="small" style={[styles.center, { color: theme.danger }]}>{generation.message}</ThemedText>
        ) : canGenerate ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
            {generation.status === 'generating' ? t('dinnerImage.generating')
              : t('dinnerImage.generateHint', { remaining: String(aiAllowance.remaining) })}
          </ThemedText>
        ) : null}

        <ThemedText type="smallBold">{t('dinnerImage.emoji')}</ThemedText>
        <View style={styles.grid}>
          {FOOD_EMOJI.map((emoji) => (
            <Pressable key={emoji} accessibilityRole="button" accessibilityLabel={emoji}
              onPress={() => choose({ kind: 'emoji', emoji })}
              style={({ pressed }) => [styles.cell, (pressed || dinner.emoji === emoji) && { backgroundColor: theme.backgroundSelected }]}>
              <Text allowFontScaling={false} style={styles.cellEmoji}>{emoji}</Text>
            </Pressable>
          ))}
        </View>
        <TextInput
          value={custom}
          onChangeText={setCustom}
          onSubmitEditing={submitCustom}
          placeholder={t('dinnerImage.customEmoji')}
          placeholderTextColor={theme.textSecondary}
          returnKeyType="done"
          autoCorrect={false}
          maxLength={16}
          style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement,
            borderColor: parseEmoji(custom) || !custom ? 'transparent' : theme.danger }]}
        />

        {hasPicture ? (
          <Pressable accessibilityRole="button" onPress={() => choose({ kind: 'none' })} style={styles.remove}>
            <ThemedText style={{ color: theme.danger }}>{t('dinnerImage.remove')}</ThemedText>
          </Pressable>
        ) : null}
      </ScrollView>
    </SheetScreen>
  );
}

function Action({ icon, label, disabled, onPress }: { icon: IconName; label: string; disabled?: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }}
      disabled={disabled} onPress={onPress}
      style={({ pressed }) => [styles.action, { backgroundColor: theme.backgroundElement },
        pressed && { backgroundColor: theme.backgroundSelected }, disabled && styles.disabled]}>
      <Icon name={icon} size={20} color={theme.tint} />
      <ThemedText type="small" style={styles.center} numberOfLines={2}>{label}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: Spacing.three,
    paddingBottom: Spacing.four,
  },
  previewWrap: {
    alignSelf: 'center',
  },
  previewBusy: {
    position: 'absolute',
    top: 0,
    left: 0,
    borderRadius: Math.round(PREVIEW * 0.24),
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    textAlign: 'center',
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  action: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    minHeight: 76,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.one,
    borderRadius: Spacing.three,
  },
  disabled: {
    opacity: 0.45,
  },
  previewActions: {
    gap: Spacing.two,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  cell: {
    width: `${100 / EMOJI_COLUMNS}%`,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Spacing.two,
  },
  cellEmoji: {
    fontSize: 28,
  },
  input: {
    minHeight: 44,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
    borderWidth: 1,
    fontSize: 17,
  },
  remove: {
    alignSelf: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
});
