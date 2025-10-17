import React, { useMemo, useState } from 'react';
import { requestFcmTestNotification, saveFcmToken } from './api';

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

  const isTokenFilled = useMemo(() => tokenInput.trim().length > 0, [tokenInput]);

  const handleSaveToken = async (event) => {
    event.preventDefault();
    setTestFeedback(INITIAL_FEEDBACK);

    if (!isTokenFilled) {
      setSaveFeedback({ status: 'error', message: '저장할 FCM 토큰을 입력해주세요.' });
      return;
    }

    setIsSaving(true);
    setSaveFeedback({ status: 'pending', message: 'FCM 토큰을 저장하는 중입니다…' });
    try {
      await saveFcmToken({ token: tokenInput.trim(), accessToken });
      setSaveFeedback({ status: 'success', message: 'FCM 토큰이 성공적으로 저장되었습니다.' });
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
        <label htmlFor="fcm-token-input" className="fcm-form__label">
          FCM 디바이스 토큰
        </label>
        <textarea
          id="fcm-token-input"
          className="fcm-form__textarea"
          placeholder="여기에 FCM 토큰을 입력하세요"
          value={tokenInput}
          onChange={(event) => setTokenInput(event.target.value)}
          rows={3}
          required
        />
        <div className="fcm-form__actions">
          <button type="submit" className="primary" disabled={isSaving}>
            {isSaving ? '저장 중…' : '토큰 저장하기'}
          </button>
        </div>
        <FeedbackMessage feedback={saveFeedback} />
      </form>

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
