<script lang="ts">
  import { fmtDate } from '../format';
  import { t } from '../i18n';
  import Badge from './Badge.svelte';

  let {
    isAdmin = false,
    online = false,
    status,
    suspendedUntil = null,
  }: {
    isAdmin?: boolean;
    online?: boolean;
    status?: 'active' | 'suspended' | 'banned';
    suspendedUntil?: string | null;
  } = $props();
</script>

<span class="account-indicators">
  {#if isAdmin}<Badge variant="admin">{t('accounts.badgeAdmin')}</Badge>{/if}
  {#if online}<Badge variant="success">{t('moderation.badgeOnline')}</Badge>{/if}
  {#if status === 'banned'}
    <Badge variant="bad">{t('accounts.badgeBanned')}</Badge>
  {:else if status === 'suspended'}
    <Badge variant="warn">{t('detail.suspendedUntil', { value: fmtDate(suspendedUntil) })}</Badge>
  {:else if status === 'active'}
    <Badge variant="neutral">{t('detail.statusActive')}</Badge>
  {/if}
</span>

<style>
  .account-indicators {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
</style>
