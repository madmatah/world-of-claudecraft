<script lang="ts">
  import type { ModerationAccountDetail } from '../types';
  import { t } from '../i18n';
  import { knownAccountIps } from '../ip_block';
  import { banIp, type PendingAction } from '../moderation_actions';
  import Panel from './Panel.svelte';
  import Badge from './Badge.svelte';
  import IpLink from './IpLink.svelte';

  // An account's recent IPs and their block status, so a moderator sees at a glance why
  // a player cannot connect. Ban is confirmed (onBan opens the shared confirm dialog);
  // unblock is reversible and applies directly. Admins can't be locked out, so their
  // unblocked IPs offer no ban button. Ported from renderIpBlockSection.
  let {
    detail,
    note,
    onBan,
    onUnblock,
  }: {
    detail: ModerationAccountDetail;
    note: string;
    onBan: (pending: PendingAction) => void;
    onUnblock: (ip: string) => void;
  } = $props();

  let ips = $derived(knownAccountIps(detail));
  const banButtons = [
    { duration: '1d', label: () => t('blockedIps.ban24h') },
    { duration: '30d', label: () => t('blockedIps.ban30d') },
    { duration: '', label: () => t('blockedIps.banForever') },
  ];
</script>

<Panel title={t('blockedIps.accountSectionTitle')}>
  {#if ips.length === 0}
    <div class="empty">{t('blockedIps.noKnownIps')}</div>
  {:else}
    <div class="ip-block">
      {#each ips as entry (entry.ip)}
        <div class="ip-row">
          <IpLink ip={entry.ip} />
          {#if entry.isLast}<span class="hint">{t('blockedIps.lastIp')}</span>{/if}
          {#if entry.blocked}<Badge variant="bad">{t('blockedIps.blockedBadge')}</Badge>{/if}
          {#if entry.blocked}
            <button onclick={() => onUnblock(entry.ip)}>{t('blockedIps.unblock')}</button>
          {:else if detail.account.isAdmin}
            <span class="hint">{t('blockedIps.adminProtected')}</span>
          {:else}
            {#each banButtons as b}
              <button class="danger" onclick={() => onBan(banIp(entry.ip, b.label(), b.duration, note))}>{b.label()}</button>
            {/each}
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</Panel>
