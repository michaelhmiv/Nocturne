import type { Metadata } from "next";
import type { ReactNode } from "react";
import AppNavigation from "./app-navigation";
import "./styles.css";
import "./scene-styles.css";
import "./action-plan-styles.css";
import "./dashboard-styles.css";
import "./developer-styles.css";

export const metadata: Metadata = {
  title: "Nocturne",
  description: "A persistent AI-mediated comic-book role-playing world.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <AppNavigation />
        {children}
      </body>
    </html>
  );
}
