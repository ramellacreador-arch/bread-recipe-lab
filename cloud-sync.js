window.breadCloud = (() => {
  let revision = 0, baseline = '', ready = false, busy = false, conflict = false;
  let pendingState = null;
  const pendingKey = 'bread-lab-unsynced-backup';
  const status = (message) => { const node = document.querySelector('#save-status'); if (node) node.textContent = message; };
  const recoveryButton = () => document.querySelector('#recover-edits');
  const showRecovery = (available) => {
    const button = recoveryButton();
    if (button) button.hidden = !available;
  };
  async function request(method, data) {
    const response = await fetch('/api/workspace', {method, cache: 'no-store', credentials: 'same-origin', headers: {'Content-Type': 'application/json'}, ...(data ? {body: JSON.stringify(data)} : {})});
    if (!response.ok) {
      const error = new Error(response.status === 401 ? 'Sign in again to sync.' : response.status === 409 ? 'Newer changes exist on another device.' : 'Unable to sync. Your edits are saved on this device.');
      error.code = response.status;
      throw error;
    }
    return response.json();
  }
  function backup(state) {
    try {
      localStorage.setItem(pendingKey, JSON.stringify(state));
      showRecovery(true);
    } catch {
      status('Device backup is full. Unsynced edits may be lost if you close this page.');
    }
  }
  async function flushPending() {
    if (!ready || busy || conflict) return;
    busy = true;
    try {
      while (pendingState && !conflict) {
        const current = pendingState;
        pendingState = null;
        status('Syncing...');
        try {
          const saved = await request('PUT', {state: current.state, revision});
          revision = saved.revision;
          baseline = current.serialized;
          if (localStorage.getItem(pendingKey) === current.serialized) {
            localStorage.removeItem(pendingKey);
            showRecovery(false);
          }
        } catch (error) {
          pendingState = pendingState || current;
          conflict = error.code === 409;
          status(conflict
            ? 'Another device saved changes. Download your unsynced edits before reloading.'
            : error.message);
          showRecovery(true);
          break;
        }
      }
      if (!pendingState && !conflict) status('Synced across devices');
    } finally {
      busy = false;
    }
  }
  return {
    async start(getState, replaceState) {
      const remote = await request('GET');
      revision = remote.revision;
      if (remote.state) replaceState(remote.state);
      baseline = remote.state ? JSON.stringify(getState()) : '';
      ready = true;
      if (!remote.state) await this.save(getState());
      else status('Synced across devices');
      if (localStorage.getItem(pendingKey)) {
        status('Unsynced edits are available. Download them before continuing.');
        showRecovery(true);
      }
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
      if (serialized === baseline && !pendingState) return;
      backup(state);
      pendingState = {state, serialized};
      await flushPending();
    },
    recover() {
      const data = localStorage.getItem(pendingKey);
      if (!data) {
        showRecovery(false);
        status('No unsynced edits are available to recover.');
        return;
      }
      const url = URL.createObjectURL(new Blob([data], {type: 'application/json'}));
      const link = document.createElement('a'); link.href = url; link.download = 'bread-lab-recovered-edits.json'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      status('Unsynced edits downloaded.');
    }
  };
})();
