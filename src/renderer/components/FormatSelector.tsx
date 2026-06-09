import { useState } from 'react';
import { Captions, FileAudio, FileText, Film, Music2, Subtitles, Video } from 'lucide-react';
import type { OutputType } from '../../shared/media';

interface FormatSelectorProps {
  value: OutputType[];
  onChange: (value: OutputType[]) => void;
}

type FormatGroup = 'video' | 'audio' | 'transcript';

const groups: Array<{ id: FormatGroup; label: string; icon: typeof Film }> = [
  { id: 'video', label: 'Video', icon: Video },
  { id: 'audio', label: 'Audio', icon: Music2 },
  { id: 'transcript', label: 'Transcript', icon: FileText }
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

export function FormatSelector({ value, onChange }: FormatSelectorProps) {
  const [activeGroup, setActiveGroup] = useState<FormatGroup>('video');

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
              {selectedCount > 0 && <small>{selectedCount}</small>}
            </button>
          );
        })}
      </div>
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
    </fieldset>
  );
}
