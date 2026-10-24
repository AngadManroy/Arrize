import Link from "next/link";

const ITEMS = [
  { href: "/board", label: "Quests" },
  { href: "/onboard", label: "System" },
  { href: "/status", label: "Status" },
  { href: "/death", label: "Death Quests" },
];

export function Nav({ h, active }: { h: string; active: string }) {
  return (
    <nav className="nav">
      {ITEMS.map((i) => (
        <Link key={i.href} href={`${i.href}?h=${encodeURIComponent(h)}`} className={active === i.href ? "on" : ""}>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}

export function NoHunter() {
  return (
    <div className="wrap">
      <div className="panel glow">
        <p className="sys-title">System</p>
        <h2>No hunter selected</h2>
        <p className="muted">Open your personal link (it ends in <span className="mono">?h=your-name</span>), or create a hunter.</p>
        <Link className="btn primary" href="/">Create a hunter</Link>
      </div>
    </div>
  );
}
