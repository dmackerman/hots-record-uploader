import './styles.css';

interface ElectronAPI {
  getSettings: () => Promise<{ battletag: string; replayDir: string; autoUpload: boolean }>;
  saveSettings: (s: { battletag: string; replayDir: string; autoUpload: boolean }) => Promise<void>;
  browseReplayDir: () => Promise<string | null>;
  openExternal: (url: string) => Promise<void>;
  onStatusChange: (cb: (status: StatusUpdate) => void) => void;
  uploadNow: () => Promise<void>;
  clearUploadedCache: () => Promise<void>;
  getUserId: () => Promise<string>;
  validateReplayDir: (dir: string) => Promise<{ valid: boolean; count: number }>;
}

interface StatusUpdate {
  state: string;
  uploadProgress: {
    current: number;
    total: number;
    fileName: string;
    gamesAdded: number;
    duplicates: number;
    errors: number;
  } | null;
  lastResult: {
    gamesAdded: number;
    duplicates: number;
    errors: number;
    userId: string | null;
    errorMessage?: string;
  } | null;
  pendingCount: number;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

const api = window.electronAPI;

// DOM elements
const setupView = document.getElementById('setup-view')!;
const statusView = document.getElementById('status-view')!;
const battletagInput = document.getElementById('battletag-input') as HTMLInputElement;
const replayDirInput = document.getElementById('replay-dir-input') as HTMLInputElement;
const autoUploadCheck = document.getElementById('auto-upload-check') as HTMLInputElement;
const browseBtn = document.getElementById('browse-btn')!;
const saveBtn = document.getElementById('save-btn')!;
const stateText = document.getElementById('state-text')!;
const stateDot = document.querySelector('.state-dot') as HTMLElement;
const progressSection = document.getElementById('progress-section')!;
const progressBar = document.getElementById('progress-bar')!;
const progressText = document.getElementById('progress-text')!;
const resultSection = document.getElementById('result-section')!;
const resultText = document.getElementById('result-text')!;
const statsLink = document.getElementById('stats-link')!;
const uploadNowBtn = document.getElementById('upload-now-btn')!;
const settingsBtn = document.getElementById('settings-btn')!;
const clearCacheBtn = document.getElementById('clear-cache-btn')!;

const STATE_LABELS: Record<string, string> = {
  idle: 'Waiting for new replays...',
  gameRunning: 'HoTS is Running',
  cooldown: 'HoTS closed, waiting...',
  scanning: 'Scanning for new replays...',
  uploading: 'Uploading replays...',
};

const STATE_COLORS: Record<string, string> = {
  idle: '#888',
  gameRunning: '#4caf50',
  cooldown: '#ff9800',
  scanning: '#2196f3',
  uploading: '#2196f3',
};

// ── Init ──
async function init() {
  const settings = await api.getSettings();

  if (settings.battletag) {
    battletagInput.value = settings.battletag;
    replayDirInput.value = settings.replayDir;
    autoUploadCheck.checked = settings.autoUpload;
    showStatusView();
  } else {
    showSetupView();
  }

  // Show profile link if userId exists
  const userId = await api.getUserId();
  updateProfileLink(userId);

  // Listen for status updates from main process
  api.onStatusChange((status: StatusUpdate) => {
    updateStatus(status);
  });
}

function showSetupView() {
  setupView.classList.remove('hidden');
  statusView.classList.add('hidden');
}

function showStatusView() {
  setupView.classList.add('hidden');
  statusView.classList.remove('hidden');
}

// ── Event handlers ──
browseBtn.addEventListener('click', async () => {
  const dir = await api.browseReplayDir();
  if (dir) {
    replayDirInput.value = dir;
    const dirWarning = document.getElementById('dir-warning')!;
    const validation = await api.validateReplayDir(dir);
    if (!validation.valid) {
      dirWarning.textContent = 'No .StormReplay files found in this folder.';
      dirWarning.classList.remove('hidden', 'success');
    } else {
      dirWarning.textContent = `Found ${validation.count} replay${validation.count !== 1 ? 's' : ''}.`;
      dirWarning.classList.remove('hidden');
      dirWarning.classList.add('success');
    }
  }
});

saveBtn.addEventListener('click', async () => {
  const battletag = battletagInput.value.trim();
  if (!battletag) {
    battletagInput.focus();
    return;
  }

  const replayDir = replayDirInput.value;

  // Validate replay directory
  const dirWarning = document.getElementById('dir-warning')!;
  if (replayDir) {
    const validation = await api.validateReplayDir(replayDir);
    if (!validation.valid) {
      dirWarning.textContent =
        'No .StormReplay files found in this folder. Are you sure this is your replay directory?';
      dirWarning.classList.remove('hidden');
      // Still allow saving — they might set it up before playing
    } else {
      dirWarning.textContent = `Found ${validation.count} replay${validation.count !== 1 ? 's' : ''} in this folder.`;
      dirWarning.classList.remove('hidden');
      dirWarning.classList.add('success');
      setTimeout(() => {
        dirWarning.classList.add('hidden');
        dirWarning.classList.remove('success');
      }, 3000);
    }
  }

  await api.saveSettings({
    battletag,
    replayDir,
    autoUpload: autoUploadCheck.checked,
  });

  showStatusView();
});

uploadNowBtn.addEventListener('click', () => {
  api.uploadNow();
});

settingsBtn.addEventListener('click', () => {
  showSetupView();
});

clearCacheBtn.addEventListener('click', async () => {
  await api.clearUploadedCache();
  clearCacheBtn.textContent = 'Upload history cleared!';
  setTimeout(() => {
    clearCacheBtn.textContent = 'Clear Upload History';
  }, 2000);
});

statsLink.addEventListener('click', (e) => {
  e.preventDefault();
  const url = statsLink.getAttribute('data-url');
  if (url) {
    api.openExternal(url);
  }
});

document.getElementById('profile-link')!.addEventListener('click', (e) => {
  e.preventDefault();
  const url = (e.currentTarget as HTMLElement).getAttribute('data-url');
  if (url) {
    api.openExternal(url);
  }
});

// ── Status rendering ──
function updateProfileLink(userId: string | null) {
  const profileLink = document.getElementById('profile-link');
  if (!profileLink) return;
  if (userId) {
    profileLink.classList.remove('hidden');
    profileLink.setAttribute('data-url', `https://hots.autrpop.com/u/${userId}/`);
  } else {
    profileLink.classList.add('hidden');
  }
}

function updateStatus(status: StatusUpdate) {
  const label = STATE_LABELS[status.state] || status.state;
  stateText.textContent = label;
  stateDot.style.backgroundColor = STATE_COLORS[status.state] || '#888';

  // Disable Upload Now when nothing pending and not actively uploading
  const btn = uploadNowBtn as HTMLButtonElement;
  if (status.state === 'uploading') {
    btn.disabled = true;
    btn.textContent = 'Uploading…';
  } else if (status.pendingCount === 0) {
    btn.disabled = true;
    btn.textContent = 'No new replays';
  } else {
    btn.disabled = false;
    btn.textContent = `Upload Now (${status.pendingCount})`;
  }

  // Upload progress
  if (status.uploadProgress) {
    progressSection.classList.remove('hidden');
    const { current, total, fileName, gamesAdded, duplicates, errors } = status.uploadProgress;
    const pct = total > 0 ? Math.round((current / total) * 100) : 0;
    progressBar.style.width = `${pct}%`;
    progressText.textContent = `Uploading ${current}/${total}: ${fileName}`;
  } else if (status.state !== 'uploading') {
    progressSection.classList.add('hidden');
  }

  // Last result
  if (status.lastResult) {
    resultSection.classList.remove('hidden');
    const { gamesAdded, duplicates, errors, userId, errorMessage } = status.lastResult;

    if (errorMessage) {
      resultText.textContent = errorMessage;
      resultText.classList.add('error-text');
    } else {
      resultText.classList.remove('error-text');
      const parts: string[] = [];
      if (gamesAdded > 0) parts.push(`${gamesAdded} replay${gamesAdded !== 1 ? 's' : ''} added`);
      if (duplicates > 0) parts.push(`${duplicates} duplicate${duplicates !== 1 ? 's' : ''}`);
      if (errors > 0) parts.push(`${errors} error${errors !== 1 ? 's' : ''}`);
      resultText.textContent = parts.length > 0 ? parts.join(', ') : 'No new replays found';
    }

    if (userId) {
      statsLink.classList.remove('hidden');
      statsLink.setAttribute('data-url', `https://hots.autrpop.com/u/${userId}/`);
      updateProfileLink(userId);
    } else {
      statsLink.classList.add('hidden');
    }
  }
}

init();
