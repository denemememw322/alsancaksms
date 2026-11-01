import { supabase } from '@/lib/supabase';

/** Invoke an Edge Function and surface the server's own error message. */
export async function callFn<T = unknown>(name: string, body: Record<string, unknown>): Promise<{ data?: T; error?: string }> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let m = 'Request failed. Please try again.';
    try { m = (await (error as unknown as { context: Response }).context.json()).error ?? m; } catch { /* keep generic */ }
    return { error: m };
  }
  return { data: data as T };
}
