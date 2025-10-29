import React, { useMemo, useState } from 'react';

export default function TagEditor({
  tags,
  onChange,
}: {
  tags: string[] | undefined;
  onChange: (next: string[]) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const viewTags = useMemo(() => (tags && tags.length ? tags : []), [tags]);

  const addTags = () => {
    const parts = value.split(',').map((t) => t.trim()).filter(Boolean);
    if (!parts.length) return;
    const set = new Set([...(tags || []), ...parts]);
    onChange([...set]);
    setValue('');
    setEditing(false);
  };

  const removeTag = (t: string) => {
    const next = (tags || []).filter((x) => x !== t);
    onChange(next);
  };

  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {viewTags.map((t) => (
          <span key={t} style={{ background: '#e0f2f1', color: '#00695c', padding: '2px 6px', borderRadius: 10, fontSize: 12 }}>
            {t}
            <button onClick={() => removeTag(t)} style={{ marginLeft: 6, border: 'none', background: 'transparent', cursor: 'pointer' }} title="Remove tag">×</button>
          </span>
        ))}
        {!editing && (
          <button onClick={() => setEditing(true)} style={{ fontSize: 12 }}>+ tags</button>
        )}
      </div>
      {editing && (
        <div style={{ marginTop: 4, display: 'flex', gap: 6 }}>
          <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="comma,separated,tags" style={{ flex: 1 }} />
          <button onClick={addTags}>Add</button>
          <button onClick={() => { setEditing(false); setValue(''); }}>Cancel</button>
        </div>
      )}
    </div>
  );
}

