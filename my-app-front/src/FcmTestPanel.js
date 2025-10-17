import React, { useEffect, useMemo, useState } from 'react';
import { requestFcmTestNotification, saveFcmToken } from './api';
import { isFirebaseMessagingReady, requestFcmDeviceToken } from './firebaseMessaging';
import { isFirebaseConfigured } from './config';

const INITIAL_FEEDBACK = { status: 'idle', message: '' };

function FeedbackMessage({ feedback }) {
  if (!feedback.message) {
    return null;
  }

  const className = `fcm-feedback fcm-feedback--${feedback.status}`;
  return (
    <p className={className} role="status">
      {feedback.message}
    </p>
  );
}

export default function FcmTestPanel({ accessToken }) {
  const [tokenInput, setTokenInput] = useState('');
  const [saveFeedback, setSaveFeedback] = useState(INITIAL_FEEDBACK);
  const [testFeedback, setTestFeedback] = useState(INITIAL_FEEDBACK);
  const [isSaving, setIsSaving] = useState(false);
  const [isRequestingTest, setIsRequestingTest] = useState(false);
  const [isLoadingSupportState, setIsLoadingSupportState] = useState(true);
  const [isSupported, setIsSupported] = useState(false);

  const isTokenFilled = useMemo(() => tokenInput.trim().length > 0, [tokenInput]);
  const isConfigured = isFirebaseConfigured();

  useEffect(() => {
    let isActive = true;

    (async () => {
      try {
        const ready = typeof window !== 'undefined' && isFirebaseMessagingReady();
        if (isActive) {
          setIsSupported(ready);
        }
      } catch (error) {
        console.error('Failed to detect Firebase support', error);
        if (isActive) {
          setIsSupported(false);
        }
      } finally {
        if (isActive) {
          setIsLoadingSupportState(false);
        }
      }
    })();

    return () => {
      isActive = false;
    };
  }, []);

  const handleSaveToken = async (event) => {
    event.preventDefault();
    setTestFeedback(INITIAL_FEEDBACK);

    if (!isConfigured) {
      setSaveFeedback({ status: 'error', message: 'Firebase 환경 변수가 설정되어 있지 않습니다.' });
      return;
    }

    if (!isSupported) {
      setSaveFeedback({ status: 'error', message: '이 브라우저에서는 FCM 알림을 사용할 수 없습니다.' });
      return;
    }

    setIsSaving(true);
    setSaveFeedback({ status: 'pending', message: '알림 권한과 FCM 토큰을 요청하는 중입니다…' });
    try {
      const token = await requestFcmDeviceToken();
      setTokenInput(token.trim());
      setSaveFeedback({ status: 'pending', message: '발급받은 토큰을 백엔드에 저장하는 중입니다…' });
      await saveFcmToken({ token, accessToken });
      setSaveFeedback({ status: 'success', message: 'FCM 토큰이 저장되었습니다.' });
    } catch (error) {
      setSaveFeedback({
        status: 'error',
        message: error?.message || 'FCM 토큰 저장 중 오류가 발생했습니다.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSendTest = async () => {
    setTestFeedback(INITIAL_FEEDBACK);

    setIsRequestingTest(true);
    setTestFeedback({ status: 'pending', message: '테스트 알림을 요청 중입니다…' });
    try {
      await requestFcmTestNotification({ accessToken });
      setTestFeedback({ status: 'success', message: '테스트 알림이 요청되었습니다. 기기에서 알림을 확인해주세요.' });
    } catch (error) {
      setTestFeedback({
        status: 'error',
        message: error?.message || '테스트 알림 요청 중 오류가 발생했습니다.',
      });
    } finally {
      setIsRequestingTest(false);
    }
  };

  return (
    <div className="card">
      <h2>FCM 푸시 알림 테스트</h2>
      <p className="card-description">
        브라우저 또는 디바이스에서 발급받은 FCM 토큰을 백엔드에 저장하고, 테스트 알림을 전송해 정상 동작 여부를 확인할 수 있습니다.
      </p>

      <form className="fcm-form" onSubmit={handleSaveToken}>
        <p className="fcm-form__description">
          브라우저에서 Firebase Cloud Messaging 토큰을 발급받아 백엔드에 저장합니다. 최초 실행 시 알림 권한을 요청합니다.
        </p>

        <div className="fcm-form__actions">
          <button type="submit" className="primary" disabled={isSaving || isLoadingSupportState}>
            {isSaving ? '토큰 발급 및 저장 중…' : 'FCM 토큰 발급 후 저장하기'}
          </button>
        </div>
        {!isConfigured && !isLoadingSupportState && (
          <p className="fcm-form__hint" role="alert">
            Firebase 환경 변수가 누락되어 FCM 토큰을 발급할 수 없습니다. <code>.env</code> 파일을 확인해주세요.
          </p>
        )}
        {isConfigured && !isSupported && !isLoadingSupportState && (
          <p className="fcm-form__hint" role="alert">
            현재 브라우저에서는 FCM 기능을 지원하지 않습니다. 다른 브라우저를 사용하거나 HTTPS 환경을 확인해주세요.
          </p>
        )}
        <FeedbackMessage feedback={saveFeedback} />
      </form>

      <div className="fcm-token-display">
        <label htmlFor="fcm-token-output" className="fcm-form__label">
          발급된 FCM 토큰
        </label>
        <textarea
          id="fcm-token-output"
          className="fcm-form__textarea"
          placeholder="FCM 토큰이 발급되면 여기에 표시됩니다."
          value={tokenInput}
          readOnly
          rows={3}
        />
      </div>

      <div className="fcm-test">
        <p className="fcm-test__description">
          토큰 저장 후 아래 버튼을 눌러 테스트 알림을 요청할 수 있습니다.
        </p>
        <button
          type="button"
          className="secondary"
          onClick={handleSendTest}
          disabled={!isTokenFilled || isRequestingTest}
        >
          {isRequestingTest ? '요청 중…' : '테스트 알림 보내기'}
        </button>
        <FeedbackMessage feedback={testFeedback} />
      </div>
    </div>
  );
}
