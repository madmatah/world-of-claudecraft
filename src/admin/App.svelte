<script lang="ts">
  import { auth } from './state/auth.svelte';
  import { session } from './state/session.svelte';
  import { PAGES, type AdminPage } from './pages/pages';
  import { t } from './i18n';
  import Login from './components/Login.svelte';
  import Tabs from './components/Tabs.svelte';
  import Overview from './pages/Overview.svelte';
  import Usage from './pages/Usage.svelte';
  import Moderation from './pages/Moderation.svelte';
  import ChatFilter from './pages/ChatFilter.svelte';
  import BlockedIps from './pages/BlockedIps.svelte';
  import BugReports from './pages/BugReports.svelte';

  // Root of the admin SPA. Shows the login overlay until authed, then the dashboard
  // chrome (header + tabs) and the active page. The {#key session.locale} wrapper
  // re-renders everything when the locale changes, since the admin t() reads a
  // module-level current locale that Svelte does not track. Each page owns its own
  // data fetching and live timers (mounted/unmounted with the tab).
  let active = $state<AdminPage>('overview');
</script>

{#key session.locale}
  {#if !auth.authed}
    <Login />
  {:else}
    <header>
      <h1>{t('app.title')}</h1>
      <div class="who">
        <span>{t('auth.signedInAs')}</span> <span id="who-name">{auth.name}</span><button type="button" onclick={() => auth.logout()}>{t('auth.signOut')}</button>
      </div>
    </header>

    <Tabs pages={PAGES} {active} onSelect={(p) => (active = p)} />

    {#if active === 'overview'}
      <Overview />
    {:else if active === 'usage'}
      <Usage />
    {:else if active === 'moderation'}
      <Moderation />
    {:else if active === 'chat-filter'}
      <ChatFilter />
    {:else if active === 'blocked-ips'}
      <BlockedIps />
    {:else if active === 'bug-reports'}
      <BugReports />
    {/if}
  {/if}
{/key}
