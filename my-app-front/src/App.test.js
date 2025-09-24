import { render, screen } from '@testing-library/react';
import App from './App';

test('renders login form and helper text', () => {
  render(<App />);

  expect(screen.getByRole('heading', { name: /festival chat/i })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: /로그인/i })).toBeInTheDocument();
  expect(screen.getByPlaceholderText(/아이디를 입력하세요/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /로그인/ })).toBeInTheDocument();
});
