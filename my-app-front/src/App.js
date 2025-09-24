import { useCallback, useMemo, useState } from 'react';
import './App.css';

const DEFAULT_CHAT_ROOM_PAGE_SIZE = 15;
const DEFAULT_MESSAGE_PAGE_SIZE = 30;

function App() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [tokenInput, setTokenInput] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [loginError, setLoginError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [chatRooms, setChatRooms] = useState([]);
  const [chatRoomsPage, setChatRoomsPage] = useState(0);
  const [chatRoomsTotalPages, setChatRoomsTotalPages] = useState(0);
  const [chatRoomsError, setChatRoomsError] = useState('');
  const [isLoadingRooms, setIsLoadingRooms] = useState(false);

  const [selectedRoom, setSelectedRoom] = useState(null);
  const [messages, setMessages] = useState([]);
  const [messagesError, setMessagesError] = useState('');
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);

  const isAuthenticated = useMemo(() => Boolean(accessToken), [accessToken]);

  const authHeaders = useMemo(() => {
    if (!accessToken) {
      return {};
    }

    return {
      Authorization: `Bearer ${accessToken}`,
    };
  }, [accessToken]);

  const safeExtract = useCallback((responseBody) => {
    if (!responseBody) {
      return [];
    }

    if (Array.isArray(responseBody)) {
      return responseBody;
    }

    if (Array.isArray(responseBody.data)) {
      return responseBody.data;
    }

    if (Array.isArray(responseBody.content)) {
      return responseBody.content;
    }

    return [];
  }, []);

  const toSortableId = useCallback((message) => {
    if (!message) {
      return Number.MAX_SAFE_INTEGER;
    }

    const { id } = message;

    if (typeof id === 'number' && Number.isFinite(id)) {
      return id;
    }

    const parsed = Number(id);

    if (Number.isFinite(parsed)) {
      return parsed;
    }

    return Number.MAX_SAFE_INTEGER;
  }, []);

  const fetchChatRooms = useCallback(
    async (page = 0) => {
      if (!isAuthenticated) {
        return;
      }

      setIsLoadingRooms(true);
      setChatRoomsError('');

      try {
        const response = await fetch(
          `/api/chatRooms?page=${page}&size=${DEFAULT_CHAT_ROOM_PAGE_SIZE}`,
          {
            headers: {
              'Content-Type': 'application/json',
              ...authHeaders,
            },
          }
        );

        if (!response.ok) {
          throw new Error('채팅방 목록을 불러오지 못했습니다.');
        }

        const responseBody = await response.json();
        const rooms = safeExtract(responseBody);

        setChatRooms(Array.isArray(rooms) ? rooms : []);
        setChatRoomsPage(responseBody.number ?? page ?? 0);
        setChatRoomsTotalPages(responseBody.totalPages ?? 0);
      } catch (error) {
        setChatRooms([]);
        setChatRoomsError(error.message ?? '채팅방 목록을 불러오지 못했습니다.');
      } finally {
        setIsLoadingRooms(false);
      }
    },
    [authHeaders, isAuthenticated, safeExtract]
  );

  const fetchMessages = useCallback(
    async (roomId, page = 0) => {
      if (!isAuthenticated || !roomId) {
        return;
      }

      setIsLoadingMessages(true);
      setMessagesError('');

      try {
        const response = await fetch(
          `/api/chatRooms/${roomId}/messages?page=${page}&size=${DEFAULT_MESSAGE_PAGE_SIZE}`,
          {
            headers: {
              'Content-Type': 'application/json',
              ...authHeaders,
            },
          }
        );

        if (!response.ok) {
          throw new Error('채팅 메시지를 불러오지 못했습니다.');
        }

        const responseBody = await response.json();
        const payloads = safeExtract(responseBody);

        const sortedMessages = Array.isArray(payloads)
          ? [...payloads].sort((a, b) => toSortableId(a) - toSortableId(b))
          : [];

        setMessages(sortedMessages);
      } catch (error) {
        setMessages([]);
        setMessagesError(error.message ?? '채팅 메시지를 불러오지 못했습니다.');
      } finally {
        setIsLoadingMessages(false);
      }
    },
    [authHeaders, isAuthenticated, safeExtract, toSortableId]
  );

  const handleLogin = useCallback(
    async (event) => {
      event.preventDefault();

      if (!username || !password) {
        setLoginError('아이디와 비밀번호를 모두 입력해주세요.');
        return;
      }

      setIsLoggingIn(true);
      setLoginError('');

      try {
        const response = await fetch('/api/auth/login', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ username, password }),
        });

        if (!response.ok) {
          throw new Error('로그인에 실패했습니다.');
        }

        const data = await response.json();
        const nextToken = data?.accessToken ?? data?.token ?? data?.Authorization ?? '';

        if (!nextToken) {
          throw new Error('응답에서 토큰을 찾을 수 없습니다.');
        }

        setAccessToken(nextToken);
        setTokenInput(nextToken);
        await fetchChatRooms(0);
      } catch (error) {
        setAccessToken('');
        setLoginError(error.message ?? '로그인에 실패했습니다.');
      } finally {
        setIsLoggingIn(false);
      }
    },
    [fetchChatRooms, password, username]
  );

  const handleApplyToken = useCallback(() => {
    if (!tokenInput) {
      setAccessToken('');
      setChatRooms([]);
      setSelectedRoom(null);
      return;
    }

    setAccessToken(tokenInput);
    fetchChatRooms(0);
  }, [fetchChatRooms, tokenInput]);

  const handleLogout = useCallback(() => {
    setAccessToken('');
    setTokenInput('');
    setUsername('');
    setPassword('');
    setChatRooms([]);
    setSelectedRoom(null);
    setMessages([]);
  }, []);

  const handleSelectRoom = useCallback(
    (room) => {
      setSelectedRoom(room);
      if (room?.roomId) {
        fetchMessages(room.roomId, 0);
      }
    },
    [fetchMessages]
  );

  return (
    <div className="app">
      <header className="app-header">
        <h1>Festival Chat</h1>
        {isAuthenticated && (
          <button type="button" className="secondary-button" onClick={handleLogout}>
            로그아웃
          </button>
        )}
      </header>

      <main className="app-content">
        {!isAuthenticated && (
          <section className="login-section">
            <form className="card" onSubmit={handleLogin}>
              <h2>로그인</h2>
              <label className="input-group">
                <span>아이디</span>
                <input
                  type="text"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="아이디를 입력하세요"
                />
              </label>
              <label className="input-group">
                <span>비밀번호</span>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="비밀번호를 입력하세요"
                />
              </label>
              {loginError && <p className="error-text">{loginError}</p>}
              <button type="submit" className="primary-button" disabled={isLoggingIn}>
                {isLoggingIn ? '로그인 중...' : '로그인'}
              </button>
            </form>

            <div className="card token-card">
              <h2>토큰 직접 입력</h2>
              <p className="helper-text">이미 발급받은 토큰이 있다면 아래에 붙여넣어 주세요.</p>
              <input
                type="text"
                value={tokenInput}
                onChange={(event) => setTokenInput(event.target.value)}
                placeholder="예: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
              />
              <button type="button" className="secondary-button" onClick={handleApplyToken}>
                토큰 적용
              </button>
            </div>
          </section>
        )}

        {isAuthenticated && (
          <section className="chat-section">
            <div className="chat-sidebar">
              <div className="chat-sidebar-header">
                <h2>채팅방</h2>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => fetchChatRooms(chatRoomsPage)}
                  disabled={isLoadingRooms}
                >
                  {isLoadingRooms ? '불러오는 중...' : '새로고침'}
                </button>
              </div>

              {chatRoomsError && <p className="error-text">{chatRoomsError}</p>}

              <ul className="chat-room-list">
                {chatRooms.length === 0 && !isLoadingRooms && (
                  <li className="empty-state">열려 있는 채팅방이 없습니다.</li>
                )}
                {chatRooms.map((room) => (
                  <li key={room.roomId ?? room.id}>
                    <button
                      type="button"
                      className={
                        selectedRoom?.roomId === (room.roomId ?? room.id)
                          ? 'chat-room-button active'
                          : 'chat-room-button'
                      }
                      onClick={() => handleSelectRoom(room)}
                    >
                      <span className="room-name">{room.roomName ?? '이름 없는 채팅방'}</span>
                      <span className="room-meta">
                        #{room.roomId ?? room.id}
                        {room.festivalId ? ` · Festival ${room.festivalId}` : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>

              {chatRoomsTotalPages > 1 && (
                <div className="pagination">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      const previousPage = Math.max(chatRoomsPage - 1, 0);
                      fetchChatRooms(previousPage);
                    }}
                    disabled={isLoadingRooms || chatRoomsPage <= 0}
                  >
                    이전
                  </button>
                  <span>
                    {chatRoomsPage + 1} / {chatRoomsTotalPages}
                  </span>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      const nextPage = Math.min(chatRoomsPage + 1, chatRoomsTotalPages - 1);
                      fetchChatRooms(nextPage);
                    }}
                    disabled={
                      isLoadingRooms || chatRoomsPage >= chatRoomsTotalPages - 1 || chatRoomsTotalPages === 0
                    }
                  >
                    다음
                  </button>
                </div>
              )}
            </div>

            <div className="chat-main">
              {selectedRoom ? (
                <>
                  <div className="chat-main-header">
                    <div>
                      <h2>{selectedRoom.roomName ?? '선택된 채팅방'}</h2>
                      <p className="helper-text">채팅은 메시지 ID 기준으로 오름차순 정렬됩니다.</p>
                    </div>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => fetchMessages(selectedRoom.roomId ?? selectedRoom.id, 0)}
                      disabled={isLoadingMessages}
                    >
                      {isLoadingMessages ? '불러오는 중...' : '새로고침'}
                    </button>
                  </div>

                  {messagesError && <p className="error-text">{messagesError}</p>}

                  <ul className="message-list">
                    {messages.length === 0 && !isLoadingMessages && (
                      <li className="empty-state">표시할 채팅 메시지가 없습니다.</li>
                    )}
                    {messages.map((message) => (
                      <li key={message.id ?? `${message.senderName}-${message.content}`} className="message-item">
                        {message.profileImgUrl && (
                          <img
                            className="avatar"
                            src={message.profileImgUrl}
                            alt={`${message.senderName ?? '사용자'} 프로필`}
                          />
                        )}
                        <div className="message-body">
                          <div className="message-meta">
                            <span className="sender">{message.senderName ?? '알 수 없음'}</span>
                            <span className="message-id">ID {message.id ?? '-'}</span>
                          </div>
                          <p className="message-content">{message.content ?? ''}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <div className="empty-state">좌측에서 채팅방을 선택하세요.</div>
              )}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

export default App;
