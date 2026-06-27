<script lang="ts">
  import { getAdminNavigation, ipHref } from '../navigation';

  let { ip }: { ip: string } = $props();
  const navigation = getAdminNavigation();
</script>

<a class="ip-link" href={ipHref(ip)} onclick={(event) => navigation.openIp(event, ip)}>
  <code>{ip}</code>
</a>

<style>
  .ip-link {
    display: inline-flex;
    align-items: center;
    border-radius: 3px;
  }

  .ip-link:focus-visible {
    outline: 2px solid var(--gold);
    outline-offset: 2px;
  }

  @media (pointer: coarse) {
    .ip-link {
      min-width: 40px;
      min-height: 40px;
    }
  }
</style>
