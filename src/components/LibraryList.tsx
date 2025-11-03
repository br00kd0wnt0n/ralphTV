import React, { useState } from 'react';
import type { Asset, Category } from '../state/models';
import { Draggable } from 'react-beautiful-dnd';
import TagEditor from './TagEditor';

export default function LibraryList({
  assets,
  categories,
  onChangeTags,
  onChangeCategory,
  onChangeName,
}: {
  assets: Asset[];
  onChangeTags: (assetId: string, tags: string[]) => void;
  categories: Category[];
  onChangeCategory: (assetId: string, categoryId: string | undefined) => void;
  onChangeName?: (assetId: string, name: string) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const handleStartEdit = (asset: Asset) => {
    setEditingId(asset.id);
    setEditValue(asset.name);
  };

  const handleSaveName = (assetId: string) => {
    if (editValue.trim() && onChangeName) {
      onChangeName(assetId, editValue.trim());
    }
    setEditingId(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent, assetId: string) => {
    if (e.key === 'Enter') {
      handleSaveName(assetId);
    } else if (e.key === 'Escape') {
      setEditingId(null);
    }
  };
  return (
    <>
      {assets.map((asset, index) => (
        <Draggable key={asset.id} draggableId={`asset-${asset.id}`} index={index}>
          {(provided) => (
            <div
              ref={provided.innerRef}
              {...provided.draggableProps}
              {...provided.dragHandleProps}
              className={`content-item ${asset.type}`}
              title={asset.name}
            >
              {editingId === asset.id ? (
                <input
                  type="text"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={() => handleSaveName(asset.id)}
                  onKeyDown={(e) => handleKeyDown(e, asset.id)}
                  autoFocus
                  style={{ fontSize: 10, padding: 2, width: '100%', marginBottom: 4 }}
                />
              ) : (
                <div
                  onClick={() => handleStartEdit(asset)}
                  style={{ cursor: 'text', marginBottom: 4 }}
                  title="Click to edit name"
                >
                  {asset.name}
                </div>
              )}
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', margin: '4px 0' }}>
                <label style={{ fontSize: 12 }}>Category</label>
                {(() => { const c = categories.find(x => x.id === asset.categoryId); return c ? <span title={c.name} style={{ width: 10, height: 10, borderRadius: '50%', background: c.color, display: 'inline-block' }} /> : null; })()}
                <select
                  value={asset.categoryId || ''}
                  onChange={(e) => onChangeCategory(asset.id, e.target.value || undefined)}
                  style={{ fontSize: 12 }}
                >
                  <option value="">—</option>
                  {categories.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <TagEditor
                tags={asset.tags || []}
                onChange={(next) => onChangeTags(asset.id, next)}
              />
            </div>
          )}
        </Draggable>
      ))}
    </>
  );
}
