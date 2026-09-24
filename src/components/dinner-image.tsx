import { useValue } from '@legendapp/state/react';
import { Image } from 'expo-image';
import { PixelRatio, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import { dinnerImageUrl, imageVariant } from '@/lib/dinner-images';
import { pendingImageFile } from '@/lib/dinner-image-upload';
import { store$ } from '@/lib/store/collections';

export type DinnerPictureFields = { emoji: string | null; image_path: string | null; image_thumbhash: string | null };

type Props = {
  /** Reads the dinner's picture (and any photo still uploading) from the store. */
  dinnerId?: string;
  /** Shown instead of the stored picture, e.g. an AI preview. */
  picture?: DinnerPictureFields;
  /** For the letter shown when there is no picture. */
  name?: string | null;
  size: number;
  style?: StyleProp<ViewStyle>;
};

/**
 * A dinner's picture in a rounded square: a photo, an emoji drawn at the same
 * size, or the name's first letter. Every list and card uses this, so the
 * three kinds line up identically everywhere.
 */
export function DinnerImage({ dinnerId, picture, name, size, style }: Props) {
  const theme = useTheme();
  // Primitive snapshots keep re-renders to real picture changes.
  const stored = useValue(() => {
    if (picture || !dinnerId) return '';
    const dinner = store$.dinners[dinnerId].get();
    return JSON.stringify([dinner?.emoji ?? null, dinner?.image_path ?? null, dinner?.image_thumbhash ?? null]);
  });
  const pendingFile = useValue(() => (picture || !dinnerId ? null : store$.meta.pendingImages[dinnerId].file.get() ?? null));
  const [emoji, path, thumbhash] = picture
    ? [picture.emoji, picture.image_path, picture.image_thumbhash]
    : stored ? (JSON.parse(stored) as [string | null, string | null, string | null]) : [null, null, null];

  const tile = [styles.tile, { width: size, height: size, borderRadius: Math.round(size * 0.24), backgroundColor: theme.backgroundSelected }, style];
  const uri = pendingFile ? pendingImageFile(pendingFile).uri
    : path ? dinnerImageUrl(path, imageVariant(size, PixelRatio.get())) : null;

  if (uri) {
    return (
      <View style={tile} accessible={false}>
        <Image
          source={{ uri }}
          placeholder={thumbhash && !pendingFile ? { thumbhash } : undefined}
          placeholderContentFit="cover"
          contentFit="cover"
          transition={120}
          recyclingKey={uri}
          cachePolicy="memory-disk"
          style={StyleSheet.absoluteFill}
        />
      </View>
    );
  }
  if (emoji) {
    return (
      <View style={tile} accessible={false}>
        <Text allowFontScaling={false} style={{ fontSize: Math.round(size * 0.58), lineHeight: Math.round(size * 0.74) }}>
          {emoji}
        </Text>
      </View>
    );
  }
  const letter = name ? Array.from(name.trim())[0]?.toLocaleUpperCase() : undefined;
  return (
    <View style={tile} accessible={false}>
      {letter ? (
        <Text allowFontScaling={false}
          style={[styles.letter, { color: theme.textSecondary, fontSize: Math.round(size * 0.42), lineHeight: Math.round(size * 0.52) }]}>
          {letter}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  letter: {
    fontWeight: '600',
  },
});
