import { Folder } from 'lucide-react';

interface SaveFolderPickerProps {
  value: string;
  onChoose: () => void;
}

export function SaveFolderPicker({ value, onChoose }: SaveFolderPickerProps) {
  return (
    <section className="save-picker">
      <label>Save to</label>
      <div>
        <input value={value || 'Choose a folder'} readOnly />
        <button onClick={onChoose} title="Choose folder">
          <Folder size={18} />
          Choose
        </button>
      </div>
    </section>
  );
}
