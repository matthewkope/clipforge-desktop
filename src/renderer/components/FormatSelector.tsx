import { useEffect, useState } from 'react';
import { Bookmark, Captions, FileAudio, FileText, Film, Music2, Save, Subtitles, Trash2, Video } from 'lucide-react';
import type { FormatPreset, OutputType } from '../../shared/media';

interface FormatSelectorProps {
  value: OutputType[];
  onChange: (value: OutputType[]) => void;
  onPresetsChange?: (presets: FormatPreset[]) => void;
  activePresetId?: string;
}

type FormatGroup = 'video' | 'audio' | 'transcript' | 'presets';

const groups: Array<{ id: FormatGroup; label: string; icon: typeof Film }> = [
  { id: 'video', label: 'Video', icon: Video },
  { id: 'audio', label: 'Audio', icon: Music2 },
  { id: 'transcript', label: 'Transcript', icon: FileText },
  { id: 'presets', label: 'Presets', icon: Bookmark }
];

const formats: Array<{ value: OutputType; group: FormatGroup; label: string; detail: string; icon: typeof Film }> = [
  { value: 'mp4', group: 'video', label: 'MP4', detail: 'Universal video', icon: Film },
  { value: 'webm', group: 'video', label: 'WEBM', detail: 'Web optimized', icon: Video },
  { value: 'mp3', group: 'audio', label: 'MP3', detail: 'Compact audio', icon: Music2 },
  { value: 'wav', group: 'audio', label: 'WAV', detail: 'Lossless audio', icon: FileAudio },
  { value: 'm4a', group: 'audio', label: 'M4A', detail: 'High quality audio', icon: FileAudio },
  { value: 'subtitles', group: 'transcript', label: 'SRT Captions', detail: 'Existing captions', icon: Captions },
  { value: 'timed-transcript', group: 'transcript', label: 'Timed', detail: 'Transcript with timestamps', icon: Subtitles },
  { value: 'markdown', group: 'transcript', label: 'Markdown', detail: 'Clean text transcript', icon: FileText }
];

const presetStorageKey = 'clipforge.formatPresets';
const maxPresets = 3;
const maxCustomPresets = maxPresets - 1;
const defaultPresetId = 'clipforge-default';
const defaultPresetFormats: OutputType[] = ['mp4', 'mp3', 'markdown'];
const outputTypes = new Set<OutputType>(formats.map((format) => format.value));

