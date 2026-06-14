import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import { fetchCaptchaImage } from '../railClient';

export default function useCaptchaFlow({
  refresh,
  clearAutoCaptchaCooldown,
  startAutoCaptchaCooldown
}) {
  const [captchaVisible, setCaptchaVisible] = useState(false);
  const [captchaImage, setCaptchaImage] = useState('');
  const [captchaValue, setCaptchaValue] = useState('');
  const [captchaLoading, setCaptchaLoading] = useState(false);
  const [pendingCheck, setPendingCheck] = useState(null);

  const reloadCaptcha = useCallback(async () => {
    try {
      setCaptchaLoading(true);
      setCaptchaImage(await fetchCaptchaImage());
      await refresh();
    } catch (err) {
      Alert.alert('Unable to load captcha', err.message);
    } finally {
      setCaptchaLoading(false);
    }
  }, [refresh]);

  const openCaptcha = useCallback(async (check) => {
    if (!check?.automated && check?.eventId) {
      await clearAutoCaptchaCooldown(check.eventId);
    }
    setPendingCheck(check);
    setCaptchaVisible(true);
    setCaptchaValue('');
    await reloadCaptcha();
  }, [clearAutoCaptchaCooldown, reloadCaptcha]);

  const resetCaptcha = useCallback(() => {
    setCaptchaVisible(false);
    setPendingCheck(null);
    setCaptchaValue('');
  }, []);

  const hideCaptcha = useCallback(() => {
    setCaptchaVisible(false);
  }, []);

  const reopenCaptcha = useCallback(async () => {
    setCaptchaVisible(true);
    setCaptchaValue('');
    await reloadCaptcha();
  }, [reloadCaptcha]);

  const cancelCaptcha = useCallback(async () => {
    if (pendingCheck?.automated && pendingCheck.eventId) {
      await startAutoCaptchaCooldown(pendingCheck.eventId);
    }
    resetCaptcha();
  }, [pendingCheck, resetCaptcha, startAutoCaptchaCooldown]);

  return {
    captchaVisible,
    captchaImage,
    captchaValue,
    captchaLoading,
    pendingCheck,
    setCaptchaValue,
    openCaptcha,
    reloadCaptcha,
    hideCaptcha,
    reopenCaptcha,
    resetCaptcha,
    cancelCaptcha
  };
}
