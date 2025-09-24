import React from 'react';

function formatTokenPreview(token) {
  if (!token) {
    return '저장된 액세스 토큰이 없습니다.';
  }
  if (token.length <= 20) {
    return token;
  }
  return `${token.slice(0, 20)}...${token.slice(-10)}`;
}

export default function TokenDisplay({ accessToken }) {
  return (
    <div className="card">
      <h2>액세스 토큰 상태</h2>
      <p className="token-preview">{formatTokenPreview(accessToken)}</p>
      <p className="card-description">
        액세스 토큰은 브라우저의 <code>sessionStorage</code>에만 저장되며, 로그아웃 시 제거됩니다. API 호출 시 <code>Authorization</code> 헤더에 자동으로 추가되지 않으므로, 아래 도구를 통해 필요한 요청을 수행하세요.
      </p>
    </div>
  );
}
