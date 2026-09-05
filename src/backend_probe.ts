// Entry of backend-probe.html, the GPU backend probe page ("WoC config
// detector") the desktop shell opens with --test-backends. Desktop bundle only
// (scripts/lib/vite_entries.mjs): the site never serves it. The locale is
// handed over in the URL (`?lang=`, read by src/ui/i18n at import) because the
// measuring child runs on its own profile with no access to the game's storage;
// the non-English tables load lazily, so the first paint waits for them.

import { mountBackendProbe } from './probe';
import { ensureLocaleLoaded, getLanguage, t } from './ui/i18n';

const root = document.querySelector<HTMLElement>('#backend-probe-root');

async function boot(): Promise<void> {
  await ensureLocaleLoaded(getLanguage());
  document.title = t('probe.title');
  if (root) mountBackendProbe(root);
}

void boot();
