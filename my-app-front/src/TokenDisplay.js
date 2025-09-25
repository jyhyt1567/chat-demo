import React, { useEffect, useState } from 'react';
import { useAuth } from './context';

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
  const { setAccessToken } = useAuth();
  const [isEditing, setIsEditing] = useState(false);
  const [draftToken, setDraftToken] = useState(accessToken ?? '');

  useEffect(() => {
    if (!isEditing) {
      setDraftToken(accessToken ?? '');
    }
  }, [accessToken, isEditing]);

  const beginEdit = () => {
    setDraftToken(accessToken ?? '');
    setIsEditing(true);
  };

  const cancelEdit = () => {
    setDraftToken(accessToken ?? '');
    setIsEditing(false);
  };

  const clearToken = () => {
    setAccessToken(null);
    setDraftToken('');
    setIsEditing(false);
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    const nextToken = draftToken?.trim() ? draftToken : null;
    setAccessToken(nextToken);
    setIsEditing(false);
  };

  return (
    <div className="card">
      <h2>액세스 토큰 상태</h2>
      {!isEditing ? (
        <>
          <p className="token-preview">{formatTokenPreview(accessToken)}</p>
          <div className="token-actions">
            <button type="button" className="secondary" onClick={beginEdit}>
              토큰 직접 입력하기
            </button>
            {accessToken && (
              <button type="button" className="destructive" onClick={clearToken}>
                저장된 토큰 삭제
              </button>
            )}
          </div>
        </>
      ) : (
        <form className="form token-editor" onSubmit={handleSubmit}>
          <label htmlFor="token-editor">새 액세스 토큰</label>
          <textarea
            id="token-editor"
            rows={4}
            value={draftToken}
            onChange={(event) => setDraftToken(event.target.value)}
            placeholder="백엔드에서 발급받은 액세스 토큰을 붙여넣으세요."
          />
          <div className="token-editor__actions">
            <button type="button" className="secondary" onClick={cancelEdit}>
              취소
            </button>
            <button type="submit" className="primary">
              저장
            </button>
          </div>
        </form>
      )}
      <p className="card-description">
        액세스 토큰은 브라우저의 <code>sessionStorage</code>에만 저장되며, 로그아웃 시 제거됩니다. API 호출 시 <code>Authorization</code> 헤더에 자동으로 추가되지 않으므로, 아래 도구를 통해 필요한 요청을 수행하세요.
      </p>
    </div>
  );
}
