// Which view the probe entry shows, from its URL query. One root html carries
// four views (the consent screen, the parent's progress line, the verdict, and
// the child's measuring view) so every root entry obligation is paid once; the
// desktop shell picks the view when it opens a window, and a bare open with no
// query is the consent screen, the only view a player reaches on their own.

export type ProbeView = 'consent' | 'progress' | 'verdict' | 'probe';

export const PROBE_VIEWS: readonly ProbeView[] = ['consent', 'progress', 'verdict', 'probe'];

/** `?view=` exact-literal only: a near miss lands on the consent screen, never
 *  on the measuring view, which only the shell may open. */
export function probeViewFromSearch(search: string): ProbeView {
  const value = new URLSearchParams(search).get('view');
  return PROBE_VIEWS.includes(value as ProbeView) ? (value as ProbeView) : 'consent';
}
