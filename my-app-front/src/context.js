import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const AuthContext = createContext({
  accessToken: null,
  setAccessToken: () => {},
  clearAccessToken: () => {},
});

const STORAGE_KEY = 'festapick_access_token';

export function AuthProvider({ children }) {
  const [accessToken, setAccessTokenState] = useState(() => {
    try {
      return sessionStorage.getItem(STORAGE_KEY);
    } catch (error) {
      console.warn('Failed to read stored access token', error);
      return null;
    }
  });

  useEffect(() => {
    try {
      if (accessToken) {
        sessionStorage.setItem(STORAGE_KEY, accessToken);
      } else {
        sessionStorage.removeItem(STORAGE_KEY);
      }
    } catch (error) {
      console.warn('Failed to persist access token', error);
    }
  }, [accessToken]);

  const setAccessToken = useCallback((token) => {
    setAccessTokenState(token ?? null);
  }, []);

  const clearAccessToken = useCallback(() => {
    setAccessTokenState(null);
  }, []);

  const value = useMemo(() => ({ accessToken, setAccessToken, clearAccessToken }), [accessToken, setAccessToken, clearAccessToken]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
