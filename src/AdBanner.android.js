import React, { useEffect } from 'react';
import { View } from 'react-native';
import mobileAds, {
  BannerAd,
  BannerAdSize,
  TestIds
} from 'react-native-google-mobile-ads';

const ANDROID_HOME_BOTTOM_BANNER_ID = 'ca-app-pub-3678713750890640/8456510445';

export default function AdBanner({ placement = 'default' }) {
  const useTestAds = __DEV__ || process.env.EXPO_PUBLIC_USE_ADMOB_TEST_ADS === 'true';

  useEffect(() => {
    mobileAds().initialize().catch((error) => {
      console.warn('AdMob initialization failed:', error.message);
    });
  }, []);

  const unitId = useTestAds ? TestIds.ADAPTIVE_BANNER : ANDROID_HOME_BOTTOM_BANNER_ID;
  const containerStyle = {
    alignItems: 'center',
    marginTop: placement === 'default' ? 8 : 0,
    marginBottom: placement === 'list' ? 12 : 0
  };

  return (
    <View style={containerStyle}>
      <BannerAd
        unitId={unitId}
        size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
        onAdFailedToLoad={(error) => {
          console.warn('AdMob banner failed to load:', error);
        }}
      />
    </View>
  );
}
