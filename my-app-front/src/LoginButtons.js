import React from 'react';
import { BACKEND_BASE_URL } from './config';

const providers = [
  { id: 'google', label: '구글로 로그인' },
  { id: 'kakao', label: '카카오로 로그인' },
];

function buildOAuthUrl(provider) {
  return `${BACKEND_BASE_URL}/oauth2/authorization/${provider}`;
}

export default function LoginButtons() {
  const handleLogin = (provider) => {
    window.location.href = buildOAuthUrl(provider);
  };

  return (
    <div className="card">
      <h2>소셜 로그인</h2>
      <p className="card-description">
        버튼을 누르면 백엔드 OAuth2 인증 페이지로 이동합니다. 로그인 성공 시 <code>/cookie</code> 경로로 이동하여 토큰을 교환할 수 있습니다.
      </p>
      <div className="button-group">
        {providers.map((provider) => (
          <button key={provider.id} type="button" className="primary" onClick={() => handleLogin(provider.id)}>
            {provider.label}
          </button>
        ))}
      </div>
    </div>
  );
}
