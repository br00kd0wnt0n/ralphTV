import React from 'react';
import { Droppable } from 'react-beautiful-dnd';
import type { Asset, Category } from '../state/models';
import LibraryList from './LibraryList';
import { updateAssetTags, setAssetCategory } from '../api/assets';
import { CONFIG } from '../config';

export default function LibraryPanel({
  assets,
  categories,
  setAssets,
}: {
  assets: Asset[];
  categories: Category[];
  setAssets: (updater: (prev: Asset[]) => Asset[]) => void;
}) {
  const apiEnabled = !!CONFIG.API_BASE_URL;
  return (
    <Droppable droppableId="library">
      {(provided) => (
        <div className="uploaded-content" ref={provided.innerRef} {...provided.droppableProps}>
          <h3>Uploaded Content</h3>
          <div>
            {assets.length === 0 && (
              <div style={{ padding: '12px 0', fontSize: 10, color: 'black', textAlign: 'center', fontStyle: 'italic' }}>
                No assets yet. Upload files above to get started!
              </div>
            )}
            <LibraryList
              assets={assets}
              categories={categories}
              onChangeTags={(assetId, tags) => {
                setAssets((prev) => prev.map((a) => (a.id === assetId ? { ...a, tags } : a)));
                if (apiEnabled) updateAssetTags({ assetId, tags }).catch(() => {});
              }}
              onChangeCategory={(assetId, categoryId) => {
                setAssets((prev) => prev.map((a) => (a.id === assetId ? { ...a, categoryId } : a)));
                if (apiEnabled) setAssetCategory({ assetId, categoryId }).catch(() => {});
              }}
            />
          </div>
          {provided.placeholder}
        </div>
      )}
    </Droppable>
  );
}

