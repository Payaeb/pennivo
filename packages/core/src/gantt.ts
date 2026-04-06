// --- Gantt Chart Data Model ---

export interface GanttTask {
  id: string;
  title: string;
  status?: 'done' | 'active' | 'crit' | 'milestone';
  startDate?: string;       // "YYYY-MM-DD" or empty for auto
  duration?: string;        // e.g. "3d", "2w"
  afterDeps?: string[];     // task IDs this depends on (uses "after")
}

export interface GanttSection {
  title: string;
  tasks: GanttTask[];
}

export interface GanttData {
  title: string;
  dateFormat: string;
  axisFormat?: string;
  excludes?: string;
  sections: GanttSection[];
}

// --- ID Generation ---

export function generateTaskId(existingIds: Set<string>): string {
  let counter = 1;
  while (existingIds.has(`t${counter}`)) counter++;
  return `t${counter}`;
}

// --- Default Data ---

export function createDefaultGanttData(): GanttData {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const todayStr = `${yyyy}-${mm}-${dd}`;

  return {
    title: 'Project Schedule',
    dateFormat: 'YYYY-MM-DD',
    sections: [
      {
        title: 'Phase 1',
        tasks: [
          { id: 't1', title: 'Task A', startDate: todayStr, duration: '7d' },
          { id: 't2', title: 'Task B', afterDeps: ['t1'], duration: '5d' },
        ],
      },
    ],
  };
}

// --- Parser: mermaid gantt text → GanttData ---

export function parseMermaidGantt(code: string): GanttData | null {
  const lines = code.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  // Must start with "gantt"
  if (lines.length === 0 || lines[0] !== 'gantt') return null;

  const data: GanttData = {
    title: '',
    dateFormat: 'YYYY-MM-DD',
    sections: [],
  };

  let currentSection: GanttSection | null = null;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];

    // Metadata directives
    const titleMatch = line.match(/^title\s+(.+)/);
    if (titleMatch) { data.title = titleMatch[1].trim(); continue; }

    const dateFormatMatch = line.match(/^dateFormat\s+(.+)/);
    if (dateFormatMatch) { data.dateFormat = dateFormatMatch[1].trim(); continue; }

    const axisFormatMatch = line.match(/^axisFormat\s+(.+)/);
    if (axisFormatMatch) { data.axisFormat = axisFormatMatch[1].trim(); continue; }

    const excludesMatch = line.match(/^excludes\s+(.+)/);
    if (excludesMatch) { data.excludes = excludesMatch[1].trim(); continue; }

    // Section
    const sectionMatch = line.match(/^section\s+(.+)/);
    if (sectionMatch) {
      currentSection = { title: sectionMatch[1].trim(), tasks: [] };
      data.sections.push(currentSection);
      continue;
    }

    // Task line: "Task Name :id, status, after dep1, startDate, duration"
    // or simpler forms like "Task Name :startDate, duration"
    const taskMatch = line.match(/^(.+?)\s*:(.+)$/);
    if (taskMatch) {
      // Ensure we have a section
      if (!currentSection) {
        currentSection = { title: 'Tasks', tasks: [] };
        data.sections.push(currentSection);
      }

      const title = taskMatch[1].trim();
      const parts = taskMatch[2].split(',').map(p => p.trim());
      const task = parseTaskParts(title, parts);
      currentSection.tasks.push(task);
    }
  }

  // If no sections found at all, return null (not a valid gantt)
  if (data.sections.length === 0) return null;

  return data;
}

function parseTaskParts(title: string, parts: string[]): GanttTask {
  const task: GanttTask = { id: '', title };

  const afterDeps: string[] = [];
  let assignedId = '';
  let foundDate = false;

  for (const part of parts) {
    // Status keywords
    if (part === 'done' || part === 'active' || part === 'crit' || part === 'milestone') {
      task.status = part;
      continue;
    }

    // "after" dependency
    const afterMatch = part.match(/^after\s+(.+)/);
    if (afterMatch) {
      afterDeps.push(...afterMatch[1].trim().split(/\s+/));
      continue;
    }

    // Date: matches YYYY-MM-DD pattern
    if (/^\d{4}-\d{2}-\d{2}$/.test(part)) {
      task.startDate = part;
      foundDate = true;
      continue;
    }

    // Duration: matches Nd, Nw, Nh pattern
    if (/^\d+[dwh]$/.test(part)) {
      task.duration = part;
      continue;
    }

    // Otherwise it might be a task ID (alphanumeric, no spaces)
    if (/^[a-zA-Z_]\w*$/.test(part) && !foundDate) {
      assignedId = part;
      continue;
    }
  }

  if (afterDeps.length > 0) task.afterDeps = afterDeps;
  task.id = assignedId || generateTaskId(new Set());

  return task;
}

// --- Serializer: GanttData → mermaid gantt text ---

export function ganttDataToMermaid(data: GanttData): string {
  const lines: string[] = ['gantt'];

  if (data.title) lines.push(`    title ${data.title}`);
  lines.push(`    dateFormat ${data.dateFormat}`);
  if (data.axisFormat) lines.push(`    axisFormat ${data.axisFormat}`);
  if (data.excludes) lines.push(`    excludes ${data.excludes}`);

  for (const section of data.sections) {
    lines.push(`    section ${section.title}`);

    for (const task of section.tasks) {
      const parts: string[] = [];

      // Task ID
      if (task.id) parts.push(task.id);

      // Status
      if (task.status) parts.push(task.status);

      // Dependencies
      if (task.afterDeps && task.afterDeps.length > 0) {
        parts.push(`after ${task.afterDeps.join(' ')}`);
      }

      // Start date
      if (task.startDate) parts.push(task.startDate);

      // Duration
      if (task.duration) parts.push(task.duration);

      const taskTitle = task.title || 'Untitled task';
      lines.push(`    ${taskTitle} :${parts.join(', ')}`);
    }
  }

  return lines.join('\n');
}
