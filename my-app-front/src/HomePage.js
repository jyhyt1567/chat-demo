import React from 'react';
import ChatRoomPanel from './ChatRoomPanel';
import LoginButtons from './LoginButtons';
import TokenDisplay from './TokenDisplay';
import { logout } from './api';
import { useAuth } from './context';
import FcmTestPanel from './FcmTestPanel';

export default function HomePage({ navigate }) {
  const { accessToken, clearAccessToken } = useAuth();

  const handleLogout = async () => {
    if (!accessToken) {
      return;
    }
    try {
      await logout(accessToken);
    } catch (error) {
      console.error(error);
    } finally {
      clearAccessToken();
    }
  };

  return (
    <div className="container">
      <header className="page-header">
        <h1>FestaPick 연동 데모</h1>
        <p className="subtitle">OAuth2 로그인과 실시간 채팅 기능을 검증할 수 있는 프런트엔드 도구입니다.</p>
      </header>

      {!accessToken && (
        <>
          <LoginButtons />
          <div className="card">
            <h2>토큰 교환 절차</h2>
            <ol className="guide-list">
              <li>소셜 로그인 버튼을 눌러 백엔드 인증 페이지에서 로그인합니다.</li>
              <li>로그인이 성공하면 브라우저가 자동으로 <code>/cookie</code> 경로로 이동합니다.</li>
              <li><code>/cookie</code> 페이지에서 리프래시 토큰을 이용해 액세스 토큰을 교환합니다.</li>
              <li>교환이 완료되면 홈으로 돌아와 채팅 도구를 사용할 수 있습니다.</li>
            </ol>
          </div>
        </>
      )}

      <TokenDisplay accessToken={accessToken} />

      {accessToken && (
        <div className="card">
          <h2>토큰 재발급</h2>
          <p className="card-description">
            액세스 토큰의 유효 기간이 만료되기 전에 새 토큰이 필요하다면 아래 버튼을 눌러 토큰 교환 페이지로 이동할 수 있습니다.
          </p>
          <button type="button" className="secondary" onClick={() => navigate('/cookie')}>
            토큰 다시 발급받기
          </button>
        </div>
      )}

      {accessToken && <FcmTestPanel accessToken={accessToken} />}

      {accessToken ? (
        <ChatRoomPanel accessToken={accessToken} onLogout={handleLogout} />
      ) : (
        <div className="card info-card">
          <h2>로그인이 필요합니다</h2>
          <p className="card-description">
            채팅방을 열거나 메시지를 불러오려면 먼저 액세스 토큰을 발급받아야 합니다. 위 안내에 따라 로그인 과정을 진행해주세요.
          </p>
        </div>
      )}
    </div>
  );
}
