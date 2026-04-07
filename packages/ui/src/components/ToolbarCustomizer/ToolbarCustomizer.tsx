import { useState, useRef, useEffect, useCallback } from 'react';
import {
  type ConfigurableAction,
  ALL_CONFIGURABLE_ACTIONS,
  DEFAULT_TOOLBAR_CONFIG,
  TOOLTIP_DATA,
  ACTION_CATEGORY,
} from '../Toolbar/Toolbar';
import './ToolbarCustomizer.css';

interface ToolbarCustomizerProps {
  config: ConfigurableAction[];
  onUpdate: (config: ConfigurableAction[]) => void;
  onClose: () => void;
}

export function ToolbarCustomizer({ config, onUpdate, onClose }: ToolbarCustomizerProps) {
  const [toolbarItems, setToolbarItems] = useState<ConfigurableAction[]>(config);
  const [dragItem, setDragItem] = useState<{ action: ConfigurableAction; source: 'toolbar' | 'available' } | null>(null);
  const [dropTarget, setDropTarget] = useState<{ index: number; list: 'toolbar' | 'available' } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const availableItems = ALL_CONFIGURABLE_ACTIONS.filter(a => !toolbarItems.includes(a));

  // Sync changes live
  const commit = useCallback((items: ConfigurableAction[]) => {
    setToolbarItems(items);
    onUpdate(items);
  }, [onUpdate]);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // Close on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  const addToToolbar = (action: ConfigurableAction) => {
    commit([...toolbarItems, action]);
  };

  const removeFromToolbar = (action: ConfigurableAction) => {
    commit(toolbarItems.filter(a => a !== action));
  };

  const resetToDefaults = () => {
    commit([...DEFAULT_TOOLBAR_CONFIG]);
  };

  // Drag and drop for reordering within toolbar list
  const handleDragStart = (action: ConfigurableAction, source: 'toolbar' | 'available') => {
    setDragItem({ action, source });
  };

  const handleDragOver = (e: React.DragEvent, index: number, list: 'toolbar' | 'available') => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTarget({ index, list });
  };

  const handleDragLeave = () => {
    setDropTarget(null);
  };

  const handleDrop = (e: React.DragEvent, targetIndex: number, targetList: 'toolbar' | 'available') => {
    e.preventDefault();
    if (!dragItem) return;

    if (dragItem.source === 'available' && targetList === 'toolbar') {
      // Add to toolbar at position
      const newItems = [...toolbarItems];
      newItems.splice(targetIndex, 0, dragItem.action);
      commit(newItems);
    } else if (dragItem.source === 'toolbar' && targetList === 'toolbar') {
      // Reorder within toolbar
      const fromIndex = toolbarItems.indexOf(dragItem.action);
      if (fromIndex === -1) return;
      const newItems = [...toolbarItems];
      newItems.splice(fromIndex, 1);
      const insertAt = targetIndex > fromIndex ? targetIndex - 1 : targetIndex;
      newItems.splice(insertAt, 0, dragItem.action);
      commit(newItems);
    } else if (dragItem.source === 'toolbar' && targetList === 'available') {
      // Remove from toolbar
      removeFromToolbar(dragItem.action);
    }

    setDragItem(null);
    setDropTarget(null);
  };

  const handleDragEnd = () => {
    setDragItem(null);
    setDropTarget(null);
  };

  // Drop zone for "toolbar" list (accepts drops from available)
  const handleToolbarListDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (!dragItem) return;
    if (dragItem.source === 'available') {
      commit([...toolbarItems, dragItem.action]);
    }
    setDragItem(null);
    setDropTarget(null);
  };

  // Drop zone for "available" list (accepts drops from toolbar to remove)
  const handleAvailableListDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (!dragItem) return;
    if (dragItem.source === 'toolbar') {
      removeFromToolbar(dragItem.action);
    }
    setDragItem(null);
    setDropTarget(null);
  };

  return (
    <div className="toolbar-customizer-backdrop">
      <div className="toolbar-customizer" ref={panelRef}>
        <div className="toolbar-customizer-header">
          <span className="toolbar-customizer-title">Customize Toolbar</span>
          <button className="toolbar-customizer-close" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </div>

        <div className="toolbar-customizer-body">
          <div className="toolbar-customizer-column">
            <div className="toolbar-customizer-column-header">
              <span className="toolbar-customizer-column-label">Available</span>
              <span className="toolbar-customizer-column-count">{availableItems.length}</span>
            </div>
            <div
              className={`toolbar-customizer-list${dragItem?.source === 'toolbar' ? ' toolbar-customizer-list--drop-target' : ''}`}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
              onDrop={handleAvailableListDrop}
            >
              {availableItems.length === 0 && (
                <div className="toolbar-customizer-empty">All items are in the toolbar</div>
              )}
              {availableItems.map((action) => (
                <div
                  key={action}
                  className={`toolbar-customizer-item${dragItem?.action === action ? ' toolbar-customizer-item--dragging' : ''}`}
                  draggable
                  onDragStart={() => handleDragStart(action, 'available')}
                  onDragEnd={handleDragEnd}
                >
                  <span className="toolbar-customizer-item-icon">
                    <ActionIcon action={action} />
                  </span>
                  <span className="toolbar-customizer-item-label">
                    {TOOLTIP_DATA[action]?.label ?? action}
                  </span>
                  <span className="toolbar-customizer-item-category">
                    {ACTION_CATEGORY[action]}
                  </span>
                  <button
                    className="toolbar-customizer-item-btn toolbar-customizer-item-add"
                    onClick={() => addToToolbar(action)}
                    title="Add to toolbar"
                  >
                    <PlusIcon />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="toolbar-customizer-column">
            <div className="toolbar-customizer-column-header">
              <span className="toolbar-customizer-column-label">Toolbar</span>
              <span className="toolbar-customizer-column-count">{toolbarItems.length}</span>
            </div>
            <div
              className={`toolbar-customizer-list${dragItem?.source === 'available' ? ' toolbar-customizer-list--drop-target' : ''}`}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
              onDrop={handleToolbarListDrop}
            >
              {toolbarItems.length === 0 && (
                <div className="toolbar-customizer-empty">Drag items here or click +</div>
              )}
              {toolbarItems.map((action, index) => {
                const showDivider = index > 0 && ACTION_CATEGORY[toolbarItems[index - 1]] !== ACTION_CATEGORY[action];
                return (
                  <div key={action}>
                    {showDivider && <div className="toolbar-customizer-group-divider" />}
                    <div
                      className={`toolbar-customizer-item toolbar-customizer-item--toolbar${dragItem?.action === action ? ' toolbar-customizer-item--dragging' : ''}${dropTarget?.list === 'toolbar' && dropTarget.index === index ? ' toolbar-customizer-item--drop-before' : ''}`}
                      draggable
                      onDragStart={() => handleDragStart(action, 'toolbar')}
                      onDragOver={(e) => handleDragOver(e, index, 'toolbar')}
                      onDragLeave={handleDragLeave}
                      onDrop={(e) => handleDrop(e, index, 'toolbar')}
                      onDragEnd={handleDragEnd}
                    >
                      <span className="toolbar-customizer-item-grip">
                        <GripIcon />
                      </span>
                      <span className="toolbar-customizer-item-icon">
                        <ActionIcon action={action} />
                      </span>
                      <span className="toolbar-customizer-item-label">
                        {TOOLTIP_DATA[action]?.label ?? action}
                      </span>
                      <button
                        className="toolbar-customizer-item-btn toolbar-customizer-item-remove"
                        onClick={() => removeFromToolbar(action)}
                        title="Remove from toolbar"
                      >
                        <MinusIcon />
                      </button>
                    </div>
                  </div>
                );
              })}
              {/* Extra drop zone at end */}
              {toolbarItems.length > 0 && (
                <div
                  className={`toolbar-customizer-drop-end${dropTarget?.list === 'toolbar' && dropTarget.index === toolbarItems.length ? ' toolbar-customizer-drop-end--active' : ''}`}
                  onDragOver={(e) => handleDragOver(e, toolbarItems.length, 'toolbar')}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, toolbarItems.length, 'toolbar')}
                />
              )}
            </div>
          </div>
        </div>

        <div className="toolbar-customizer-footer">
          <button className="toolbar-customizer-reset" onClick={resetToDefaults}>
            Reset to Defaults
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Action icon component (renders small preview icons) ---
function ActionIcon({ action }: { action: ConfigurableAction }) {
  switch (action) {
    case 'bold':          return <b style={{ fontSize: 12, fontWeight: 700 }}>B</b>;
    case 'italic':        return <em style={{ fontSize: 12 }}>I</em>;
    case 'strikethrough': return <s style={{ fontSize: 12 }}>S</s>;
    case 'h1':            return <span style={{ fontSize: 10, fontWeight: 700 }}>H1</span>;
    case 'h2':            return <span style={{ fontSize: 10, fontWeight: 700 }}>H2</span>;
    case 'bulletList':    return <BulletIcon />;
    case 'orderedList':   return <span style={{ fontSize: 10, fontWeight: 700 }}>1.</span>;
    case 'taskList':      return <TaskIcon />;
    case 'blockquote':    return <QuoteIcon />;
    case 'link':          return <LinkSmIcon />;
    case 'image':         return <ImgSmIcon />;
    case 'code':          return <CodeSmIcon />;
    case 'table':         return <TableSmIcon />;
    case 'kanban':        return <KanbanSmIcon />;
    case 'mermaid':       return <MermaidSmIcon />;
    case 'gantt':         return <GanttSmIcon />;
    default:              return null;
  }
}

// Small inline SVG icons for the customizer list items
function BulletIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" width="14" height="14">
      <circle cx="3" cy="6" r="1.2" fill="currentColor" stroke="none" />
      <line x1="6" y1="6" x2="14" y2="6" />
      <circle cx="3" cy="10" r="1.2" fill="currentColor" stroke="none" />
      <line x1="6" y1="10" x2="14" y2="10" />
    </svg>
  );
}
function TaskIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
      <rect x="2" y="4" width="4" height="4" rx="0.8" />
      <polyline points="3,6.2 3.8,7 5.3,5" />
      <line x1="8" y1="6" x2="14" y2="6" />
      <rect x="2" y="9.5" width="4" height="4" rx="0.8" />
      <line x1="8" y1="11.5" x2="14" y2="11.5" />
    </svg>
  );
}
function QuoteIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" width="14" height="14">
      <line x1="4" y1="4" x2="4" y2="12" />
      <line x1="7" y1="6.5" x2="13" y2="6.5" />
      <line x1="7" y1="9.5" x2="11" y2="9.5" />
    </svg>
  );
}
function LinkSmIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
      <path d="M6.5 9.5a3.5 3.5 0 0 0 5 0l2-2a3.5 3.5 0 0 0-5-5L7 4" />
      <path d="M9.5 6.5a3.5 3.5 0 0 0-5 0l-2 2a3.5 3.5 0 0 0 5 5L9 12" />
    </svg>
  );
}
function ImgSmIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
      <rect x="2" y="3.5" width="12" height="9" rx="1.5" />
      <circle cx="5.5" cy="7" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}
function CodeSmIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
      <polyline points="5,5 2,8 5,11" />
      <polyline points="11,5 14,8 11,11" />
    </svg>
  );
}
function TableSmIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
      <line x1="1.5" y1="6.5" x2="14.5" y2="6.5" />
      <line x1="6" y1="2.5" x2="6" y2="13.5" />
    </svg>
  );
}
function KanbanSmIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
      <rect x="1.5" y="2.5" width="3.5" height="11" rx="0.8" />
      <rect x="6.25" y="2.5" width="3.5" height="8" rx="0.8" />
      <rect x="11" y="2.5" width="3.5" height="5.5" rx="0.8" />
    </svg>
  );
}
function MermaidSmIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
      <rect x="2" y="2" width="4" height="3" rx="0.8" />
      <rect x="10" y="2" width="4" height="3" rx="0.8" />
      <rect x="6" y="11" width="4" height="3" rx="0.8" />
      <line x1="4" y1="5" x2="4" y2="8" />
      <line x1="12" y1="5" x2="12" y2="8" />
      <line x1="4" y1="8" x2="12" y2="8" />
      <line x1="8" y1="8" x2="8" y2="11" />
    </svg>
  );
}
function GanttSmIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
      <line x1="2" y1="4" x2="9" y2="4" strokeWidth="2.5" />
      <line x1="4" y1="8" x2="12" y2="8" strokeWidth="2.5" />
      <line x1="3" y1="12" x2="7" y2="12" strokeWidth="2.5" />
    </svg>
  );
}

// UI icons
function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" width="14" height="14">
      <line x1="4" y1="4" x2="12" y2="12" />
      <line x1="12" y1="4" x2="4" y2="12" />
    </svg>
  );
}
function PlusIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="12" height="12">
      <line x1="8" y1="3" x2="8" y2="13" />
      <line x1="3" y1="8" x2="13" y2="8" />
    </svg>
  );
}
function MinusIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="12" height="12">
      <line x1="3" y1="8" x2="13" y2="8" />
    </svg>
  );
}
function GripIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" width="10" height="10">
      <circle cx="5" cy="4" r="1.2" />
      <circle cx="11" cy="4" r="1.2" />
      <circle cx="5" cy="8" r="1.2" />
      <circle cx="11" cy="8" r="1.2" />
      <circle cx="5" cy="12" r="1.2" />
      <circle cx="11" cy="12" r="1.2" />
    </svg>
  );
}
