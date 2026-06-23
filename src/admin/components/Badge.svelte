<script lang="ts">
  import type { Snippet } from 'svelte';

  // Small inline status pill. Default is gold; `warn` is orange, `bad` is red.
  let { variant = 'default', children }: { variant?: 'default' | 'warn' | 'bad'; children: Snippet } = $props();
</script>

<span class="badge" class:warn={variant === 'warn'} class:bad={variant === 'bad'}>{@render children()}</span>
