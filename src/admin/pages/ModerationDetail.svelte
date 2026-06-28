<script lang="ts">
  import type { ModerationAccountDetail, ReportDetail } from '../types';
  import { apiGet, apiPost } from '../api';
  import { accountStatusFor } from '../account_status';
  import { auth } from '../state/auth.svelte';
  import { localizeAdminError, t } from '../i18n';
  import { fmtDate } from '../format';
  import { reasonLabel } from '../labels';
  import {
    type Built,
    banAccount,
    chatMuteCustom,
    chatMuteHours,
    forceRename,
    suspendCustom,
    suspendHours,
    unbanAccount,
    type PendingAction,
  } from '../moderation_actions';
  import AccountDetail from './AccountDetail.svelte';
  import ChatModeration from '../components/ChatModeration.svelte';
  import IpBlockSection from '../components/IpBlockSection.svelte';
  import ConfirmDialog from '../components/ConfirmDialog.svelte';

  // Full moderation detail for one account: read-only profile (characters + sessions),
  // account moderation actions, the chat incident log, the known-IP block section, and
  // the open reports. A single shared note + confirm dialog drive every action, mirroring
  // the old renderModerationDetail + handleModerationActionClick('moderation') flow.
  let { accountId, onQueueRefresh }: { accountId: number; onQueueRefresh: () => void } = $props();

  let detail = $state<ModerationAccountDetail | null>(null);
  let failed = $state(false);
  let note = $state('');
  let customExpiry = $state('');
  let pending = $state<PendingAction | null>(null);

  let banned = $derived(
    detail ? accountStatusFor(detail.account) === 'banned' : false,
  );

  async function refetch(): Promise<void> {
    try {
      detail = await apiGet<ModerationAccountDetail>(`/admin/api/moderation/accounts/${accountId}`);
      failed = false;
    } catch (err) {
      if (!auth.handleAuthFailure(err)) failed = true;
    }
  }

  // Re-fetch whenever the selected account changes.
  $effect(() => {
    accountId;
    pending = null;
    note = '';
    customExpiry = '';
    void refetch();
  });

  function fail(err: unknown): void {
    if (!auth.handleAuthFailure(err)) window.alert(err instanceof Error ? localizeAdminError(err.message) : t('alert.actionFailed'));
  }

  function run(built: Built): void {
    if ('errorKey' in built) {
      window.alert(t(built.errorKey));
      return;
    }
    pending = built.pending;
  }

  async function confirm(): Promise<void> {
    const p = pending;
    if (!p) return;
    try {
      await apiPost(p.endpoint, p.body);
      pending = null;
      onQueueRefresh();
      await refetch();
    } catch (err) {
      fail(err);
    }
  }

  async function direct(endpoint: string, body: unknown = {}): Promise<void> {
    try {
      await apiPost(endpoint, body);
      onQueueRefresh();
      await refetch();
    } catch (err) {
      fail(err);
    }
  }

  function ignoreReport(report: ReportDetail): void {
    void direct(`/admin/api/moderation/reports/${report.id}/ignore`, { note: note.trim() });
  }
</script>

{#if failed}
  <div class="empty">{t('report.loadFailed')}</div>
{:else if detail}
  <div class="mod-detail">
    <div class="panel-title">
      <span>{detail.account.username}</span>
      <span class="hint">{t('detail.accountNum', { id: detail.account.id })}</span>
    </div>

    <AccountDetail detail={detail.account} onChanged={refetch} />

    <ChatModeration
      chat={detail.chat}
      onLift={() => direct(`/admin/api/moderation/accounts/${accountId}/lift-mute`)}
      onReset={() => direct(`/admin/api/moderation/accounts/${accountId}/reset-strikes`)}
    />

    <div class="mod-account-actions">
      <input class="account-mod-reason" placeholder={t('detail.notePlaceholder')} maxlength="500" bind:value={note} />
      {#if banned}
        <button onclick={() => run(unbanAccount(accountId, note.trim()))}>{t('detail.unban')}</button>
      {:else}
        <button onclick={() => run(suspendHours(accountId, 1, note.trim()))}>{t('detail.suspend1h')}</button>
        <button onclick={() => run(suspendHours(accountId, 24, note.trim()))}>{t('detail.suspend24h')}</button>
        <button onclick={() => run(suspendHours(accountId, 72, note.trim()))}>{t('detail.suspend3d')}</button>
        <button onclick={() => run(suspendHours(accountId, 168, note.trim()))}>{t('detail.suspend7d')}</button>
        <button onclick={() => run(suspendHours(accountId, 720, note.trim()))}>{t('detail.suspend30d')}</button>
        <input class="account-custom-expiry" type="datetime-local" bind:value={customExpiry} />
        <button onclick={() => run(suspendCustom(accountId, customExpiry, note.trim()))}>{t('detail.suspendCustom')}</button>
        <button onclick={() => run(chatMuteHours(accountId, 1, note.trim()))}>{t('detail.chatMute1h')}</button>
        <button onclick={() => run(chatMuteCustom(accountId, customExpiry, note.trim()))}>{t('detail.chatMuteCustom')}</button>
        <button onclick={() => run(banAccount(accountId, note.trim()))}>{t('detail.ban')}</button>
      {/if}
    </div>

    {#if pending}
      <ConfirmDialog title={pending.title} rows={pending.rows} danger={pending.danger} onConfirm={confirm} onCancel={() => (pending = null)} />
    {/if}

    <IpBlockSection
      detail={detail}
      note={note}
      onBan={(p) => (pending = p)}
      onUnblock={(ip) => void direct('/admin/api/blocked-ips/delete', { ip })}
    />

    <h4>{t('report.openReports')}</h4>
    {#if detail.reports.length === 0}
      <div class="empty">{t('report.noOpenReports')}</div>
    {:else}
      {#each detail.reports as r (r.id)}
        <div class="mod-report panel">
          <div class="panel-title">{t('report.title', { id: r.id })} <span class="hint">{fmtDate(r.createdAt)}</span></div>
          <div class="mod-report-meta">
            <div><b>{t('report.reporter')}</b> {r.reporterUsername ?? t('common.unknown')} / {r.reporterCharacterName || t('common.unknown')}</div>
            <div><b>{t('report.reported')}</b> {r.reportedUsername} / {r.reportedCharacterName || t('common.unknown')}</div>
            <div><b>{t('report.reason')}</b> {reasonLabel(r.reason)}</div>
          </div>
          <div class="mod-details">{r.details || t('report.noDetails')}</div>
          <div class="mod-actions">
            <button onclick={() => ignoreReport(r)}>{t('report.ignore')}</button>
            {#if r.reportedCharacterId}
              {@const cid = r.reportedCharacterId}
              <button onclick={() => run(forceRename(cid, r.reportedCharacterName, note.trim()))}>{t('report.forceNameChange')}</button>
            {/if}
          </div>
          <h4>{t('report.recentChat')}</h4>
          {#if r.chatContext.length === 0}
            <div class="empty">{t('report.noChat')}</div>
          {:else}
            <table>
              <thead>
                <tr><th>{t('report.colTime')}</th><th>{t('report.colChannel')}</th><th>{t('report.colMessage')}</th></tr>
              </thead>
              <tbody>
                {#each r.chatContext as c (c.id)}
                  <tr>
                    <td>{fmtDate(c.createdAt)}</td>
                    <td>{c.channel}</td>
                    <td><b>{c.characterName}:</b> {c.message}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}
        </div>
      {/each}
    {/if}
  </div>
{/if}
