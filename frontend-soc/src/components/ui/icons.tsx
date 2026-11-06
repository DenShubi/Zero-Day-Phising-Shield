import type { SVGProps } from 'react';
import type { Verdict } from '@/lib/verdict';

export interface IconProps extends SVGProps<SVGSVGElement> {
  size?: number;
}

function baseProps(size: number, props: IconProps) {
  const { className, ...rest } = props;
  return {
    width: size,
    height: size,
    viewBox: '0 0 20 20',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.65,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true as const,
    className: className ? `shrink-0 ${className}` : 'shrink-0',
    ...rest,
  };
}

/**
 * Custom geometric product mark for VisiKartika Shield.
 * Faceted shield silhouette + precision optical reticle — zero initials, zero emoji.
 */
export function VisiKartikaMark({ size = 26, className, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 28 28"
      fill="none"
      aria-hidden="true"
      className={className ? `shrink-0 ${className}` : 'shrink-0'}
      {...rest}
    >
      {/* Left dark prism facet */}
      <path
        d="M14 2.5L4.5 6.5V13.6C4.5 19.55 8.52 24.18 14 25.75V2.5Z"
        fill="var(--surface-3)"
      />
      {/* Right Cobalt Azure prism facet */}
      <path
        d="M14 2.5L23.5 6.5V13.6C23.5 19.55 19.48 24.18 14 25.75V2.5Z"
        fill="var(--accent)"
        fillOpacity="0.32"
      />
      {/* Crisp outer shield contour */}
      <path
        d="M14 2.5L23.5 6.5V13.6C23.5 19.55 19.48 24.18 14 25.75C8.52 24.18 4.5 19.55 4.5 13.6V6.5L14 2.5Z"
        stroke="var(--accent-ink)"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      {/* Inner optical diamond reticle */}
      <path
        d="M14 8.2L18.6 13.4L14 18.6L9.4 13.4L14 8.2Z"
        fill="var(--canvas)"
        stroke="var(--foreground)"
        strokeWidth="1.45"
        strokeLinejoin="round"
      />
      <circle cx="14" cy="13.4" r="1.6" fill="var(--accent-ink)" />
    </svg>
  );
}

/* ---------------------------- Navigation Icons ---------------------------- */

export function IconCommand({ size = 18, ...props }: IconProps) {
  return (
    <svg {...baseProps(size, props)}>
      <rect x="2.5" y="2.5" width="6.5" height="6.5" rx="1.5" />
      <rect x="11" y="2.5" width="6.5" height="4.2" rx="1.2" />
      <rect x="11" y="8.8" width="6.5" height="8.7" rx="1.5" />
      <rect x="2.5" y="11" width="6.5" height="6.5" rx="1.5" />
    </svg>
  );
}

export function IconScan({ size = 18, ...props }: IconProps) {
  return (
    <svg {...baseProps(size, props)}>
      <path d="M3 6.5V4.5A1.5 1.5 0 0 1 4.5 3h2" />
      <path d="M13.5 3h2A1.5 1.5 0 0 1 17 4.5v2" />
      <path d="M17 13.5v2a1.5 1.5 0 0 1-1.5 1.5h-2" />
      <path d="M6.5 17h-2A1.5 1.5 0 0 1 3 15.5v-2" />
      <circle cx="10" cy="10" r="3.2" />
      <path d="M2.5 10h2.3M15.2 10h2.3" />
    </svg>
  );
}

export function IconForensics({ size = 18, ...props }: IconProps) {
  return (
    <svg {...baseProps(size, props)}>
      <rect x="2.5" y="3" width="15" height="14" rx="2" />
      <rect x="5.5" y="6" width="5.5" height="4.5" rx="0.8" />
      <path d="M13 6.5h2M13 9.5h2M5.5 13.5h9" />
    </svg>
  );
}

export function IconAudit({ size = 18, ...props }: IconProps) {
  return (
    <svg {...baseProps(size, props)}>
      <rect x="3" y="3" width="14" height="14" rx="2" />
      <path d="M10 3v14M3 10h14" />
      <path d="M5.4 6.6l1.1 1.1 2-2" />
      <path d="M12.4 13.6l1.1 1.1 2-2" />
    </svg>
  );
}

export function IconMitigation({ size = 18, ...props }: IconProps) {
  return (
    <svg {...baseProps(size, props)}>
      <path d="M10 2.3L16.5 5v4.8c0 4.2-2.75 7.35-6.5 8.4-3.75-1.05-6.5-4.2-6.5-8.4V5L10 2.3Z" />
      <path d="M7.4 7.4l5.2 5.2M12.6 7.4l-5.2 5.2" />
    </svg>
  );
}

