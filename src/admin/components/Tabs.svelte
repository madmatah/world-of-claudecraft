<script lang="ts">
  import { t } from '../i18n';
  import type { AdminPage } from '../pages/pages';

  // Top tab bar. Data-driven from the page list; the parent owns the active page and
  // refetches on change. Mirrors the old #admin-tabs nav and .admin-tab styling.
  let {
    pages,
    active,
    onSelect,
  }: {
    pages: readonly { id: AdminPage; labelKey: string }[];
    active: AdminPage;
    onSelect: (page: AdminPage) => void;
  } = $props();
</script>

<nav id="admin-tabs">
  {#each pages as p}
    <button class="admin-tab" class:active={p.id === active} data-admin-page={p.id} onclick={() => onSelect(p.id)}>
      {t(p.labelKey)}
    </button>
  {/each}
</nav>
