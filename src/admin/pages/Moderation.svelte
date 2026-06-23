<script lang="ts">
  import { onMount } from 'svelte';
  import type { ModerationQueueRow } from '../types';
  import { apiGet } from '../api';
  import { auth } from '../state/auth.svelte';
  import { t } from '../i18n';
  import { fmtDate, fmtRelative } from '../format';
  import { reasonLabel } from '../labels';
  import Panel from '../components/Panel.svelte';
  import Badge from '../components/Badge.svelte';
  import ModerationDetail from './ModerationDetail.svelte';

  // Moderation tab: the report queue (highest open-report counts first) and the detail
  // for the selected account. Ported from renderModerationQueue + openModerationAccount.
  let rows = $state<ModerationQueueRow[]>([]);
  let failed = $state(false);
  let selectedId = $state<number | null>(null);

  async function refreshQueue(): Promise<void> {
    try {
      const data = await apiGet<{ rows: ModerationQueueRow[] }>('/admin/api/moderation/queue');
      rows = data.rows;
      failed = false;
    } catch (err) {
      if (!auth.handleAuthFailure(err)) failed = true;
    }
  }

  onMount(() => { void refreshQueue(); });
</script>

<Panel title={t('moderation.title')} hint={t('moderation.queueHint')}>
  {#if failed}
    <div class="empty">{t('moderation.loadFailed')}</div>
  {:else if rows.length === 0}
    <div class="empty">{t('moderation.empty')}</div>
  {:else}
    <table>
      <thead>
        <tr>
          <th>{t('moderation.colAccount')}</th>
          <th>{t('moderation.colCharacters')}</th>
          <th class="num">{t('moderation.colOpenReports')}</th>
          <th>{t('moderation.colLatestReason')}</th>
          <th>{t('moderation.colLatest')}</th>
          <th>{t('moderation.colStatus')}</th>
        </tr>
      </thead>
      <tbody>
        {#each rows as r (r.accountId)}
          <tr class="clickable" onclick={() => (selectedId = r.accountId)}>
            <td>{r.username}{#if r.online} <Badge>{t('moderation.badgeOnline')}</Badge>{/if}</td>
            <td>{r.characterNames.join(', ') || '—'}</td>
            <td class="num">{r.openReports}</td>
            <td>{reasonLabel(r.latestReason)}</td>
            <td>{fmtRelative(r.latestReportAt)}</td>
            <td>
              {#if r.status === 'banned'}<Badge variant="bad">{t('accounts.badgeBanned')}</Badge>
              {:else if r.status === 'suspended'}<Badge variant="warn">{t('detail.suspendedUntil', { value: fmtDate(r.suspendedUntil) })}</Badge>
              {:else}<Badge>{t('detail.statusActive')}</Badge>{/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}

  {#if selectedId !== null}
    <div id="moderation-detail">
      <ModerationDetail accountId={selectedId} onQueueRefresh={refreshQueue} />
    </div>
  {/if}
</Panel>
