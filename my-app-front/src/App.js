import React, { useCallback, useEffect, useState } from 'react';
import HomePage from './HomePage';
import TokenExchangePage from './TokenExchangePage';
import { AuthProvider } from './context';
import { BACKEND_BASE_URL } from './config';
import './App.css';

function useSimpleRouter() {
  const [path, setPath] = useState(() => window.location.pathname);

  useEffect(() => {
    const handlePopState = () => {
      setPath(window.location.pathname);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigate = useCallback((nextPath) => {
    if (nextPath === window.location.pathname) {
      return;
    }
    window.history.pushState(null, '', nextPath);
    setPath(nextPath);
  }, []);

  return { path, navigate };
}

export default function App() {
  const router = useSimpleRouter();

  const renderPage = () => {
    if (router.path === '/cookie') {
      return <TokenExchangePage navigate={router.navigate} />;
    }
    return <HomePage navigate={router.navigate} />;
  };

  return (
    <AuthProvider>
      <div className="app-shell">
        <div className="backend-indicator" role="status" aria-live="polite">
          <span className="backend-indicator__label">현재 연결된 백엔드</span>
          <code className="backend-indicator__value">{BACKEND_BASE_URL}</code>
        </div>
        {renderPage()}
      </div>
    </AuthProvider>
  );
}
