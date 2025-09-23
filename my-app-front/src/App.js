import React, { useCallback, useEffect, useState } from 'react';
import HomePage from './HomePage';
import TokenExchangePage from './TokenExchangePage';
import { AuthProvider } from './context';
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
      {renderPage()}
    </AuthProvider>
  );
}
