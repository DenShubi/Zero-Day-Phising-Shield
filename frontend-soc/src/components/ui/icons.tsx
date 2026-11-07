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
    strokeWidth: 1.6,
    strokeLinecap: 'square' as const,
    strokeLinejoin: 'miter' as const,
    'aria-hidden': true as const,
    className: className ? `shrink-0 ${className}` : 'shrink-0',
    ...rest,
  };
}

/**
 * Orthogonal reticle-shield mark for VisiKartika Shield.
 * Crisp monochrome frame + single Mineral Petrol optical crosshair point.
 */
export function VisiKartikaMark({ size = 24, className, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className ? `shrink-0 ${className}` : 'shrink-0'}
      {...rest}
    >
      <path
        d="M12 2.25L20.5 5.6V12.2C20.5 17.15 16.95 20.65 12 22C7.05 20.65 3.5 17.15 3.5 12.2V5.6L12 2.25Z"
        fill="var(--surface-2)"
        stroke="var(--foreground)"
        strokeWidth="1.5"
      />
      <path
        d="M8.25 11.75H15.75M12 8V15.5"
        stroke="var(--muted)"
        strokeWidth="1.2"
      />
      <rect
        x="9.5"
        y="9.25"
        width="5"
        height="5"
        stroke="var(--foreground)"
        strokeWidth="1.35"
        fill="var(--surface-1)"
      />
      <rect x="11.1" y="10.85" width="1.8" height="1.8" fill="var(--accent-ink)" />
    </svg>
  );
}

/* ---------------------------- Navigation Icons ---------------------------- */

export function IconCommand({ size = 17, ...props }: IconProps) {
  return (
    <svg {...baseProps(size, props)}>
      <rect x="2.5" y="3" width="15" height="14" />
      <path d="M2.5 7.5h15M8 7.5V17" />
    </svg>
  );
}

export function IconScan({ size = 17, ...props }: IconProps) {
  return (
    <svg {...baseProps(size, props)}>
      <path d="M3 6.5V3h3.5M13.5 3H17v3.5M17 13.5V17h-3.5M6.5 17H3v-3.5" />
      <rect x="7.2" y="7.2" width="5.6" height="5.6" />
      <path d="M2.5 10h2.5M15 10h2.5" />
    </svg>
  );
}

export function IconForensics({ size = 17, ...props }: IconProps) {
  return (
    <svg {...baseProps(size, props)}>
      <rect x="2.5" y="3" width="15" height="14" />
      <rect x="5.2" y="5.8" width="5.6" height="4.6" />
      <path d="M13 6.5h2.2M13 9.5h2.2M5.2 13.5h10" />
    </svg>
  );
}

export function IconAudit({ size = 17, ...props }: IconProps) {
  return (
    <svg {...baseProps(size, props)}>
      <rect x="3" y="3" width="14" height="14" />
      <path d="M10 3v14M3 10h14" />
      <path d="M5.2 6.6l1.2 1.2 2.1-2.1M12.2 13.6l1.2 1.2 2.1-2.1" />
    </svg>
  );
}

export function IconMitigation({ size = 17, ...props }: IconProps) {
  return (
    <svg {...baseProps(size, props)}>
      <path d="M10 2.3L16.5 5v4.8c0 4.2-2.75 7.35-6.5 8.4-3.75-1.05-6.5-4.2-6.5-8.4V5L10 2.3Z" />
      <path d="M7.5 7.5l5 5M12.5 7.5l-5 5" />
    </svg>
  );
}

export function IconWhatsapp({ size = 17, ...props }: IconProps) {
  return (
    <svg {...baseProps(size, props)}>
      <path d="M3 3.5h14v10H7l-4 3v-13Z" />
      <path d="M6.5 7.2h7M6.5 10h4.5" />
    </svg>
  );
}

/* ----------------------------- Verdict Icons ------------------------------ */

