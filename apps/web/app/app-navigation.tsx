"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const destinations = [
  { href: "/", label: "Play" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/account", label: "Account" },
] as const;

export default function AppNavigation() {
  const pathname = usePathname();
  return (
    <nav className="nocturne-app-nav" aria-label="Nocturne views">
      <Link className="nocturne-app-nav__brand" href="/">
        NOCTURNE
      </Link>
      <div>
        {destinations.map((destination) => {
          const active =
            destination.href === "/"
              ? pathname === "/"
              : pathname === destination.href || pathname.startsWith(`${destination.href}/`);
          return (
            <Link
              aria-current={active ? "page" : undefined}
              className={active ? "is-active" : undefined}
              href={destination.href}
              key={destination.href}
            >
              {destination.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
