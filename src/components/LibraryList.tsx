import React from 'react';
import type { Asset, Category } from '../state/models';
import { Draggable } from 'react-beautiful-dnd';
import TagEditor from './TagEditor';

export default function LibraryList({
  assets,
  categories,
  onChangeTags,
  onChangeCategory,
}: {
  assets: Asset[];
  onChangeTags: (assetId: string, tags: string[]) => void;
  categories: Category[];
  onChangeCategory: (assetId: string, categoryId: string | undefined) => void;
}) {
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
              <div>{asset.name}</div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', margin: '4px 0' }}>
                <label style={{ fontSize: 12 }}>Category</label>
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