export function IconShieldCheck({ size = 14, ...props }: IconProps) {
  return (
    <svg {...baseProps(size, props)}>
      <path d="M10 2.2L16.4 4.8v4.8c0 4.15-2.7 7.25-6.4 8.3-3.7-1.05-6.4-4.15-6.4-8.3V4.8L10 2.2Z" />
      <path d="M7.2 10.1l1.9 1.9L13.1 8" />
    </svg>
  );
}

export function IconAlertTriangle({ size = 14, ...props }: IconProps) {
  return (
    <svg {...baseProps(size, props)}>
      <path d="M10 3.2L17 16H3L10 3.2Z" />
      <path d="M10 8v3.6" />
      <rect x="9.3" y="13.2" width="1.4" height="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconOctagonAlert({ size = 14, ...props }: IconProps) {
  return (
    <svg {...baseProps(size, props)}>
      <path d="M6.8 2.5h6.4l4.3 4.3v6.4l-4.3 4.3H6.8l-4.3-4.3V6.8l4.3-4.3Z" />
      <path d="M10 6.4v4.3" />
      <rect x="9.3" y="12.8" width="1.4" height="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function VerdictIcon({
  verdict,
  size = 14,
  className,
}: {
  verdict: Verdict;
  size?: number;
  className?: string;
}) {
  if (verdict === 'SAFE') return <IconShieldCheck size={size} className={className} />;
  if (verdict === 'SUSPICIOUS') return <IconAlertTriangle size={size} className={className} />;
  return <IconOctagonAlert size={size} className={className} />;
}

/* ----------------------------- Theme & Shell Icons ------------------------ */

export function IconSun({ size = 15, ...props }: IconProps) {
  return (
    <svg {...baseProps(size, props)}>
      <circle cx="10" cy="10" r="3.4" />
      <path d="M10 2.4v2M10 15.6v2M2.4 10h2M15.6 10h2M4.6 4.6l1.4 1.4M14 14l1.4 1.4M15.4 4.6L14 6M6 14l-1.4 1.4" />
    </svg>
  );
}

export function IconMoon({ size = 15, ...props }: IconProps) {
  return (
    <svg {...baseProps(size, props)}>
      <path d="M15.6 12.4A6.2 6.2 0 0 1 7.6 4.4a6.2 6.2 0 1 0 8 8Z" />
    </svg>
  );
}

export function IconSidebarCollapse({ size = 15, ...props }: IconProps) {
  return (
    <svg {...baseProps(size, props)}>
      <rect x="2.5" y="3" width="15" height="14" />
      <path d="M8 3v14M12.6 8l-2 2 2 2" />
    </svg>
  );
}

export function IconSidebarExpand({ size = 15, ...props }: IconProps) {
  return (
    <svg {...baseProps(size, props)}>
      <rect x="2.5" y="3" width="15" height="14" />
      <path d="M8 3v14M11 8l2 2-2 2" />
    </svg>
  );
}

export function IconMenu({ size = 17, ...props }: IconProps) {
  return (
    <svg {...baseProps(size, props)}>
      <path d="M3 5.5h14M3 10h14M3 14.5h14" />
    </svg>
  );
}

export function IconClose({ size = 15, ...props }: IconProps) {
  return (
    <svg {...baseProps(size, props)}>
      <path d="M5 5l10 10M15 5L5 15" />
    </svg>
  );
}

export function IconRefresh({ size = 14, ...props }: IconProps) {
  return (
    <svg {...baseProps(size, props)}>
      <path d="M16.5 4.5v4h-4" />
      <path d="M16.2 8.5A6.5 6.5 0 1 0 16.5 11" />
    </svg>
  );
}

export function IconPrint({ size = 14, ...props }: IconProps) {
  return (
    <svg {...baseProps(size, props)}>
      <path d="M6 6.5V3h8v3.5" />
      <rect x="3" y="6.5" width="14" height="7" />
      <rect x="6" y="11.5" width="8" height="5.5" fill="var(--surface-1)" />
    </svg>
  );
}

export function IconLockDefang({ size = 14, ...props }: IconProps) {
  return (
    <svg {...baseProps(size, props)}>
      <rect x="4" y="9" width="12" height="8" />
      <path d="M6.8 9V6.4a3.2 3.2 0 0 1 6.4 0V9" />
    </svg>
  );
}

export function IconUpload({ size = 16, ...props }: IconProps) {
  return (
    <svg {...baseProps(size, props)}>
      <path d="M10 13V4.2M6.8 7.4L10 4.2l3.2 3.2" />
      <path d="M3.5 13.5V17h13v-3.5" />
    </svg>
  );
}

export function IconPaperclip({ size = 16, ...props }: IconProps) {
  return (
    <svg {...baseProps(size, props)}>
      <path d="M15.2 9.4l-5.6 5.6a3.6 3.6 0 0 1-5.1-5.1l6-6a2.4 2.4 0 0 1 3.4 3.4l-5.8 5.8a1.2 1.2 0 0 1-1.7-1.7l5.1-5.1" />
    </svg>
  );
}

export function IconSend({ size = 15, ...props }: IconProps) {
  return (
    <svg {...baseProps(size, props)}>
      <path d="M17.2 2.8L9.2 10.8" />
      <path d="M17.2 2.8l-5 14.4-3-6.4-6.4-3 14.4-5Z" />
    </svg>
  );
}

export function IconDownload({ size = 14, ...props }: IconProps) {
  return (
    <svg {...baseProps(size, props)}>
      <path d="M10 3.2V12.5M6.8 9.3L10 12.5l3.2-3.2" />
      <path d="M3.5 14V17h13v-3" />
    </svg>
  );
}

export function IconCopy({ size = 14, ...props }: IconProps) {
  return (
    <svg {...baseProps(size, props)}>
      <rect x="7" y="7" width="9.5" height="9.5" />
      <path d="M13 7V3.5H3.5V13H7" />
    </svg>
  );
}

export function IconCheck({ size = 14, ...props }: IconProps) {
  return (
    <svg {...baseProps(size, props)}>
      <path d="M4 10.5l4 4L16 6" />
    </svg>
  );
}

export function IconArrowRight({ size = 14, ...props }: IconProps) {
  return (
    <svg {...baseProps(size, props)}>
      <path d="M4 10h12M11.5 5.5L16 10l-4.5 4.5" />
    </svg>
  );
}

export function IconSearch({ size = 14, ...props }: IconProps) {
  return (
    <svg {...baseProps(size, props)}>
      <circle cx="9" cy="9" r="5.5" />
      <path d="M13.2 13.2L17 17" />
    </svg>
  );
}

export function IconSliders({ size = 14, ...props }: IconProps) {
  return (
    <svg {...baseProps(size, props)}>
      <path d="M3 6h14M3 14h14" />
      <rect x="6" y="4.3" width="3.4" height="3.4" fill="var(--surface-1)" />
      <rect x="10.8" y="12.3" width="3.4" height="3.4" fill="var(--surface-1)" />
    </svg>
  );
}

export function IconSplitDiff({ size = 14, ...props }: IconProps) {
  return (
    <svg {...baseProps(size, props)}>
      <rect x="2.5" y="3.5" width="15" height="13" />
      <path d="M10 2.5v15" />
      <path d="M7.5 8.5L6 10l1.5 1.5M12.5 8.5L14 10l-1.5 1.5" />
    </svg>
  );
}

export function IconPipeline({ size = 15, ...props }: IconProps) {
  return (
    <svg {...baseProps(size, props)}>
      <rect x="2.5" y="8" width="4" height="4" />
      <rect x="8" y="3" width="4" height="4" />
      <rect x="8" y="13" width="4" height="4" />
      <rect x="13.5" y="8" width="4" height="4" />
      <path d="M6.5 9.2L8 6.8M6.5 10.8L8 13.2M12 6.8l1.5 2.4M12 13.2l1.5-2.4" />
    </svg>
  );
}
