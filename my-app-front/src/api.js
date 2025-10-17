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

export async function saveFcmToken({ token, accessToken }) {
  const response = await fetch(`${BACKEND_BASE_URL}/api/fcm`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fcmToken: token }),
  });

  if (!response.ok) {
    const errorBody = await handleJsonResponse(response);
    throw new Error(errorBody?.message || 'FCM 토큰 저장에 실패했습니다.');
  }
}

export async function requestFcmTestNotification({ accessToken }) {
  const response = await fetch(`${BACKEND_BASE_URL}/api/fcm`, {
    method: 'GET',
    credentials: 'include',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const errorBody = await handleJsonResponse(response);
    throw new Error(errorBody?.message || '테스트 알림 전송에 실패했습니다.');
  }
}

export async function getOrCreateChatRoom({ festivalId, accessToken }) {
  const response = await fetch(`${BACKEND_BASE_URL}/api/festivals/${festivalId}/chatRooms`, {
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
  if (
    !data ||
    typeof data !== 'object' ||
    data === null ||
    !Object.prototype.hasOwnProperty.call(data, 'content') ||
    !data.content ||
    typeof data.content !== 'object'
  ) {
    throw new Error('예상치 못한 채팅방 응답 형식입니다.');
  }

  return data.content;
}

export async function fetchMessages({ chatRoomId, page = 0, size = 30, accessToken }) {
  const params = new URLSearchParams({ page: String(page), size: String(size) });
  const response = await fetch(`${BACKEND_BASE_URL}/api/chatRooms/${chatRoomId}/messages?${params.toString()}`, {
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
  return data.content;
}

export async function fetchChatRooms({ page = 0, size = 15, accessToken }) {
  const params = new URLSearchParams({ page: String(page), size: String(size) });
  const response = await fetch(`${BACKEND_BASE_URL}/api/chatRooms?${params.toString()}`, {
    method: 'GET',
    credentials: 'include',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const errorBody = await handleJsonResponse(response);
    throw new Error(errorBody?.message || '채팅방 목록 조회에 실패했습니다.');
  }

  const data = await handleJsonResponse(response);
  return data;
}

export async function requestImageUploadSlot({ accessToken } = {}) {
  const response = await fetch(`${BACKEND_BASE_URL}/api/presigned-url`, {
    method: 'GET',
    credentials: 'include',
    headers: {
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
  });

  if (!response.ok) {
    const errorBody = await handleJsonResponse(response);
    throw new Error(errorBody?.message || '이미지 업로드 URL 발급에 실패했습니다.');
  }

  const data = await handleJsonResponse(response);
  if (data && typeof data === 'object' && data !== null) {
    if (Object.prototype.hasOwnProperty.call(data, 'content') && data.content) {
      return data.content;
    }
    return data;
  }

  throw new Error('예상치 못한 Presigned URL 응답 형식입니다.');
}
