import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        teal: {
          DEFAULT: "#214746",
          light: "#2B5855",
          lighter: "#A9D8CA",
        },
        paper: {
          DEFAULT: "#F4F1E9",
          dark: "#E5E8DF",
          hover: "#E7EBE5",
        },
        coral: {
          DEFAULT: "#F4A28C",
          dark: "#DC7C66",
          deeper: "#512E2B",
          bg: "#FCE9E3",
          text: "#A14D3F",
        },
        aqua: {
          DEFAULT: "#8DDDD0",
          dark: "#56B9AC",
          deeper: "#163D3A",
        },
        lilac: {
          DEFAULT: "#C9B9E9",
          dark: "#A991D1",
          deeper: "#34264F",
        },
        sun: {
          DEFAULT: "#F6D486",
          dark: "#DDB35A",
          deeper: "#4C3911",
        },
        line: "#C8C6BD",
        sage: {
          DEFAULT: "#D9E7DE",
          dark: "#E3E8E0",
          text: "#286057",
        },
        ink: {
          DEFAULT: "#334747",
          light: "#52605C",
          muted: "#717972",
          faint: "#87908A",
        },
        red: {
          error: "#E5B2A5",
          errorBg: "#FCE9E3",
          errorText: "#A14D3F",
          errorBorder: "#C77A68",
        },
      },
      fontFamily: {
        display: ['"DM Sans"', "sans-serif"],
        body: ['"DM Sans"', "sans-serif"],
        mono: ['"Space Mono"', "monospace"],
      },
      borderRadius: {
        "2xl": "18px",
        "3xl": "22px",
        "4xl": "28px",
      },
      boxShadow: {
        card: "0 8px 24px rgba(61, 75, 66, .07)",
        elevated: "0 18px 45px rgba(33, 71, 70, .16)",
      },
    },
  },
  plugins: [],
};

export default config;
