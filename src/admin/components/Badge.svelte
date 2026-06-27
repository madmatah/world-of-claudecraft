<script lang="ts">
  import type { Snippet } from 'svelte';

  // Small inline status pill. Semantic variants keep account and moderation
  // indicators visually consistent across otherwise unrelated admin pages.
  let {
    variant = 'default',
    children,
  }: {
    variant?: 'default' | 'neutral' | 'warn' | 'bad' | 'success' | 'admin';
    children: Snippet;
  } = $props();
</script>

<span
  class="badge"
  class:neutral={variant === 'neutral'}
  class:warn={variant === 'warn'}
  class:bad={variant === 'bad'}
  class:success={variant === 'success'}
  class:admin={variant === 'admin'}
>{@render children()}</span>
