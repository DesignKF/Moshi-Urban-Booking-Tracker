import {useEffect, useState} from 'react';

interface InstallEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{outcome: 'accepted' | 'dismissed'}>;
}

export function PwaControls() {
  const [install, setInstall] = useState<InstallEvent | null>(null);
  const [update, setUpdate] = useState(false);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    const offerInstall = (event: Event) => {
      event.preventDefault();
      setInstall(event as InstallEvent);
    };
    const installed = () => setInstall(null);
    window.addEventListener('beforeinstallprompt', offerInstall);
    window.addEventListener('appinstalled', installed);
    if (import.meta.env.PROD && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').then(registration => {
        if (registration.waiting) setUpdate(true);
        registration.addEventListener('updatefound', () => {
          const worker = registration.installing;
          worker?.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) setUpdate(true);
          });
        });
      }).catch(error => console.warn('Offline setup could not complete:', error));
    }
    return () => {
      window.removeEventListener('beforeinstallprompt', offerInstall);
      window.removeEventListener('appinstalled', installed);
    };
  }, []);

  if (!install && !update) return null;
  return <aside aria-label="App installation" className="fixed bottom-24 right-4 z-[100] max-w-xs rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-800 shadow-lg">
    {update && <p role="status" className="mb-2">An app update is ready. Finish your work, then close all app windows and reopen to update.</p>}
    {install && <button type="button" disabled={installing} className="rounded-lg bg-[#1b2c44] px-4 py-2 font-semibold text-white disabled:opacity-50" onClick={async () => {
      setInstalling(true);
      try {
        await install.prompt();
        await install.userChoice;
        setInstall(null);
      } catch (error) {
        console.warn('App installation could not open:', error);
      } finally {
        setInstalling(false);
      }
    }}>Install Moshi Urban</button>}
    <button type="button" className="ml-3 rounded px-2 py-2 underline" onClick={() => {setInstall(null); setUpdate(false);}}>Dismiss</button>
  </aside>;
}
