import React, { useMemo, useState } from 'react';
import type { Category } from '../state/models';
import { makeId } from '../state/schedule';

export default function CategoryManager({
  categories,
  onCreate,
  onUpdate,
  onDelete,
}: {
  categories: Category[];
  onCreate: (name: string, color: string) => void;
  onUpdate: (id: string, patch: Partial<Category>) => void;
  onDelete: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [color, setColor] = useState('#8e8e8e');
  const existingNames = useMemo(() => new Set(categories.map(c => c.name.toLowerCase())), [categories]);

  const add = () => {
    const n = name.trim();
    if (!n || existingNames.has(n.toLowerCase())) return;
    onCreate(n, color);
    setName('');
  };

  const update = (id: string, patch: Partial<Category>) => {
    onUpdate(id, patch);
  };

  const remove = (id: string) => onDelete(id);

  return (
    <div>
      <h3>Categories</h3>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8, padding: 8 }}>
        <input placeholder="New category" value={name} onChange={e => setName(e.target.value)} style={{ flex: 1, fontSize: 10 }} />
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ width: 40 }} />
        <button className="win95-button" onClick={add} style={{ padding: '2px 8px', fontSize: 10 }}>Add</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 8 }}>
        {categories.map(c => (
          <div key={c.id} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <div style={{ width: 12, height: 12, borderRadius: 2, background: c.color, border: '1px solid rgba(0,0,0,0.3)', flexShrink: 0 }} />
            <input value={c.name} onChange={e => update(c.id, { name: e.target.value })} style={{ flex: 1, fontSize: 10 }} />
            <input type="color" value={c.color} onChange={e => update(c.id, { color: e.target.value })} style={{ width: 40 }} />
            <button className="win95-button" onClick={() => remove(c.id)} title="Delete" style={{ padding: '2px 6px', fontSize: 10, minWidth: 24 }}>✕</button>
          </div>
        ))}
      </div>
    </div>
  );
}