export function IconWhatsapp({ size = 18, ...props }: IconProps) {
  return (
    <svg {...baseProps(size, props)}>
      <path d="M10 2.6a7.1 7.1 0 0 0-6.15 10.65L3 17l3.9-.82A7.1 7.1 0 1 0 10 2.6Z" />
      <path d="M8.1 7.5c.2-.4.45-.4.65-.4h.45c.2 0 .4.1.48.35l.55 1.35c.08.2.04.4-.1.56l-.42.45a5.1 5.1 0 0 0 2.15 2.15l.45-.42c.16-.14.36-.18.56-.1l1.35.55c.25.08.35.28.35.48v.45c0 .2 0 .45-.4.65-.45.22-1.35.35-2.65-.25a8.6 8.6 0 0 1-3.67-3.67c-.6-1.3-.47-2.2-.25-2.65Z" />
    </svg>
  );
}

/* ----------------------------- Verdict Icons ------------------------------ */

export function IconShieldCheck({ size = 15, ...props }: IconProps) {
  return (
    <svg {...baseProps(size, props)}>
      <path d="M10 2.2L16.4 4.8v4.8c0 4.15-2.7 7.25-6.4 8.3-3.7-1.05-6.4-4.15-6.4-8.3V4.8L10 2.2Z" />
      <path d="M7.3 10.1l1.85 1.85L13 8.1" />
    </svg>
  );
}

