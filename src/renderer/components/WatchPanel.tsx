import { useState } from 'react';
import { Eye, FolderOpen, Pause, Play, Plus, RefreshCw, Trash2 } from 'lucide-react';
import type { WatchOutputType, WatchSubscription, WatchSubscriptionInput } from '../../shared/media';

interface WatchPanelProps {
  watches: WatchSubscription[];
  saveFolder?: string;
  onAddWatch: (input: WatchSubscriptionInput) => Promise<void>;
  onUpdateWatch: (id: string, patch: { enabled?: boolean }) => void;
  onRemoveWatch: (id: string) => void;
  onSyncWatch: (id: string) => void;
  onOpenPath: (path: string) => void;
  onChooseFolder: () => Promise<string | null>;
}

const watchFormats: WatchOutputType[] = ['mp4', 'mp3', 'm4a', 'wav'];
const watchIntervals = [
  { minutes: 15, label: 'Every 15 minutes' },
  { minutes: 30, label: 'Every 30 minutes' },
  { minutes: 60, label: 'Every hour' },
  { minutes: 180, label: 'Every 3 hours' },
  { minutes: 360, label: 'Every 6 hours' },
  { minutes: 1440, label: 'Daily' }
];

export function WatchPanel({
  watches,
  saveFolder,
  onAddWatch,
  onUpdateWatch,
  onRemoveWatch,
  onSyncWatch,
  onOpenPath,
  onChooseFolder
}: WatchPanelProps) {
  const [watchUrl, setWatchUrl] = useState('');
  const [watchFormat, setWatchFormat] = useState<WatchOutputType>('mp4');
  const [watchInterval, setWatchInterval] = useState(60);
  const [watchFolder, setWatchFolder] = useState('');
  const [watchError, setWatchError] = useState('');

  async function addWatch() {
    setWatchError('');
    const folder = watchFolder || saveFolder || '';
    try {
      await onAddWatch({
        url: watchUrl,
        outputType: watchFormat,
        outputPath: folder,
        intervalMinutes: watchInterval
      });
      setWatchUrl('');
      setWatchFolder('');
    } catch (caught) {
      setWatchError(
        caught instanceof Error
          ? caught.message.replace(/^Error invoking remote method '[^']+':\s*/, '')
          : 'Could not add the watch.'
      );
    }
  }

  return (
    <section className="workspace single-column">
      <div className="settings-panel">
        <div className="panel-heading">
          <Eye size={22} />
          <div>
            <h2>Watch folders</h2>
            <p>
              Automatically download anything new from a channel, playlist, or profile into a folder. The first sync
              grabs the 3 most recent items; later syncs only fetch what is new.
            </p>
          </div>
        </div>

        {watches.length === 0 && <p className="hint">No watch folders yet. Add one below.</p>}

        {watches.map((watch) => (
          <div key={watch.id} className="history-entry">
            <div className="history-entry-main">
              <span className={`history-status ${watch.enabled ? (watch.syncing ? 'downloading' : 'finished') : 'cancelled'}`}>
                {watch.syncing ? 'Syncing' : watch.enabled ? 'Watching' : 'Paused'}
              </span>
              <div className="history-entry-text">
                <strong>{watch.label}</strong>
                <span className="history-entry-url" title={watch.url}>
                  {watch.url}
                </span>
                <span className="hint">
                  {watch.outputType.toUpperCase()} · {intervalLabel(watch.intervalMinutes)} · {watch.outputPath}
                  {watch.lastCheckedAt
                    ? ` · Last check ${new Date(watch.lastCheckedAt).toLocaleString()} (${watch.lastResult ?? 'done'})`
                    : ' · Not checked yet'}
                </span>
              </div>
            </div>
            <div className="history-entry-actions">
              <button className="icon-button" title="Sync now" onClick={() => onSyncWatch(watch.id)} disabled={Boolean(watch.syncing)}>
                <RefreshCw size={16} />
              </button>
              <button
                className="icon-button"
                title={watch.enabled ? 'Pause' : 'Resume'}
                onClick={() => onUpdateWatch(watch.id, { enabled: !watch.enabled })}
              >
                {watch.enabled ? <Pause size={16} /> : <Play size={16} />}
              </button>
              <button className="icon-button" title="Open folder" onClick={() => onOpenPath(watch.outputPath)}>
                <FolderOpen size={16} />
              </button>
              <button className="icon-button" title="Remove watch" onClick={() => onRemoveWatch(watch.id)}>
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}

        <div className="watch-add-form">
          <label className="field-label">
            Channel, playlist, or profile URL
            <input
              value={watchUrl}
              onChange={(event) => setWatchUrl(event.target.value)}
              placeholder="https://www.youtube.com/@channel/videos"
            />
          </label>
          <div className="settings-grid">
            <label>
              Format
              <select value={watchFormat} onChange={(event) => setWatchFormat(event.target.value as WatchOutputType)}>
                {watchFormats.map((format) => (
                  <option key={format} value={format}>
                    {format.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Check
              <select value={watchInterval} onChange={(event) => setWatchInterval(Number(event.target.value))}>
                {watchIntervals.map((interval) => (
                  <option key={interval.minutes} value={interval.minutes}>
                    {interval.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="field-label">
            Folder
            <input value={watchFolder || saveFolder || ''} readOnly placeholder="Choose a folder" />
          </label>
          <div className="action-row">
            <button
              className="secondary-button"
              onClick={() => {
                void onChooseFolder().then((folder) => {
                  if (folder) {
                    setWatchFolder(folder);
                  }
                });
              }}
            >
              <FolderOpen size={16} />
              Choose folder
            </button>
            <button className="primary-button" onClick={() => void addWatch()} disabled={!watchUrl.trim()}>
              <Plus size={16} />
              Add watch
            </button>
          </div>
          {watchError && <p className="hint history-error">{watchError}</p>}
        </div>
      </div>
    </section>
  );
}

function intervalLabel(minutes: number): string {
  return watchIntervals.find((interval) => interval.minutes === minutes)?.label ?? `Every ${minutes} min`;
}
