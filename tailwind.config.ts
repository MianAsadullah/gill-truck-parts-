import type { Config } from "tailwindcss";

/**
 * Design tokens reverse-engineered from QuickBooks Desktop Enterprise 2021
 * (Wholesale & Manufacturing edition). The goal is a dense, Win32-era
 * data-entry surface: 11px Tahoma, 20px grid rows, 1px hairline borders,
 * inset field bevels, and gradient chrome.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        qb: {
          // Window chrome / dialog backgrounds
          chrome: "#F0F0F0",
          chromeDark: "#E3E3E3",
          chromeAlt: "#F7F7F7",
          // Borders: `line` for hairlines, `border` for raised edges
          line: "#D4D4D4",
          border: "#ABADB3",
          // Classic Windows text-field border
          field: "#7F9DB9",
          fieldFocus: "#0077C5",
          // Left icon bar (QB 2018+ dark bar)
          bar: "#2E3338",
          barHover: "#3F464D",
          barActive: "#0C5A8E",
          barText: "#D8DDE2",
          // Menu bar
          menu: "#F5F5F5",
          menuHover: "#D6E3F0",
          // Transaction-form ribbon
          ribbon: "#DCE7F2",
          ribbonLine: "#A8BED4",
          // Title bars
          title: "#1C5F94",
          titleAlt: "#2D7CB8",
          // Brand accents
          blue: "#0077C5",
          blueDark: "#005B96",
          green: "#2CA01C",
          greenDark: "#218015",
          // Grid
          gridHeader: "#EDEDED",
          gridLine: "#C9C9C9",
          gridStripe: "#F6F8FA",
          gridSelect: "#CCE4FF",
          gridSelectBorder: "#3399FF",
          // Semantic
          red: "#C5221F",
          amber: "#B8860B",
          warnBg: "#FFF4CE",
          warnBorder: "#E5C76B",
          errBg: "#FDE7E9",
          errBorder: "#E8A3A6",
          okBg: "#E6F4EA",
          // Text
          ink: "#1A1A1A",
          inkMuted: "#5A5A5A",
          inkDisabled: "#9A9A9A",
        },
      },
      fontFamily: {
        // Tahoma is the authentic QB Desktop face; the rest are fallbacks
        // that keep the same metrics on Linux/macOS.
        qb: ['Tahoma', 'Verdana', 'Segoe UI', 'DejaVu Sans', 'sans-serif'],
        qbMono: ['Consolas', 'Menlo', 'DejaVu Sans Mono', 'monospace'],
      },
      fontSize: {
        // Explicit px, not rem — QB does not scale with the root font.
        "qb-xs": ["10px", "13px"],
        "qb": ["11px", "15px"],
        "qb-md": ["12px", "16px"],
        "qb-lg": ["13px", "18px"],
        "qb-xl": ["15px", "20px"],
        "qb-2xl": ["18px", "24px"],
      },
      spacing: {
        // 20px = one grid row; 22px = one input
        row: "20px",
        input: "22px",
      },
      boxShadow: {
        // Inset bevel for text inputs
        "qb-inset": "inset 1px 1px 0 0 rgba(0,0,0,0.10)",
        // Raised push-button
        "qb-btn": "inset 0 1px 0 0 rgba(255,255,255,0.85), 0 1px 1px 0 rgba(0,0,0,0.12)",
        "qb-btn-active": "inset 0 1px 2px 0 rgba(0,0,0,0.22)",
        // Floating window / modal
        "qb-window": "0 2px 10px 0 rgba(0,0,0,0.26), 0 0 0 1px rgba(0,0,0,0.14)",
        "qb-dropdown": "0 3px 8px 0 rgba(0,0,0,0.22), 0 0 0 1px #ABADB3",
      },
      backgroundImage: {
        "qb-chrome": "linear-gradient(to bottom, #FAFAFA 0%, #ECECEC 100%)",
        "qb-btn": "linear-gradient(to bottom, #FDFDFD 0%, #E8E8E8 100%)",
        "qb-btn-hover": "linear-gradient(to bottom, #FFFFFF 0%, #DCE7F2 100%)",
        "qb-grid-header": "linear-gradient(to bottom, #FBFBFB 0%, #E6E6E6 100%)",
        "qb-title": "linear-gradient(to bottom, #2D7CB8 0%, #1C5F94 100%)",
        "qb-ribbon": "linear-gradient(to bottom, #EAF2FA 0%, #D3E1F0 100%)",
        "qb-green": "linear-gradient(to bottom, #35B823 0%, #248016 100%)",
      },
      borderRadius: {
        // QB Desktop is essentially square. 2px is the maximum.
        qb: "2px",
      },
    },
  },
  plugins: [],
};

export default config;
