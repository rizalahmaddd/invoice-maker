import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 20, children, ...rest }: P) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconDoc = (p: P) => (
  <Svg {...p}>
    <path d="M6 3h9l4 4v14H6z" />
    <path d="M14 3v5h5M9 13h7M9 17h4" />
  </Svg>
);
export const IconPeople = (p: P) => (
  <Svg {...p}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3.5 20c.6-3.6 2.8-5.5 5.5-5.5s4.9 1.9 5.5 5.5" />
    <path d="M15.5 5.2a3 3 0 0 1 0 5.6M17.5 14.8c1.6.6 2.6 2.3 3 5.2" />
  </Svg>
);
export const IconLayout = (p: P) => (
  <Svg {...p}>
    <path d="M4 3h16v18H4z" />
    <path d="M4 8h16M10 8v13" />
  </Svg>
);
export const IconGear = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" />
  </Svg>
);
export const IconPlus = (p: P) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
export const IconTrash = (p: P) => (
  <Svg {...p}>
    <path d="M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13M10 11v6M14 11v6" />
  </Svg>
);
export const IconCopy = (p: P) => (
  <Svg {...p}>
    <path d="M8 8h12v12H8z" />
    <path d="M16 8V4H4v12h4" />
  </Svg>
);
export const IconShare = (p: P) => (
  <Svg {...p}>
    <path d="M12 3v12M7.5 7.5 12 3l4.5 4.5" />
    <path d="M5 12v9h14v-9" />
  </Svg>
);
export const IconDownload = (p: P) => (
  <Svg {...p}>
    <path d="M12 3v12M7.5 10.5 12 15l4.5-4.5M5 20h14" />
  </Svg>
);
export const IconEdit = (p: P) => (
  <Svg {...p}>
    <path d="M4 20h4L19 9l-4-4L4 16z" />
    <path d="m13 7 4 4" />
  </Svg>
);
export const IconBack = (p: P) => (
  <Svg {...p}>
    <path d="M15 5l-7 7 7 7" />
  </Svg>
);
export const IconChevronDown = (p: P) => (
  <Svg {...p}>
    <path d="m6 9 6 6 6-6" />
  </Svg>
);
export const IconUp = (p: P) => (
  <Svg {...p}>
    <path d="m6 15 6-6 6 6" />
  </Svg>
);
export const IconClose = (p: P) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);
export const IconUpload = (p: P) => (
  <Svg {...p}>
    <path d="M12 16V4M7.5 8.5 12 4l4.5 4.5M5 20h14" />
  </Svg>
);
export const IconWallet = (p: P) => (
  <Svg {...p}>
    <path d="M3 7h16v13H3z" />
    <path d="M3 7l12-4v4M15 13.5h2" />
  </Svg>
);
export const IconReceipt = (p: P) => (
  <Svg {...p}>
    <path d="M5 3h14v18l-2.3-1.6L14.3 21 12 19.4 9.7 21l-2.4-1.6L5 21z" />
    <path d="M9 8h6M9 12h6" />
  </Svg>
);
export const IconSearch = (p: P) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4.5 4.5" />
  </Svg>
);
export const IconMore = (p: P) => (
  <Svg {...p}>
    <path d="M5 12h.01M12 12h.01M19 12h.01" strokeWidth={3} strokeLinecap="round" />
  </Svg>
);
export const IconSun = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
  </Svg>
);
export const IconMoon = (p: P) => (
  <Svg {...p}>
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </Svg>
);
export const IconTable = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M3 10h18M3 15h18M9 10v10M15 10v10" />
  </Svg>
);
export const IconGrid = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
  </Svg>
);
export const IconZoomIn = (p: P) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5M11 8v6M8 11h6" />
  </Svg>
);
export const IconZoomOut = (p: P) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5M8 11h6" />
  </Svg>
);
export const IconPrinter = (p: P) => (
  <Svg {...p}>
    <path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
    <rect x="6" y="14" width="12" height="7" rx="1" />
  </Svg>
);
export const IconCheck = (p: P) => (
  <Svg {...p}>
    <path d="M20 6 9 17l-5-5" />
  </Svg>
);
export const IconFilter = (p: P) => (
  <Svg {...p}>
    <path d="M3 5h18M6 12h12M10 19h4" />
  </Svg>
);
export const IconSidebar = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M9 4v16" />
  </Svg>
);


export const IconChart = (p: P) => (
  <Svg {...p}>
    <path d="M4 20h16M7 16v-5M12 16V6M17 16v-8" />
  </Svg>
);

export const IconBell = (p: P) => (
  <Svg {...p}>
    <path d="M18 9a6 6 0 0 0-12 0c0 6-2.5 7-2.5 7h17S18 15 18 9" />
    <path d="M10.3 20a2 2 0 0 0 3.4 0" />
  </Svg>
);

export const IconRepeat = (p: P) => (
  <Svg {...p}>
    <path d="m17 2 4 4-4 4" />
    <path d="M3 11V9a4 4 0 0 1 4-4h14" />
    <path d="m7 22-4-4 4-4" />
    <path d="M21 13v2a4 4 0 0 1-4 4H3" />
  </Svg>
);

export const IconQuotation = (p: P) => (
  <Svg {...p}>
    <path d="M3 12V4h8l10 10-8 8L3 12z" />
    <circle cx="7.5" cy="8.5" r="1.3" />
  </Svg>
);
