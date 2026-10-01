/**
 * The web build, sent with every usage event (M7-8): the git commit `deploy.sh` builds, or `dev`.
 */
export const APP_VERSION: string =
  (import.meta.env.VITE_APP_VERSION as string | undefined) || 'dev';
