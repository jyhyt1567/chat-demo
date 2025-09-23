import { BACKEND_BASE_URL } from './config';

async function handleJsonResponse(response) {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    console.warn('Failed to parse JSON response', error);
    return null;
  }
}

export async function exchangeToken() {
  const response = await fetch(`${BACKEND_BASE_URL}/api/jwt/exchange`, {
    method: 'POST',
    credentials: 'include',
  });

  if (!response.ok) {
    const errorBody = await handleJsonResponse(response);
    throw new Error(errorBody?.message || '액세스 토큰 교환에 실패했습니다.');
  }

  const authorizationHeader = response.headers.get('Authorization');
  if (!authorizationHeader) {
    throw new Error('Authorization 헤더가 응답에 포함되지 않았습니다.');
  }

  const token = authorizationHeader.replace('Bearer', '').trim();
  return token;
}

export async function logout(accessToken) {
  const response = await fetch(`${BACKEND_BASE_URL}/api/users/logout`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const errorBody = await handleJsonResponse(response);
    throw new Error(errorBody?.message || '로그아웃에 실패했습니다.');
  }
}

export async function getOrCreateChatRoom({ festivalId, accessToken }) {
  const response = await fetch(`${BACKEND_BASE_URL}/api/festivals/${festivalId}/messages`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const errorBody = await handleJsonResponse(response);
    throw new Error(errorBody?.message || '채팅방 생성에 실패했습니다.');
  }

  const data = await handleJsonResponse(response);
  if (data?.data !== undefined) {
    return data.data;
  }
  if (data?.result !== undefined) {
    return data.result;
  }
  return data;
}

export async function fetchMessages({ chatRoomId, page = 0, size = 30, accessToken }) {
  const params = new URLSearchParams({ page: String(page), size: String(size) });
  const response = await fetch(`${BACKEND_BASE_URL}/api/messages/${chatRoomId}?${params.toString()}`, {
    method: 'GET',
    credentials: 'include',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const errorBody = await handleJsonResponse(response);
    throw new Error(errorBody?.message || '이전 메시지 조회에 실패했습니다.');
  }

  const data = await handleJsonResponse(response);
  if (Array.isArray(data)) {
    return data;
  }
  if (data?.data) {
    return data.data;
  }
  return [];
}
