import { Folder } from 'lucide-react';

interface SaveFolderPickerProps {
  value: string;
  onChoose: () => void;
  onClear?: () => void;
  label?: string;
  placeholder?: string;
}

export function SaveFolderPicker({ value, onChoose, onClear, label = 'Save to', placeholder = 'Choose a folder' }: SaveFolderPickerProps) {
  return (
    <section className="save-picker">
      <label>{label}</label>
      <div>
        <input value={value || placeholder} readOnly />
        <button onClick={onChoose} title="Choose folder">
          <Folder size={18} />
          Choose
        </button>
        {onClear && value && (
          <button className="secondary-button" onClick={onClear} title="Use default folder">
            Default
          </button>
        )}
      </div>
    </section>
  );
}
