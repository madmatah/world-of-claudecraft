import { getContext, setContext } from 'svelte';

export interface AdminNavigation {
  openIp: (event: MouseEvent, ip: string) => void;
}

const NAVIGATION_CONTEXT = Symbol('admin-navigation');

export function setAdminNavigation(navigation: AdminNavigation): void {
  setContext(NAVIGATION_CONTEXT, navigation);
}

export function getAdminNavigation(): AdminNavigation {
  return (
    getContext<AdminNavigation | undefined>(NAVIGATION_CONTEXT) ?? {
      openIp: () => {},
    }
  );
}

function urlWithIp(ip: string | null): URL {
  const url = new URL(window.location.href);
  if (ip === null) url.searchParams.delete('ip');
  else url.searchParams.set('ip', ip);
  return url;
}

export function ipHref(ip: string): string {
  const url = urlWithIp(ip);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function dashboardHref(): string {
  const url = urlWithIp(null);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function locationIp(): string | null {
  return new URL(window.location.href).searchParams.get('ip');
}

export function shouldHandleNavigation(event: MouseEvent): boolean {
  return (
    event.button === 0 &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey
  );
}
