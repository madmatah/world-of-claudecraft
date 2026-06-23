<script lang="ts">
  import { t } from '../i18n';

  // Prev / "page X of Y (N total)" / Next, matching the old renderPager(). Calls
  // onPage with the target page; the parent owns the page state and refetches.
  let { total, page, limit, onPage }: { total: number; page: number; limit: number; onPage: (page: number) => void } = $props();

  let pages = $derived(Math.max(1, Math.ceil(total / limit)));
</script>

<button disabled={page <= 1} onclick={() => onPage(page - 1)}>{t('accounts.prev')}</button>
<span>{t('accounts.pager', { page, pages, total })}</span>
<button disabled={page >= pages} onclick={() => onPage(page + 1)}>{t('accounts.next')}</button>