export function FormatSelector({ value, onChange, onPresetsChange, activePresetId }: FormatSelectorProps) {
  const [activeGroup, setActiveGroup] = useState<FormatGroup>('video');
  const [presets, setPresets] = useState<FormatPreset[]>(loadPresets);
  const [presetName, setPresetName] = useState('');

  useEffect(() => {
    onPresetsChange?.(presets);
  }, [onPresetsChange, presets]);

  function savePresets(next: FormatPreset[]) {
    const normalized = normalizePresets(next);
    setPresets(normalized);
    window.localStorage.setItem(presetStorageKey, JSON.stringify(normalized));
  }

  function createPreset() {
    const name = presetName.trim();
    if (!name || customPresetCount(presets) >= maxCustomPresets) {
      return;
    }

    savePresets([
      ...presets,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        formats: [...value]
      }
    ]);
    setPresetName('');
  }

  function renamePreset(id: string, name: string) {
    const trimmedName = name.trim();
    if (!trimmedName) {
      return;
    }
    savePresets(presets.map((preset) => (preset.id === id ? { ...preset, name: trimmedName } : preset)));
  }

  function updatePreset(id: string) {
    savePresets(presets.map((preset) => (preset.id === id ? { ...preset, formats: [...value] } : preset)));
  }

  function deletePreset(id: string) {
    if (id === defaultPresetId) {
      return;
    }
    savePresets(presets.filter((preset) => preset.id !== id));
  }

  function toggle(format: OutputType) {
    if (value.includes(format)) {
      const next = value.filter((item) => item !== format);
      onChange(next.length ? next : ['mp4']);
      return;
    }

    onChange([...value, format]);
  }

  return (
    <fieldset className="format-selector">
      <legend>Formats</legend>
      <div className="format-tabs" role="tablist" aria-label="Format categories">
        {groups.map((group) => {
          const GroupIcon = group.icon;
          const selectedCount = formats.filter((format) => format.group === group.id && value.includes(format.value)).length;
          return (
            <button
              key={group.id}
              type="button"
              role="tab"
              aria-selected={activeGroup === group.id}
              className={activeGroup === group.id ? 'selected' : ''}
              onClick={() => setActiveGroup(group.id)}
            >
              <GroupIcon size={21} />
              <span>{group.label}</span>
              {group.id !== 'presets' && selectedCount > 0 && <small>{selectedCount}</small>}
            </button>
          );
        })}
      </div>
      {activeGroup === 'presets' ? (
        <div className="preset-panel" role="tabpanel">
          {presets.map((preset) => (
            <article className={`preset-card ${activePresetId === preset.id ? 'selected' : ''}`} key={preset.id}>
              <input
                className="preset-name"
                defaultValue={preset.name}
                aria-label={`Rename ${preset.name}`}
                onBlur={(event) => {
                  renamePreset(preset.id, event.target.value);
                  event.target.value = event.target.value.trim() || preset.name;
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.currentTarget.blur();
                  }
                }}
              />
              <small>{formatNames(preset.formats)}</small>
              <div className="preset-actions">
                <button type="button" className="preset-apply" onClick={() => onChange([...preset.formats])}>
                  Apply
                </button>
                <button type="button" title="Replace this preset with the current format selection" onClick={() => updatePreset(preset.id)}>
                  <Save size={15} />
                  Update
                </button>
                {preset.id !== defaultPresetId && (
                  <button type="button" className="preset-delete" title={`Delete ${preset.name}`} aria-label={`Delete ${preset.name}`} onClick={() => deletePreset(preset.id)}>
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </article>
          ))}

          {customPresetCount(presets) < maxCustomPresets ? (
            <div className="preset-create">
              <input
                value={presetName}
                maxLength={32}
                placeholder={`Name preset ${customPresetCount(presets) + 2}`}
                aria-label="Preset name"
                onChange={(event) => setPresetName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    createPreset();
                  }
                }}
              />
              <button type="button" onClick={createPreset} disabled={!presetName.trim()}>
                <Bookmark size={16} />
                Save current
              </button>
            </div>
          ) : (
            <p className="preset-limit">The Default preset and both custom preset slots are in use. Delete a custom preset to save another.</p>
          )}
        </div>
      ) : (
        <div className="format-options" role="tabpanel">
          {formats
            .filter((format) => format.group === activeGroup)
            .map((format) => {
              const FormatIcon = format.icon;
              const isSelected = value.includes(format.value);
              return (
                <label key={format.value} className={isSelected ? 'selected' : ''}>
                  <input type="checkbox" value={format.value} checked={isSelected} onChange={() => toggle(format.value)} />
                  <span className="format-option-icon"><FormatIcon size={20} /></span>
                  <span>{format.label}</span>
                  <small>{format.detail}</small>
                </label>
              );
            })}
        </div>
      )}
    </fieldset>
  );
}

function loadPresets(): FormatPreset[] {
  try {
    const stored = JSON.parse(window.localStorage.getItem(presetStorageKey) ?? '[]') as unknown;
    if (!Array.isArray(stored)) {
      return [createDefaultPreset()];
    }

    const normalized = normalizePresets(stored.filter(isFormatPreset));
    window.localStorage.setItem(presetStorageKey, JSON.stringify(normalized));
    return normalized;
  } catch {
    return [createDefaultPreset()];
  }
}

function normalizePresets(values: FormatPreset[]): FormatPreset[] {
  const valid = values
    .filter(isFormatPreset)
    .map((preset) => ({ ...preset, formats: preset.formats.filter((format) => outputTypes.has(format)) }))
    .filter((preset) => preset.formats.length > 0);
  const storedDefault = valid.find((preset) => preset.id === defaultPresetId);
  const legacyDefault = storedDefault ? undefined : valid.find((preset) => preset.name.trim().toLowerCase() === 'default');
  const defaultPreset = storedDefault
    ? { ...storedDefault }
    : legacyDefault
      ? { ...legacyDefault, id: defaultPresetId, formats: [...defaultPresetFormats] }
      : createDefaultPreset();
  const customPresets = valid
    .filter((preset) => preset.id !== defaultPresetId && preset !== legacyDefault)
    .slice(0, maxCustomPresets);

  return [defaultPreset, ...customPresets];
}

function createDefaultPreset(): FormatPreset {
  return {
    id: defaultPresetId,
    name: 'Default',
    formats: [...defaultPresetFormats]
  };
}

function customPresetCount(values: FormatPreset[]): number {
  return values.filter((preset) => preset.id !== defaultPresetId).length;
}

function isFormatPreset(value: unknown): value is FormatPreset {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const preset = value as Partial<FormatPreset>;
  return (
    typeof preset.id === 'string' &&
    typeof preset.name === 'string' &&
    preset.name.trim().length > 0 &&
    Array.isArray(preset.formats) &&
    preset.formats.length > 0 &&
    preset.formats.every((format) => typeof format === 'string' && outputTypes.has(format as OutputType))
  );
}

function formatNames(values: OutputType[]): string {
  return values
    .map((value) => formats.find((format) => format.value === value)?.label ?? value)
    .join(' + ');
}
