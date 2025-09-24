import { render, screen } from '@testing-library/react';
import App from './App';

test('renders landing page title and login buttons', () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: /FestaPick 연동 데모/i })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: /소셜 로그인/i })).toBeInTheDocument();
});
