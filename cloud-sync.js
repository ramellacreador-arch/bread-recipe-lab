window.breadCloud = (() => {
  let revision = 0, baseline = '', ready = false, busy = false, conflict = false;
  const pendingKey = 'bread-lab-unsynced-backup';
  const status = (message) => { const node = document.querySelector('#save-status'); if (node) node.textContent = message; };
  async function request(method, data) {
    const response = await fetch('/api/workspace', {method, cache: 'no-store', credentials: 'same-origin', headers: {'Content-Type': 'application/json'}, ...(data ? {body: JSON.stringify(data)} : {})});
    if (!response.ok) {
      const error = new Error(response.status === 401 ? 'Sign in again to sync.' : response.status === 409 ? 'Newer changes exist on another device.' : 'Unable to sync. Your edits are saved on this device.');
      error.code = response.status;
      throw error;
    }
    return response.json();
  }
  function backup(state) { try { localStorage.setItem(pendingKey, JSON.stringify(state)); } catch { status('Device backup is full. Export your edits before closing.'); } }
  return {
    async start(getState, replaceState) {
      const remote = await request('GET');
      revision = remote.revision;
      if (remote.state) replaceState(remote.state);
      baseline = remote.state ? JSON.stringify(getState()) : '';
      ready = true;
      if (!remote.state) await this.save(getState());
      else status('Synced across devices');
      if (localStorage.getItem(pendingKey)) status('Unsynced backup available. Use Recover Edits before making changes.');
      setInterval(async () => {
        if (!ready || busy || conflict || JSON.stringify(getState()) !== baseline || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) return;
        busy = true;
        try {
          const next = await request('GET');
          if (next.revision !== revision && next.state && JSON.stringify(getState()) === baseline) {
            revision = next.revision;
            replaceState(next.state);
            baseline = JSON.stringify(getState());
            status('Updated from your other device');
          }
        } catch (error) { status(error.message); }
        finally { busy = false; }
      }, 15000);
    },
    async save(state) {
      if (!ready) return;
      const serialized = JSON.stringify(state);
      if (serialized === baseline) return;
      backup(state);
      if (busy || conflict) return;
      busy = true;
      status('Syncing...');
      try {
        const saved = await request('PUT', {state, revision});
        revision = saved.revision;
        baseline = serialized;
        if (localStorage.getItem(pendingKey) === serialized) localStorage.removeItem(pendingKey);
        status('Synced across devices');
      } catch (error) {
        conflict = error.code === 409;
        status(conflict ? 'Another device saved changes. Export your edits, then reload to see the latest version.' : error.message);
      } finally { busy = false; }
    },
    recover() {
      const data = localStorage.getItem(pendingKey);
      if (!data) return status('No unsynced backup on this device.');
      const url = URL.createObjectURL(new Blob([data], {type: 'application/json'}));
      const link = document.createElement('a'); link.href = url; link.download = 'bread-lab-recovered-edits.json'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  };
})();
