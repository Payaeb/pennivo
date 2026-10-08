// Breadcrumb bar shown above the editor pane while zoomed into a bullet
// (Phase 18a). crumb[0] is always "Home" (exits zoom fully); each ancestor
// crumb zooms out partially to that ancestor; the current zoomed item is
// last and non-clickable. Long paths middle-ellipsize: Home, an ellipsis,
// then only the last few ancestors — the zoomed item and its immediate
// parent are what's worth keeping visible (see docs/outliner-task-lists-
// design.md, Phase 18a "Breadcrumb bar").
import "./ZoomBreadcrumb.css";

export interface ZoomBreadcrumbCrumb {
  pos: number;
  text: string;
}

export interface ZoomBreadcrumbProps {
  /** Root-first ancestors of the zoomed item, NOT including the item
   *  itself. */
  ancestors: ZoomBreadcrumbCrumb[];
  /** The zoomed item's own text (last crumb, non-clickable). */
  current: string;
  onHome: () => void;
  onAncestorClick: (pos: number) => void;
}

const MAX_VISIBLE_ANCESTORS = 3;
const CRUMB_TEXT_MAX = 40;

function truncate(text: string, max: number): string {
  const trimmed = text.trim();
  if (!trimmed) return "Untitled";
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max - 1).trimEnd() + "…";
}

export function ZoomBreadcrumb({
  ancestors,
  current,
  onHome,
  onAncestorClick,
}: ZoomBreadcrumbProps) {
  const ellipsized = ancestors.length > MAX_VISIBLE_ANCESTORS;
  const visible = ellipsized
    ? ancestors.slice(ancestors.length - MAX_VISIBLE_ANCESTORS)
    : ancestors;

  return (
    <nav className="zoom-breadcrumb" aria-label="Zoom breadcrumb">
      <button
        type="button"
        className="zoom-breadcrumb__crumb zoom-breadcrumb__home"
        onClick={onHome}
      >
        Home
      </button>
      {ellipsized && (
        <>
          <span className="zoom-breadcrumb__sep" aria-hidden="true">
            /
          </span>
          <span className="zoom-breadcrumb__ellipsis" aria-hidden="true">
            &hellip;
          </span>
        </>
      )}
      {visible.map((crumb) => (
        <span key={crumb.pos} className="zoom-breadcrumb__group">
          <span className="zoom-breadcrumb__sep" aria-hidden="true">
            /
          </span>
          <button
            type="button"
            className="zoom-breadcrumb__crumb"
            onClick={() => onAncestorClick(crumb.pos)}
            title={crumb.text.trim() || "Untitled"}
          >
            {truncate(crumb.text, CRUMB_TEXT_MAX)}
          </button>
        </span>
      ))}
      <span className="zoom-breadcrumb__sep" aria-hidden="true">
        /
      </span>
      <span
        className="zoom-breadcrumb__crumb zoom-breadcrumb__current"
        title={current.trim() || "Untitled"}
      >
        {truncate(current, CRUMB_TEXT_MAX)}
      </span>
    </nav>
  );
}
