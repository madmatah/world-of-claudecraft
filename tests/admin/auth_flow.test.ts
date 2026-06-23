// @vitest-environment jsdom
import './_setup';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Stateful mock of the network/token layer so auth state transitions are exercised
// without a server. h.token backs getToken(); a successful apiLogin sets it.
const h = vi.hoisted(() => {
  let token: string | null = null;
  return {
    apiLogin: vi.fn(),
    setToken: (v: string | null) => {
      token = v;
    },
    getToken: () => token,
  };
});

vi.mock('../../src/admin/api', () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  apiLogin: h.apiLogin,
  clearSession: () => h.setToken(null),
  getAdminName: () => 'alice',
  getToken: () => h.getToken(),
}));

import App from '../../src/admin/App.svelte';
import { ApiError } from '../../src/admin/api';
import { t } from '../../src/admin/i18n';
import { auth } from '../../src/admin/state/auth.svelte';

beforeEach(() => {
  h.apiLogin.mockReset();
  h.setToken(null);
  auth.token = null;
  auth.name = '';
  auth.loginError = '';
  auth.sessionMessage = '';
});

describe('admin auth flow', () => {
  it('shows the login screen when not authed', () => {
    render(App);
    expect(screen.getByText(t('auth.signIn'))).toBeInTheDocument();
    expect(screen.queryByText(t('auth.signOut'))).not.toBeInTheDocument();
  });

  it('logs in and reveals the dashboard chrome', async () => {
    h.apiLogin.mockImplementation(async () => {
      h.setToken('tok');
      return 'alice';
    });
    render(App);
    await fireEvent.input(screen.getByLabelText(t('auth.username')), {
      target: { value: 'alice' },
    });
    await fireEvent.input(screen.getByLabelText(t('auth.password')), { target: { value: 'pw' } });
    await fireEvent.submit(screen.getByText(t('auth.signIn')).closest('form')!);

    expect(await screen.findByText(t('auth.signOut'))).toBeInTheDocument();
    expect(screen.getByText('alice')).toBeInTheDocument();
    expect(h.apiLogin).toHaveBeenCalledWith('alice', 'pw');
  });

  it('shows a localized error and stays on login when credentials fail', async () => {
    h.apiLogin.mockRejectedValue(new ApiError(401, 'invalid credentials'));
    render(App);
    await fireEvent.input(screen.getByLabelText(t('auth.username')), { target: { value: 'bob' } });
    await fireEvent.input(screen.getByLabelText(t('auth.password')), { target: { value: 'nope' } });
    await fireEvent.submit(screen.getByText(t('auth.signIn')).closest('form')!);

    await vi.waitFor(() => expect(auth.loginError).not.toBe(''));
    expect(screen.queryByText(t('auth.signOut'))).not.toBeInTheDocument();
  });

  it('logout returns to the login screen with a session message', async () => {
    auth.token = 'tok';
    auth.name = 'alice';
    render(App);
    expect(screen.getByText(t('auth.signOut'))).toBeInTheDocument();
    await fireEvent.click(screen.getByText(t('auth.signOut')));
    expect(await screen.findByText(t('auth.signIn'))).toBeInTheDocument();
  });
});
