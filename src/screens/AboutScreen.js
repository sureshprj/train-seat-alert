import React from 'react';
import { Alert, Linking, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const PRIVACY_POLICY_URL = 'https://sureshprj.github.io/train-seat-alert/privacy-policy.html';
const SUPPORT_EMAIL = 'sureshkumarkgm@gmail.com';

function openUrl(url) {
  Linking.openURL(url).catch(() => {
    Alert.alert('Unable to open link', url);
  });
}

function openEmail() {
  const subject = encodeURIComponent('Train Seat Alert support');
  Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${subject}`).catch(() => {
    Alert.alert('Unable to open email', SUPPORT_EMAIL);
  });
}

export { PRIVACY_POLICY_URL, SUPPORT_EMAIL };

export default function AboutScreen({ styles, Screen }) {
  return (
    <Screen>
      <View style={styles.topBar}>
        <View style={styles.flexOne}>
          <Text style={styles.screenTitle}>About</Text>
          <Text style={styles.subtle}>Release and privacy details</Text>
        </View>
      </View>

      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.flexOne}>
            <Text style={styles.cardTitle}>Train Seat Alert</Text>
            <Text style={styles.metaLine}>Independent train availability helper</Text>
          </View>
          <Ionicons name="shield-checkmark-outline" size={22} color="#1d3557" />
        </View>
        <Text style={styles.infoText}>
          This app is not affiliated with, endorsed by, or operated by Indian Railways, IRCTC, or CRIS.
        </Text>
        <Text style={styles.infoText}>
          Availability is requested from Indian Rail public web endpoints and may be delayed, unavailable, or different from final booking status.
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Data and ads</Text>
        <Text style={styles.infoText}>
          Trip details, alert settings, notification history, and rail session cookies are stored locally on this device.
        </Text>
        <Text style={styles.infoText}>
          Train searches, station searches, CAPTCHA requests, and seat availability checks are sent to Indian Rail services when you use those actions.
        </Text>
        <Text style={styles.infoText}>
          The Android app shows Google AdMob banner ads. Google and its partners may process device, app, and advertising data according to their policies and your device settings.
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Support</Text>
        <TouchableOpacity style={styles.linkRow} onPress={() => openUrl(PRIVACY_POLICY_URL)}>
          <Ionicons name="document-text-outline" size={18} color="#1d3557" />
          <Text style={styles.linkRowText}>Privacy policy</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.linkRow} onPress={openEmail}>
          <Ionicons name="mail-outline" size={18} color="#1d3557" />
          <Text style={styles.linkRowText}>{SUPPORT_EMAIL}</Text>
        </TouchableOpacity>
      </View>
    </Screen>
  );
}
