<script lang="ts">
  import type { AccountDetail } from '../types';
  import { classLabel, localizeAdminError, t } from '../i18n';
  import { fmtCopper, fmtDate, fmtDuration, fmtRelative } from '../format';
  import { apiPost } from '../api';
  import { auth } from '../state/auth.svelte';
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
  import ConfirmDialog from '../components/ConfirmDialog.svelte';
  import Badge from '../components/Badge.svelte';

  // Reusable account body: moderation actions, chat state, characters, and recent
  // sessions. Identity and account status belong to the parent context (table row,
  // moderation queue, or modal header). After a successful action, onChanged asks the
  // parent to refresh; the server re-authorizes every action regardless.
  let {
    detail,
    includeAdminControls = false,
    onChanged,
  }: {
    detail: AccountDetail;
    includeAdminControls?: boolean;
    onChanged: () => void;
  } = $props();

  let note = $state('');
  let customExpiry = $state('');
  let pending = $state<PendingAction | null>(null);

  let canModerate = $derived(includeAdminControls && !detail.isAdmin);
  let activeChatMute = $derived(detail.chatMutedUntil !== null && new Date(detail.chatMutedUntil).getTime() > Date.now());

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
      onChanged();
    } catch (err) {
      if (!auth.handleAuthFailure(err)) {
        window.alert(err instanceof Error ? localizeAdminError(err.message) : t('alert.actionFailed'));
      }
    }
  }

  // Lift mute / reset strikes are non-destructive and skip the confirm dialog, matching
  // the old flow. Available for any account (incl. admins) so an auto-muted operator can
  // clear it.
  async function direct(endpoint: string): Promise<void> {
    try {
      await apiPost(endpoint, {});
      onChanged();
    } catch (err) {
      if (!auth.handleAuthFailure(err)) {
        window.alert(err instanceof Error ? localizeAdminError(err.message) : t('alert.actionFailed'));
      }
    }
  }
</script>

<div class="account-detail">
  {#if canModerate}
    <div class="account-admin-controls mod-account-actions">
      {#if detail.moderationReason}
        <div class="moderation-reason">
          {t('detail.reason', { value: detail.moderationReason })}
        </div>
      {/if}
      {#if activeChatMute && detail.chatMuteReason}
        <div class="moderation-reason">
          <b>{t('detail.chatMuteLabel')}</b>
          {t('detail.reason', { value: detail.chatMuteReason })}
        </div>
      {/if}
      <input class="account-mod-reason" placeholder={t('detail.notePlaceholder')} maxlength="500" bind:value={note} />
      {#if detail.bannedAt}
        <button onclick={() => run(unbanAccount(detail.id, note.trim()))}>{t('detail.unban')}</button>
      {:else}
        <button onclick={() => run(suspendHours(detail.id, 1, note.trim()))}>{t('detail.suspend1h')}</button>
        <button onclick={() => run(suspendHours(detail.id, 24, note.trim()))}>{t('detail.suspend24h')}</button>
        <button onclick={() => run(suspendHours(detail.id, 72, note.trim()))}>{t('detail.suspend3d')}</button>
        <button onclick={() => run(suspendHours(detail.id, 168, note.trim()))}>{t('detail.suspend7d')}</button>
        <button onclick={() => run(suspendHours(detail.id, 720, note.trim()))}>{t('detail.suspend30d')}</button>
        <input class="account-custom-expiry" type="datetime-local" bind:value={customExpiry} />
        <button onclick={() => run(suspendCustom(detail.id, customExpiry, note.trim()))}>{t('detail.suspendCustom')}</button>
        <button onclick={() => run(chatMuteHours(detail.id, 1, note.trim()))}>{t('detail.chatMute1h')}</button>
        <button onclick={() => run(chatMuteCustom(detail.id, customExpiry, note.trim()))}>{t('detail.chatMuteCustom')}</button>
        <button class="danger" onclick={() => run(banAccount(detail.id, note.trim()))}>{t('detail.ban')}</button>
      {/if}
    </div>
    {#if pending}
      <ConfirmDialog title={pending.title} rows={pending.rows} danger={pending.danger} onConfirm={confirm} onCancel={() => (pending = null)} />
    {/if}
  {/if}

  {#if includeAdminControls}
    <div class="account-admin-controls chat-mod-controls">
      <div class="account-status">
        <b>{t('chatMod.chatLabel')}</b>
        {#if activeChatMute}<Badge variant="warn">{t('chatMod.mutedUntil', { value: fmtDate(detail.chatMutedUntil) })}</Badge>{:else}<Badge>{t('chatMod.notMuted')}</Badge>{/if}
        · {t('chatMod.strikesInline')} <b>{detail.chatStrikes}</b>
      </div>
      {#if activeChatMute}<button onclick={() => direct(`/admin/api/moderation/accounts/${detail.id}/lift-mute`)}>{t('chatMod.liftChatMute')}</button>{/if}
      {#if detail.chatStrikes > 0}<button onclick={() => direct(`/admin/api/moderation/accounts/${detail.id}/reset-strikes`)}>{t('chatMod.resetChatStrikes')}</button>{/if}
    </div>
  {/if}

  <div class="detail-grid">
    <div>
      <h4>{t('detail.charactersHeader')}</h4>
      {#if detail.characters.length === 0}
        <div class="empty">{t('detail.noCharacters')}</div>
      {:else}
        <table>
          <thead>
            <tr>
              <th>{t('detail.colName')}</th>
              <th>{t('characters.colClass')}</th>
              <th class="num">{t('characters.colLevel')}</th>
              <th class="num">{t('detail.colXp')}</th>
              <th class="num">{t('detail.colMoney')}</th>
              <th class="num">{t('online.colPos')}</th>
              <th>{t('characters.colLastPlayed')}</th>
              {#if canModerate}<th>{t('detail.colActions')}</th>{/if}
            </tr>
          </thead>
          <tbody>
            {#each detail.characters as c}
              <tr>
                <td>{c.name}</td>
                <td>{classLabel(c.class)}</td>
                <td class="num">{c.level}</td>
                <td class="num">{c.xp}</td>
                <td class="num">{fmtCopper(c.copper)}</td>
                <td class="num">{c.pos ? `${Math.round(c.pos.x)}, ${Math.round(c.pos.z)}` : '—'}</td>
                <td>{fmtRelative(c.updatedAt)}</td>
                {#if canModerate}<td><button onclick={() => run(forceRename(c.id, c.name, note.trim()))}>{t('detail.forceNameChange')}</button></td>{/if}
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </div>
    <div>
      <h4>{t('detail.sessionsHeader', { value: fmtDuration(detail.playtimeSeconds) })}</h4>
      {#if detail.recentSessions.length === 0}
        <div class="empty">{t('detail.noSessions')}</div>
      {:else}
        <table>
          <thead>
            <tr><th>{t('online.colCharacter')}</th><th>{t('detail.started')}</th><th class="num">{t('dialog.length')}</th></tr>
          </thead>
          <tbody>
            {#each detail.recentSessions as s}
              <tr>
                <td>{s.characterName}</td>
                <td>{fmtDate(s.startedAt)}</td>
                <td class="num">{s.endedAt ? fmtDuration(s.seconds) : t('detail.onlineNow')}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </div>
  </div>
</div>
