export function errorMessage(cause: unknown, fallback: string): string {
  const raw = cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : '';
  const cleaned = raw
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim();
  if (/an object could not be cloned/i.test(cleaned)) {
    return 'No se pudo preparar la configuración para iniciar el procesamiento. Inténtalo nuevamente.';
  }
  return cleaned || fallback;
}
