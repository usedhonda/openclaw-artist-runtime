import { Fragment } from "react";

export interface BreadcrumbSegment {
  label: string;
  onClick?: () => void;
}

export interface BreadcrumbProps {
  segments: BreadcrumbSegment[];
}

export function Breadcrumb({ segments }: BreadcrumbProps) {
  return (
    <nav className="song-detail-breadcrumb" aria-label="Breadcrumb">
      {segments.map((seg, idx) => (
        <Fragment key={`${idx}:${seg.label}`}>
          {seg.onClick ? (
            <button type="button" className="song-detail-breadcrumb-link" onClick={seg.onClick}>
              {seg.label}
            </button>
          ) : (
            <span className="song-detail-breadcrumb-current">{seg.label}</span>
          )}
          {idx < segments.length - 1 ? <span aria-hidden className="song-detail-breadcrumb-sep"> / </span> : null}
        </Fragment>
      ))}
    </nav>
  );
}
