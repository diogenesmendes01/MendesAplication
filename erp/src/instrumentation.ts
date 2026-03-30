/**
 * Next.js Instrumentation Hook
 *
 * This file is loaded by Next.js on server startup (before any routes are served).
 * It is the correct place to initialize long-running server-side processes like
 * BullMQ workers, so they start alongside the Next.js server in a single process.
 *
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register() {
  // Workers must only run in the Node.js runtime (not Edge runtime).
  // NEXT_RUNTIME is set to 'nodejs' for standard server routes and to 'edge'
  // for middleware / Edge API routes. Guard is required to avoid crashes.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('@/lib/workers/index');
  }
}
