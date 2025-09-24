import React, { useEffect, useState } from 'react';
import { exchangeToken } from './api';
import { useAuth } from './context';

export default function TokenExchangePage({ navigate }) {
  const { setAccessToken } = useAuth();
  const [status, setStatus] = useState('processing');
  const [message, setMessage] = useState('리프래시 토큰을 사용해 액세스 토큰을 발급받는 중입니다.');

  useEffect(() => {
    let timeoutId;

    async function run() {
      try {
        const token = await exchangeToken();
        setAccessToken(token);
        setStatus('success');
        setMessage('액세스 토큰 발급이 완료되었습니다. 잠시 후 홈으로 이동합니다.');
        timeoutId = setTimeout(() => navigate('/'), 1500);
      } catch (error) {
        console.error(error);
        setStatus('error');
        setMessage(error.message || '토큰 교환에 실패했습니다. 다시 시도해주세요.');
      }
    }

    run();

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [navigate, setAccessToken]);

  return (
    <div className="container">
      <header className="page-header">
        <h1>토큰 교환</h1>
        <p className="subtitle">백엔드에서 전달된 리프래시 토큰을 사용하여 새로운 액세스 토큰을 발급받습니다.</p>
      </header>
      <div className={`card status-${status}`}>
        <p>{message}</p>
        {status === 'error' && (
          <button type="button" onClick={() => navigate('/')}>홈으로 돌아가기</button>
        )}
      </div>
    </div>
  );
}
