# Install and use offline

PWA features run in production builds, served over HTTPS (or localhost for testing).
Run `npm run build`, then `npm run preview` to check locally. The Vite development
server intentionally does not register a service worker.

Open the app online once and allow the service worker installation to finish.
Supported browsers offer an **Install Moshi Urban** button when installation is
available. On iPhone or iPad, use Safari's Share menu and **Add to Home Screen**.
Browser installation menus may also be available.

The service worker saves the application shell, bundled JavaScript/CSS, and local
images. It does not cache Google/Firebase API responses, authentication requests,
or external fonts. Cached booking records still use the existing local storage
implementation. Offline reopening can render the app; access to the dashboard
still depends on a previously authenticated session. First-time sign-in needs
internet. Offline booking writes are not supported, and cached availability may
be stale. Reconnect and refresh before making booking decisions.

Updates install in the background and display a notice. Finish your work, close
all windows of this app, then reopen. Updates never force a reload during editing.
Old application caches are deleted when the new worker activates. Deploy the
whole `dist` directory together, serve `sw.js` without long-lived HTTP caching,
and keep the app at the domain root.

## Browser verification

1. Use a normal browser profile (incognito can prevent installation).
2. Open the production app and inspect Application → Manifest and Service Workers
   in browser developer tools. Check that the worker is active and the app cache
   contains the shell, bundle, icons, and manifest.
3. Enable offline mode and reload. The login screen or authenticated app should
   render without an application exception; external fonts may use fallbacks.
4. With an existing authorized session, confirm cached reservations are shown
   with an offline indicator and that saving requires reconnection.
5. Reconnect, deploy a new build, and reopen after closing every app window to
   verify the new worker activates. Do not test writes against real bookings.