export function IconAlertTriangle({ size = 15, ...props }: IconProps) {
  return (
    <svg {...baseProps(size, props)}>
      <path d="M8.85 3.6a1.32 1.32 0 0 1 2.3 0l6.1 10.75A1.32 1.32 0 0 1 16.1 16.3H3.9a1.32 1.32 0 0 1-1.15-1.95L8.85 3.6Z" />
      <path d="M10 8v3.6" />
      <circle cx="10" cy="13.8" r="0.65" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconOctagonAlert({ size = 15, ...props }: IconProps) {
  return (
    <svg {...baseProps(size, props)}>
      <path d="M6.8 2.5h6.4l4.3 4.3v6.4l-4.3 4.3H6.8l-4.3-4.3V6.8l4.3-4.3Z" />
      <path d="M10 6.6v4.1" />
      <circle cx="10" cy="13.5" r="0.7" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function VerdictIcon({ verdict, size = 15, className }: { verdict: Verdict; size?: number; className?: string }) {
  if (verdict === 'SAFE') return <IconShieldCheck size={size} className={className} />;
  if (verdict === 'SUSPICIOUS') return <IconAlertTriangle size={size} className={className} />;
  return <IconOctagonAlert size={size} className={className} />;
}

/* ----------------------------- Action / UI Icons -------------------------- */

export function IconSidebarCollapse({ size = 16, ...props }: IconProps) {
  return (
    <svg {...baseProps(size, props)}>
      <rect x="2.5" y="3" width="15" height="14" rx="2" />
      <path d="M8 3v14M12.5 8l-2 2 2 2" />
    </svg>
  );
}

export function IconSidebarExpand({ size = 16, ...props }: IconProps) {
  return (
    <svg {...baseProps(size, props)}>
      <rect x="2.5" y="3" width="15" height="14" rx="2" />
      <path d="M8 3v14M11 8l2 2-2 2" />
    </svg>
  );
}

export function IconMenu({ size = 18, ...props }: IconProps) {
  return (
    <svg {...baseProps(size, props)}>
      <path d="M3 5.5h14M3 10h14M3 14.5h14" />
    </svg>
  );
}

export function IconClose({ size = 16, ...props }: IconProps) {
  return (
    <svg {...baseProps(size, props)}>
      <path d="M5 5l10 10M15 5L5 15" />
    </svg>
  );
}

export function IconRefresh({ size = 15, ...props }: IconProps) {
  return (
    <svg {...baseProps(size, props)}>
      <path d="M16.5 4.5v4h-4" />
      <path d="M16.2 8.5A6.5 6.5 0 1 0 16.5 11" />
    </svg>
  );
}

export function IconPrint({ size = 15, ...props }: IconProps) {
  return (
    <svg {...baseProps(size, props)}>
      <path d="M6 6.5V3h8v3.5" />
      <rect x="3" y="6.5" width="14" height="7" rx="1.5" />
      <rect x="6" y="11.5" width="8" height="5.5" rx="0.8" fill="var(--surface-1)" />
    </svg>
  );
}

export function IconLockDefang({ size = 15, ...props }: IconProps) {
  return (
    <svg {...baseProps(size, props)}>
      <rect x="4" y="9" width="12" height="8" rx="1.8" />
      <path d="M6.8 9V6.4a3.2 3.2 0 0 1 6.4 0V9" />
    </svg>
  );
}

export function IconUpload({ size = 18, ...props }: IconProps) {
  return (
    <svg {...baseProps(size, props)}>
      <path d="M10 13V4.2M6.8 7.4L10 4.2l3.2 3.2" />
      <path d="M3.5 13.5v2A1.5 1.5 0 0 0 5 17h10a1.5 1.5 0 0 0 1.5-1.5v-2" />
    </svg>
  );
}

export function IconPaperclip({ size = 17, ...props }: IconProps) {
  return (
    <svg {...baseProps(size, props)}>
      <path d="M15.2 9.4l-5.6 5.6a3.6 3.6 0 0 1-5.1-5.1l6-6a2.4 2.4 0 0 1 3.4 3.4l-5.8 5.8a1.2 1.2 0 0 1-1.7-1.7l5.1-5.1" />
    </svg>
  );
}

export function IconSend({ size = 16, ...props }: IconProps) {
  return (
    <svg {...baseProps(size, props)}>
      <path d="M17.2 2.8L9.2 10.8" />
      <path d="M17.2 2.8l-5 14.4-3-6.4-6.4-3 14.4-5Z" />
    </svg>
  );
}

export function IconDownload({ size = 15, ...props }: IconProps) {
  return (
    <svg {...baseProps(size, props)}>
      <path d="M10 3.2V12.5M6.8 9.3L10 12.5l3.2-3.2" />
      <path d="M3.5 14v1.8A1.2 1.2 0 0 0 4.7 17h10.6a1.2 1.2 0 0 0 1.2-1.2V14" />
    </svg>
  );
}

export function IconCopy({ size = 15, ...props }: IconProps) {
  return (
    <svg {...baseProps(size, props)}>
      <rect x="7" y="7" width="9.5" height="9.5" rx="1.5" />
      <path d="M13 7V4.8A1.3 1.3 0 0 0 11.7 3.5H4.8A1.3 1.3 0 0 0 3.5 4.8v6.9A1.3 1.3 0 0 0 4.8 13H7" />
    </svg>
  );
}

export function IconCheck({ size = 15, ...props }: IconProps) {
  return (
    <svg {...baseProps(size, props)}>
      <path d="M4 10.5l4 4L16 6" />
    </svg>
  );
}

export function IconArrowRight({ size = 15, ...props }: IconProps) {
  return (
    <svg {...baseProps(size, props)}>
      <path d="M4 10h12M11.5 5.5L16 10l-4.5 4.5" />
    </svg>
  );
}

export function IconSearch({ size = 15, ...props }: IconProps) {
  return (
    <svg {...baseProps(size, props)}>
      <circle cx="9" cy="9" r="5.5" />
      <path d="M13.2 13.2L17 17" />
    </svg>
  );
}

export function IconSliders({ size = 15, ...props }: IconProps) {
  return (
    <svg {...baseProps(size, props)}>
      <path d="M3 6h14M3 14h14" />
      <circle cx="7.5" cy="6" r="2" fill="var(--surface-1)" />
      <circle cx="12.5" cy="14" r="2" fill="var(--surface-1)" />
    </svg>
  );
}

export function IconSplitDiff({ size = 15, ...props }: IconProps) {
  return (
    <svg {...baseProps(size, props)}>
      <rect x="2.5" y="3.5" width="15" height="13" rx="1.8" />
      <path d="M10 2.5v15" />
      <path d="M7.5 8.5L6 10l1.5 1.5M12.5 8.5L14 10l-1.5 1.5" />
    </svg>
  );
}

export function IconPipeline({ size = 16, ...props }: IconProps) {
  return (
    <svg {...baseProps(size, props)}>
      <circle cx="4.5" cy="10" r="2" />
      <circle cx="10" cy="5" r="2" />
      <circle cx="10" cy="15" r="2" />
      <circle cx="15.5" cy="10" r="2" />
      <path d="M6.2 8.8L8.3 6.2M6.2 11.2l2.1 2.6M11.7 6.2l2.1 2.6M11.7 13.8l2.1-2.6" />
    </svg>
  );
}
