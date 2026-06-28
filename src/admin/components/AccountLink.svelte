<script lang="ts">
  import { getAccountModalController } from '../account_modal';

  let { accountId, username }: { accountId: number; username: string } = $props();
  const accountModal = getAccountModalController();

  function open(): void {
    accountModal?.open(accountId);
  }
</script>

<button class="btn-link" type="button" aria-haspopup="dialog" onclick={open}>
  {username}
</button>
