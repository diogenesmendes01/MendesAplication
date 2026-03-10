import type { Config } from "tailwindcss";

const config: Config = {
  // darkMode disabled — PRD says no dark mode for now
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-jakarta)', 'system-ui', 'sans-serif'],
      },
      colors: {
        // Backgrounds
        background: 'hsl(var(--background))',
        'background-subtle': 'hsl(var(--background-subtle))',
        
        // Surfaces
        surface: 'hsl(var(--surface))',
        'surface-raised': 'hsl(var(--surface-raised))',
        
        // Text
        'text-primary': 'hsl(var(--text-primary))',
        'text-secondary': 'hsl(var(--text-secondary))',
        'text-tertiary': 'hsl(var(--text-tertiary))',
        'text-disabled': 'hsl(var(--text-disabled))',
        
        // Accent
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          hover: 'hsl(var(--accent-hover))',
          subtle: 'hsl(var(--accent-subtle))',
          muted: 'hsl(var(--accent-muted))',
        },
        
        // Borders
        border: 'hsl(var(--border))',
        'border-subtle': 'hsl(var(--border-subtle))',
        'border-focus': 'hsl(var(--border-focus))',
        
        // Status
        success: {
          DEFAULT: 'hsl(var(--success))',
          subtle: 'hsl(var(--success-subtle))',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning))',
          subtle: 'hsl(var(--warning-subtle))',
        },
        danger: {
          DEFAULT: 'hsl(var(--danger))',
          subtle: 'hsl(var(--danger-subtle))',
        },
        info: {
          DEFAULT: 'hsl(var(--info))',
          subtle: 'hsl(var(--info-subtle))',
        },
        
        // Sidebar
        sidebar: {
          bg: 'hsl(var(--sidebar-bg))',
          'active-bg': 'hsl(var(--sidebar-active-bg))',
          'active-text': 'hsl(var(--sidebar-active-text))',
          'hover-bg': 'hsl(var(--sidebar-hover-bg))',
        },
        
        // Legacy shadcn mappings (for backwards compatibility)
        foreground: 'hsl(var(--text-primary))',
        card: {
          DEFAULT: 'hsl(var(--surface))',
          foreground: 'hsl(var(--text-primary))',
        },
        popover: {
          DEFAULT: 'hsl(var(--surface))',
          foreground: 'hsl(var(--text-primary))',
        },
        primary: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--surface))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--background-subtle))',
          foreground: 'hsl(var(--text-primary))',
        },
        muted: {
          DEFAULT: 'hsl(var(--background-subtle))',
          foreground: 'hsl(var(--text-secondary))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--danger))',
          foreground: 'hsl(var(--surface))',
        },
        input: 'hsl(var(--border))',
        ring: 'hsl(var(--border-focus))',
        
        // Charts
        chart: {
          '1': 'hsl(var(--accent))',        /* #6366F1 */
          '2': 'hsl(var(--warning))',       /* #D97706 */
          '3': 'hsl(217 91% 60%)',          /* Blue */
          '4': 'hsl(157 84% 28%)',          /* #059669 */
          '5': 'hsl(35 87% 44%)',           /* #D97706 */
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      boxShadow: {
        'xs': 'var(--shadow-xs)',
        'sm': 'var(--shadow-sm)',
        'md': 'var(--shadow-md)',
        'lg': 'var(--shadow-lg)',
        'xl': 'var(--shadow-xl)',
      },
      fontSize: {
        'display': ['32px', { lineHeight: '40px', fontWeight: '700' }],
        'h1': ['24px', { lineHeight: '32px', fontWeight: '600' }],
        'h2': ['18px', { lineHeight: '28px', fontWeight: '600' }],
        'h3': ['15px', { lineHeight: '24px', fontWeight: '600' }],
        'body': ['14px', { lineHeight: '20px', fontWeight: '400' }],
        'body-sm': ['13px', { lineHeight: '20px', fontWeight: '400' }],
        'caption': ['12px', { lineHeight: '16px', fontWeight: '400' }],
        'mono': ['13px', { lineHeight: '20px', fontWeight: '400' }],
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
export default config;
