<script lang="ts">
  import type { ChatModerationDetail } from '../types';
  import { t } from '../i18n';
  import { fmtDate, fmtDuration } from '../format';
  import Panel from './Panel.svelte';
  import Badge from './Badge.svelte';

  // Chat-filter state for an account in the moderation detail: live mute status, strike
  // count, the warn/mute incident log, and manual lift/reset (non-destructive, no
  // confirm). Ported from renderChatModeration. The parent owns the apiPost + refetch.
  let {
    chat,
    onLift,
    onReset,
  }: {
    chat: ChatModerationDetail;
    onLift: () => void;
    onReset: () => void;
  } = $props();
</script>

<Panel title={t('chatMod.title')}>
  <div class="chat-mod-status">
    {t('chatMod.status')}
    {#if chat.chatMutedUntil}<Badge variant="bad">{t('chatMod.mutedUntil', { value: fmtDate(chat.chatMutedUntil) })}</Badge>{:else}<Badge>{t('chatMod.notMuted')}</Badge>{/if}
    · {t('chatMod.strikes')} <b>{chat.chatStrikes}</b>
  </div>
  <div class="mod-actions">
    {#if chat.chatMutedUntil}<button onclick={onLift}>{t('chatMod.liftMute')}</button>{/if}
    {#if chat.chatStrikes > 0}<button onclick={onReset}>{t('chatMod.resetStrikes')}</button>{/if}
  </div>
  <h4>{t('chatMod.recentIncidents')}</h4>
  {#if chat.violations.length === 0}
    <div class="empty">{t('chatMod.noIncidents')}</div>
  {:else}
    <table>
      <thead>
        <tr><th>{t('report.colTime')}</th><th>{t('report.colChannel')}</th><th>{t('chatMod.colWord')}</th><th>{t('dialog.action')}</th><th>{t('report.colMessage')}</th></tr>
      </thead>
      <tbody>
        {#each chat.violations as v (v.id)}
          <tr>
            <td>{fmtDate(v.createdAt)}</td>
            <td>{v.channel}</td>
            <td>{v.term}</td>
            <td>{v.action}{#if v.muteSeconds > 0} ({fmtDuration(v.muteSeconds)}){/if}</td>
            <td>{v.message}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</Panel>
