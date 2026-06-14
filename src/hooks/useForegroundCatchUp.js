import { useCallback, useRef, useState } from 'react';
import { runDueScheduledChecksWithOptions } from '../planner';

export default function useForegroundCatchUp({
  ready,
  captchaVisible,
  pendingCheck,
  refresh,
  openCaptcha,
  isAutoCaptchaCoolingDown,
  isAutoCheckPaused
}) {
  const [autoChecking, setAutoChecking] = useState(false);
  const foregroundCheckInFlightRef = useRef(false);

  const runForegroundCatchUp = useCallback(async () => {
    if (!ready) return;
    if (captchaVisible || pendingCheck) return;
    if (isAutoCheckPaused?.()) return;
    if (foregroundCheckInFlightRef.current) return;
    foregroundCheckInFlightRef.current = true;
    setAutoChecking(true);
    try {
      const result = await runDueScheduledChecksWithOptions({ suppressCaptchaNotifications: true });
      if (result.captchaRequired && result.captchaEventId) {
        const captchaEventId = Number(result.captchaEventId);
        if (await isAutoCaptchaCoolingDown(captchaEventId)) return;
        await refresh({ showLoading: true });
        await openCaptcha({
          type: 'event',
          eventId: captchaEventId,
          suppressNotifications: false,
          automated: true,
          runDate: result.captchaRunDate,
          scheduledTimes: result.captchaScheduledTimes || []
        });
        return;
      }
      if (result.checked > 0 || result.reminded > 0) await refresh({ showLoading: true });
    } catch (err) {
      console.warn('Foreground catch-up failed:', err.message);
    } finally {
      setAutoChecking(false);
      foregroundCheckInFlightRef.current = false;
    }
  }, [ready, refresh, captchaVisible, pendingCheck, openCaptcha, isAutoCaptchaCoolingDown, isAutoCheckPaused]);

  return {
    autoChecking,
    runForegroundCatchUp
  };
}
