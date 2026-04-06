import { useState, useRef, useEffect, useCallback } from 'react';
import type { GanttData, GanttSection, GanttTask } from '@pennivo/core';
import { generateTaskId } from '@pennivo/core';
import './GanttEditorPanel.css';

interface GanttEditorPanelProps {
  data: GanttData;
  anchorRect: { top: number; left: number; width: number };
  onUpdate: (data: GanttData) => void;
  onClose: () => void;
}

export function GanttEditorPanel({
  data,
  anchorRect,
  onUpdate,
  onClose,
}: GanttEditorPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  // Focus title on mount
  useEffect(() => {
    const t = setTimeout(() => titleRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, []);

  // Close on outside click
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [onClose]);

  // Escape to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // --- Helpers to produce updated GanttData ---

  const updateData = useCallback(
    (updater: (d: GanttData) => GanttData) => {
      onUpdate(updater(data));
    },
    [data, onUpdate],
  );

  const getAllTaskIds = useCallback((): Set<string> => {
    const ids = new Set<string>();
    for (const s of data.sections) {
      for (const t of s.tasks) {
        if (t.id) ids.add(t.id);
      }
    }
    return ids;
  }, [data]);

  const setTitle = useCallback(
    (title: string) => updateData(d => ({ ...d, title })),
    [updateData],
  );

  const setExcludes = useCallback(
    (excludes: string) =>
      updateData(d => ({ ...d, excludes: excludes || undefined })),
    [updateData],
  );

  const updateSection = useCallback(
    (sIdx: number, updater: (s: GanttSection) => GanttSection) =>
      updateData(d => ({
        ...d,
        sections: d.sections.map((s, i) => (i === sIdx ? updater(s) : s)),
      })),
    [updateData],
  );

  const updateTask = useCallback(
    (sIdx: number, tIdx: number, updater: (t: GanttTask) => GanttTask) =>
      updateSection(sIdx, s => ({
        ...s,
        tasks: s.tasks.map((t, i) => (i === tIdx ? updater(t) : t)),
      })),
    [updateSection],
  );

  const addSection = useCallback(() => {
    updateData(d => ({
      ...d,
      sections: [
        ...d.sections,
        {
          title: `Section ${d.sections.length + 1}`,
          tasks: [{ id: generateTaskId(getAllTaskIds()), title: 'New task', duration: '5d' }],
        },
      ],
    }));
  }, [updateData, getAllTaskIds]);

  const removeSection = useCallback(
    (sIdx: number) =>
      updateData(d => ({
        ...d,
        sections: d.sections.filter((_, i) => i !== sIdx),
      })),
    [updateData],
  );

  const addTask = useCallback(
    (sIdx: number) =>
      updateSection(sIdx, s => ({
        ...s,
        tasks: [
          ...s.tasks,
          { id: generateTaskId(getAllTaskIds()), title: 'New task', duration: '5d' },
        ],
      })),
    [updateSection, getAllTaskIds],
  );

  const removeTask = useCallback(
    (sIdx: number, tIdx: number) =>
      updateSection(sIdx, s => ({
        ...s,
        tasks: s.tasks.filter((_, i) => i !== tIdx),
      })),
    [updateSection],
  );

  // Collapsed sections
  const [collapsedSections, setCollapsedSections] = useState<Set<number>>(new Set());
  const toggleSection = useCallback((idx: number) => {
    setCollapsedSections(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  // Build list of all task IDs for dependency picker
  const allTasks = data.sections.flatMap(s => s.tasks);

  // Position the panel — clamp to viewport
  const style: React.CSSProperties = (() => {
    const panelWidth = 480;
    const panelMaxHeight = Math.min(window.innerHeight - 100, 560);
    let top = anchorRect.top + 8;
    let left = anchorRect.left;

    // Clamp right edge
    if (left + panelWidth > window.innerWidth - 16) {
      left = window.innerWidth - panelWidth - 16;
    }
    // Clamp left edge
    if (left < 16) left = 16;

    // If too low, flip above
    if (top + panelMaxHeight > window.innerHeight - 16) {
      top = Math.max(16, anchorRect.top - panelMaxHeight - 8);
    }

    return { top, left, maxHeight: panelMaxHeight };
  })();

  return (
    <div className="gantt-editor" ref={panelRef} style={style}>
      {/* Header */}
      <div className="gantt-editor-header">
        <span className="gantt-editor-label">Gantt Chart</span>
        <button className="gantt-editor-close" onClick={onClose} title="Close">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="4" y1="4" x2="12" y2="12" /><line x1="12" y1="4" x2="4" y2="12" />
          </svg>
        </button>
      </div>

      {/* Title + Settings */}
      <div className="gantt-editor-row">
        <input
          ref={titleRef}
          className="gantt-input gantt-input--title"
          type="text"
          placeholder="Chart title"
          value={data.title}
          onChange={e => setTitle(e.target.value)}
        />
      </div>
      <div className="gantt-editor-row gantt-editor-settings">
        <label className="gantt-checkbox">
          <input
            type="checkbox"
            checked={data.excludes === 'weekends'}
            onChange={e => setExcludes(e.target.checked ? 'weekends' : '')}
          />
          <span>Exclude weekends</span>
        </label>
      </div>

      {/* Sections */}
      <div className="gantt-editor-sections">
        {data.sections.map((section, sIdx) => (
          <div key={sIdx} className="gantt-section">
            <div className="gantt-section-header">
              <button
                className="gantt-section-toggle"
                onClick={() => toggleSection(sIdx)}
              >
                <svg
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  style={{ transform: collapsedSections.has(sIdx) ? 'rotate(-90deg)' : undefined }}
                >
                  <polyline points="4,6 8,10 12,6" />
                </svg>
              </button>
              <input
                className="gantt-input gantt-input--section"
                type="text"
                value={section.title}
                onChange={e => updateSection(sIdx, s => ({ ...s, title: e.target.value }))}
                placeholder="Section title"
              />
              {data.sections.length > 1 && (
                <button
                  className="gantt-remove-btn"
                  onClick={() => removeSection(sIdx)}
                  title="Remove section"
                >
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <line x1="4" y1="4" x2="12" y2="12" /><line x1="12" y1="4" x2="4" y2="12" />
                  </svg>
                </button>
              )}
            </div>

            {!collapsedSections.has(sIdx) && (
              <div className="gantt-task-list">
                {/* Column headers */}
                <div className="gantt-task-headers">
                  <span>Task</span>
                  <span>Start / After</span>
                  <span>Duration</span>
                  <span>Status</span>
                  <span></span>
                </div>

                {section.tasks.map((task, tIdx) => (
                  <div key={task.id || tIdx} className="gantt-task-row">
                    <input
                      className="gantt-input"
                      type="text"
                      value={task.title}
                      onChange={e =>
                        updateTask(sIdx, tIdx, t => ({ ...t, title: e.target.value }))
                      }
                      placeholder="Task name"
                    />

                    {/* Start date or "after" dependency */}
                    <div className="gantt-task-start">
                      {task.afterDeps && task.afterDeps.length > 0 ? (
                        <select
                          className="gantt-select"
                          value={task.afterDeps[0]}
                          onChange={e => {
                            const dep = e.target.value;
                            if (dep === '__date__') {
                              updateTask(sIdx, tIdx, t => ({
                                ...t,
                                afterDeps: undefined,
                                startDate: new Date().toISOString().slice(0, 10),
                              }));
                            } else {
                              updateTask(sIdx, tIdx, t => ({
                                ...t,
                                afterDeps: [dep],
                                startDate: undefined,
                              }));
                            }
                          }}
                        >
                          {allTasks
                            .filter(at => at.id !== task.id)
                            .map(at => (
                              <option key={at.id} value={at.id}>
                                After: {at.title || at.id}
                              </option>
                            ))}
                          <option value="__date__">Use date...</option>
                        </select>
                      ) : (
                        <div className="gantt-start-group">
                          <input
                            className="gantt-input gantt-input--date"
                            type="date"
                            value={task.startDate || ''}
                            onChange={e =>
                              updateTask(sIdx, tIdx, t => ({
                                ...t,
                                startDate: e.target.value,
                              }))
                            }
                          />
                          {allTasks.filter(at => at.id !== task.id).length > 0 && (
                            <button
                              className="gantt-dep-btn"
                              title="Use dependency instead"
                              onClick={() => {
                                const firstOther = allTasks.find(at => at.id !== task.id);
                                if (firstOther) {
                                  updateTask(sIdx, tIdx, t => ({
                                    ...t,
                                    afterDeps: [firstOther.id],
                                    startDate: undefined,
                                  }));
                                }
                              }}
                            >
                              dep
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    <input
                      className="gantt-input gantt-input--duration"
                      type="text"
                      value={task.duration || ''}
                      onChange={e => {
                        const dur = e.target.value;
                        updateTask(sIdx, tIdx, t => ({
                          ...t,
                          duration: dur,
                          // Auto-set milestone when duration is 0 or 0d
                          status: (dur === '0d' || dur === '0') ? 'milestone'
                            : t.status === 'milestone' ? undefined
                            : t.status,
                        }));
                      }}
                      placeholder="5d"
                    />

                    <select
                      className="gantt-select gantt-select--status"
                      value={task.status || ''}
                      onChange={e => {
                        const status = (e.target.value || undefined) as GanttTask['status'];
                        updateTask(sIdx, tIdx, t => ({
                          ...t,
                          status,
                          // Auto-set 0d duration for milestones
                          duration: status === 'milestone' ? '0d' : (t.duration === '0d' ? '5d' : t.duration),
                        }));
                      }}
                    >
                      <option value="">Normal</option>
                      <option value="active">Active</option>
                      <option value="done">Done</option>
                      <option value="crit">Critical</option>
                      <option value="milestone">Milestone</option>
                    </select>

                    <button
                      className="gantt-remove-btn"
                      onClick={() => removeTask(sIdx, tIdx)}
                      title="Remove task"
                    >
                      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                        <line x1="4" y1="4" x2="12" y2="12" /><line x1="12" y1="4" x2="4" y2="12" />
                      </svg>
                    </button>
                  </div>
                ))}

                <button className="gantt-add-btn" onClick={() => addTask(sIdx)}>
                  + Add task
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="gantt-editor-footer">
        <button className="gantt-add-btn" onClick={addSection}>
          + Add section
        </button>
        <span className="gantt-editor-hint">Changes update the chart live</span>
      </div>
    </div>
  );
}
