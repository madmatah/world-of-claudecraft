// What a probe child says about the passes it had to throw away.
//
// A section runs two passes and a pass the interference monitor judges disturbed
// is replayed once, then kept but marked invalid; a section with no valid pass
// leaves its arm without that figure, and the reference arm losing one is enough
// for the whole run to end inconclusive. The reasons live in the child's result
// file, which the NEXT run deletes, so an inconclusive run in the wild used to
// leave nothing behind: the first Windows run had to be diagnosed by reading a
// file off the machine before it was overwritten. The child now says it in its
// own log, which the parent copies into the shell log it ships with support.
//
// Only the sections that lost a pass are named: a clean run stays one line.

/** A section's line, or null when every pass of it counted. */
function sectionLine(name, record) {
  if (!record || typeof record !== 'object') return null;
  const validity = Array.isArray(record.validity) ? record.validity : [];
  // No passes at all is a malformed record, not a disturbance to report.
  if (validity.length === 0 || validity.every(Boolean)) return null;
  const kept = validity.filter(Boolean).length;
  const reasons = Array.isArray(record.disturbances) ? [...new Set(record.disturbances)] : [];
  const replays = Number.isFinite(record.replays) ? record.replays : 0;
  return `${name}: ${kept}/${validity.length} passes kept, ${replays} replayed${
    reasons.length ? `, disturbed by ${reasons.join(', ')}` : ''
  }`;
}

/**
 * One line per section that lost a pass, in section order. Empty when the whole
 * result counted, or when there is no result to read.
 */
function disturbanceLines(result) {
  const sections = result && typeof result === 'object' ? result.sections : null;
  if (!sections || typeof sections !== 'object') return [];
  const lines = [];
  for (const [name, record] of Object.entries(sections)) {
    const line = sectionLine(name, record);
    if (line) lines.push(line);
  }
  return lines;
}

module.exports = { disturbanceLines, sectionLine };
