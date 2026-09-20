// Shared MARC heading representation. Data is stored separately by heading-store.js.
export function normalizeTerm(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es').replace(/\s*--\s*/g, ' -- ').replace(/\s+/g, ' ').trim().replace(/[.,;:]$/, '');
}

export function headingLabel(heading) {
  return [heading.main, ...(heading.subdivisions || []).map(part => part.value)].join(' -- ');
}

export function validateHeading(value) {
  if (!value || typeof value.main !== 'string' || !value.main.trim() || value.main.length > 500 || value.main.includes('--')) {
    throw new Error('El encabezamiento debe tener un campo principal válido.');
  }
  if (!Array.isArray(value.subdivisions) || value.subdivisions.length > 2) {
    throw new Error('Se permiten como máximo dos subdivisiones.');
  }
  const subdivisions = value.subdivisions.map(part => {
    if (!part || !['x', 'y', 'z', 'v'].includes(part.code) || typeof part.value !== 'string' || !part.value.trim() || part.value.length > 500 || part.value.includes('--')) {
      throw new Error('Subdivisión MARC inválida: usa x, y, z o v.');
    }
    return { code: part.code, value: part.value.trim() };
  });
  const heading = { main: value.main.trim(), subdivisions };
  return { ...heading, label: headingLabel(heading) };
}

export function headingKey(heading) {
  return JSON.stringify([normalizeTerm(heading.main), ...heading.subdivisions.map(part => [part.code, normalizeTerm(part.value)])]);
}

export function parseGeneratedHeadings(raw, existingMain = '', mode = 'pdf') {
  const parsed = JSON.parse(String(raw).trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, ''));
  const count = mode === 'pdf' ? 5 : 1;
  if (!Array.isArray(parsed) || parsed.length !== count) throw new Error(`La IA debe devolver ${count} encabezamiento(s). Vuelve a intentarlo.`);
  const headings = parsed.map(validateHeading);
  if (existingMain && headings.some(h => normalizeTerm(h.main) !== normalizeTerm(existingMain))) {
    throw new Error('La IA cambió el encabezamiento 650$a existente. Vuelve a intentarlo.');
  }
  return headings.map(h => existingMain ? { ...h, main: existingMain, label: headingLabel({ ...h, main: existingMain }) } : h);
}
